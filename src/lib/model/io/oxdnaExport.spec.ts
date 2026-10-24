import { describe, expect, it } from 'vitest';
import { makeHoneycombPart, addLatticeVh } from '$lib/model/test/testHelpers';
import { collectOxDnaNucleotides, exportPartToOxDna } from './oxdnaExport';
import type { BlockTransformOverride } from '$lib/model/rbs/rbsTypes';
import type OligoSegment from '$lib/model/Oligo/OligoSegment.svelte';

// oxDNA unit constants mirrored from oxdnaExport.ts for assertion purposes
const OXDNA_BASE_BASE = 0.3897628551303122;
const OXDNA_CM_CENTER_DS = 0.6;
const OXDNA_NM = 0.8518;

function setSymmetricSkipsAndInserts(
	segA: OligoSegment,
	segB: OligoSegment,
	entries: [number, number][]
): void {
	segA.skipsAndInserts = entries;
	segB.skipsAndInserts = entries;
}

describe('oxDNA export', () => {
	it('emits inserted nts and omits skipped nts', () => {
		const part = makeHoneycombPart('insert-skip-export');
		const vh = addLatticeVh(part, 0, 0);
		const oligo = part.createOligo(vh, 0, 4);
		const seg = [...oligo.segments][0];
		const compOligo = part.createOligo(vh, 4, 0);
		const compSeg = [...compOligo.segments][0];
		setSymmetricSkipsAndInserts(seg, compSeg, [
			[1, 2],
			[3, -1],
		]);

		const result = exportPartToOxDna(part);
		const topLines = result.top.trim().split('\n');

		expect(result.nucleotideCount).toBe(12);
		expect(result.strandCount).toBe(2);
		// classic format header: "N Ns"
		expect(topLines[0]).toBe('12 2');
		// classic format has one row per nucleotide: header + 12 nt rows
		expect(topLines).toHaveLength(13);
		expect(result.dat.trim().split('\n')).toHaveLength(15);
	});

	it('rejects asymmetric insert/skip data', () => {
		const part = makeHoneycombPart('asymmetric-insert-skip-export');
		const vh = addLatticeVh(part, 0, 0);
		const oligo = part.createOligo(vh, 0, 4);
		const seg = [...oligo.segments][0];
		part.createOligo(vh, 4, 0);
		seg.skipsAndInserts = [[1, 2]];

		expect(() => exportPartToOxDna(part)).toThrow(/different skip\/insert on each strand/);
	});

	it('classic topology row format: strandId base next prev', () => {
		const part = makeHoneycombPart('format-export');
		const vh = addLatticeVh(part, 0, 0);
		part.createOligo(vh, 0, 2);

		const result = exportPartToOxDna(part);
		const topLines = result.top.trim().split('\n');

		// Each data row must match: number base number number
		const rowPattern = /^\d+ [ACGT] -?\d+ -?\d+$/;
		for (const line of topLines.slice(1)) {
			expect(line).toMatch(rowPattern);
		}
	});

	it('writes contiguous topology neighbors across connected segments', () => {
		const part = makeHoneycombPart('connected-export');
		const vhA = addLatticeVh(part, 0, 0);
		const vhB = addLatticeVh(part, 8, 8);
		const a = part.createOligo(vhA, 0, 2);
		const b = part.createOligo(vhB, 2, 0);
		const segA = [...a.segments][0];
		const segB = [...b.segments][0];
		segA.threePrime.connectTo(segB.fivePrime);
		a.addSegment(segB);
		part.oligos.delete(b);

		const result = exportPartToOxDna(part);
		const topLines = result.top.trim().split('\n');

		expect(topLines[0]).toBe('6 1');
		// format per row: "strandId base next prev"
		// nt 0 is the 5' end: next=1, prev=-1
		const firstRow = topLines[1].split(' ');
		expect(firstRow[2]).toBe('1'); // next of nt 0 = nt 1
		expect(firstRow[3]).toBe('-1'); // prev of nt 0 = -1 (free 5' end)
		// nt 5 is the 3' end: next=-1, prev=4
		const lastRow = topLines[6].split(' ');
		expect(lastRow[2]).toBe('-1'); // next of last nt = -1 (free 3' end)
		expect(lastRow[3]).toBe('4'); // prev of last nt = nt 4
	});

	it('uses reverse-orientation physical indices in 5-prime to 3-prime order', () => {
		const part = makeHoneycombPart('reverse-export');
		const vh = addLatticeVh(part, 0, 0);
		const oligo = part.createOligo(vh, 4, 0);
		const seg = [...oligo.segments][0];
		const compOligo = part.createOligo(vh, 0, 4);
		const compSeg = [...compOligo.segments][0];
		setSymmetricSkipsAndInserts(seg, compSeg, [[2, 1]]);

		const nts = collectOxDnaNucleotides(part);
		const zValues = nts.filter((nt) => nt.segmentId === seg.id).map((nt) => nt.position.z);

		expect(zValues).toHaveLength(6);
		// Free-free spans extend naturally toward increasing bp index; the symmetric
		// insertion before bp 3 shifts the high-bp 5' end forward by one physical layer.
		expect(zValues[0]).toBeCloseTo(5 * OXDNA_BASE_BASE, 6);
		expect(zValues[5]).toBeCloseTo(0, 6);
		// z decreases strictly from 5' to 3' (ordering check).
		for (let i = 0; i < 5; i++) {
			expect(zValues[i]).toBeGreaterThan(zValues[i + 1]);
		}
	});

	it('applies relaxed segment overrides to exported coordinates', () => {
		const part = makeHoneycombPart('override-export');
		const vh = addLatticeVh(part, 0, 0);
		const oligo = part.createOligo(vh, 0, 1);
		const seg = [...oligo.segments][0];
		const overrides = new Map<string, BlockTransformOverride>([
			[
				seg.id,
				{
					originalCenter: { x: 0, y: 0, z: 0 },
					position: { x: 10, y: 20, z: 30 },
					quaternion: { x: 0, y: 0, z: 0, w: 1 },
				},
			],
		]);

		const plain = collectOxDnaNucleotides(part);
		const relaxed = collectOxDnaNucleotides(part, overrides);

		expect(relaxed[0].position.x - plain[0].position.x).toBeCloseTo(10 / OXDNA_NM, 4);
		expect(relaxed[0].position.y - plain[0].position.y).toBeCloseTo(20 / OXDNA_NM, 4);
		expect(relaxed[0].position.z - plain[0].position.z).toBeCloseTo(30 / OXDNA_NM, 4);
	});

	it('identity override produces same coordinates as no override', () => {
		const part = makeHoneycombPart('identity-override-export');
		const vh = addLatticeVh(part, 0, 0);
		const oligo = part.createOligo(vh, 0, 1);
		const seg = [...oligo.segments][0];
		const plain = collectOxDnaNucleotides(part);
		// position = originalCenter → identity rigid-body transform regardless of value
		const rbsCenter = { x: 1.5, y: 0.9, z: 0.34 }; // typical visual-nm block centroid
		const overrides = new Map<string, BlockTransformOverride>([
			[
				seg.id,
				{
					originalCenter: { ...rbsCenter },
					position: { ...rbsCenter },
					quaternion: { x: 0, y: 0, z: 0, w: 1 },
				},
			],
		]);
		const identity = collectOxDnaNucleotides(part, overrides);
		expect(identity[0].position.x).toBeCloseTo(plain[0].position.x, 4);
		expect(identity[0].position.y).toBeCloseTo(plain[0].position.y, 4);
		expect(identity[0].position.z).toBeCloseTo(plain[0].position.z, 4);
	});

	it('is deterministic for the same part', () => {
		const part = makeHoneycombPart('deterministic-export');
		const vh = addLatticeVh(part, 0, 0);
		const oligo = part.createOligo(vh, 0, 4);
		const seg = [...oligo.segments][0];
		const compOligo = part.createOligo(vh, 4, 0);
		const compSeg = [...compOligo.segments][0];
		setSymmetricSkipsAndInserts(seg, compSeg, [[1, 2]]);
		seg.sequence = 'AAAAAAN';
		compSeg.sequence = 'TTTTTTN';

		expect(exportPartToOxDna(part)).toEqual(exportPartToOxDna(part));
	});

	it('COM position uses oxDNA units not nm', () => {
		const part = makeHoneycombPart('com-position-export');
		const vh = addLatticeVh(part, 0, 0);
		part.createOligo(vh, 0, 2);

		const nts = collectOxDnaNucleotides(part);
		// First nt: VH at col=row=0, bpIdx=0. Center is at XY=0, z=0.
		// Radial offset magnitude must be OXDNA_CM_CENTER_DS = 0.6 oxDNA units (not nm).
		// Checking magnitude rather than a specific axis since twistOffset ≠ 0°.
		const lateralMag = Math.sqrt(nts[0].position.x ** 2 + nts[0].position.y ** 2);
		expect(lateralMag).toBeCloseTo(OXDNA_CM_CENTER_DS, 6);
		expect(nts[0].position.z).toBeCloseTo(0, 6);
	});

	it('axial rise matches oxDNA BASE_BASE constant', () => {
		const part = makeHoneycombPart('rise-export');
		const vh = addLatticeVh(part, 0, 0);
		part.createOligo(vh, 0, 4);

		const nts = collectOxDnaNucleotides(part);
		const zDiff = nts[1].position.z - nts[0].position.z;

		// Must be OXDNA_BASE_BASE ≈ 0.3898, not BP_RISE_NM = 0.34
		expect(zDiff).toBeCloseTo(OXDNA_BASE_BASE, 6);
		expect(zDiff).not.toBeCloseTo(0.34, 3);
	});

	it('circular oligo closes backbone bonds in topology', () => {
		const part = makeHoneycombPart('circular-export');
		const vh0 = addLatticeVh(part, 0, 0);
		const vh1 = addLatticeVh(part, 2, 0);
		// segA: 5'→3' direction on vh0
		const oligoA = part.createOligo(vh0, 0, 3);
		// segB: 3'←5' direction on vh1 (reversed)
		const oligoB = part.createOligo(vh1, 3, 0);
		const segA = [...oligoA.segments][0];
		const segB = [...oligoB.segments][0];
		// Connect A→B
		segA.threePrime.connectTo(segB.fivePrime);
		oligoA.addSegment(segB);
		part.oligos.delete(oligoB);
		// Connect B→A to close the circle
		segB.threePrime.connectTo(segA.fivePrime);

		const oligo = oligoA;
		expect(oligo.isCircular).toBe(true);

		const nts = collectOxDnaNucleotides(part);
		const n = nts.length;
		expect(n).toBeGreaterThan(1);

		// First nt: prev must wrap to last nt (not -1)
		expect(nts[0].prev).toBe(n - 1);
		// Last nt: next must wrap to first nt (not -1)
		expect(nts[n - 1].next).toBe(0);

		// Topology output must reflect the closure
		const result = exportPartToOxDna(part);
		const topLines = result.top.trim().split('\n');
		const firstRow = topLines[1].split(' ');
		const lastRow = topLines[n].split(' ');
		expect(firstRow[3]).toBe(String(n - 1)); // prev of nt 0 = last nt
		expect(lastRow[2]).toBe('0'); // next of last nt = 0
	});
});
