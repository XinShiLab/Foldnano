// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { CadnanoJSON } from '$lib/model/io/cadnanoJSON';
import { makeHoneycombPart, addLatticeVh } from '$lib/model/test/testHelpers';
import type OligoSegment from '$lib/model/Oligo/OligoSegment.svelte';
import { RISE_NM } from './simulationNtModel';
import { collectMrdnaNucleotides, exportPartToMrdna } from './mrdnaExport';

// ── helpers ─────────────────────────────────────────────────────────────────

type MrdnaRow = {
	x: number;
	y: number;
	z: number;
	bpIdx: number;
	stackIdx: number;
	threePrimeIdx: number;
};

function parseMrdnaTxt(txt: string): MrdnaRow[] {
	return txt
		.split(/\r?\n/)
		.filter((l) => l.trim() && !l.startsWith('#'))
		.map((line) => {
			const fields = line.trim().split(/\s+/);
			expect(fields.length).toBeGreaterThanOrEqual(6);
			const f = fields.slice(0, 6).map(Number);
			for (const value of f) {
				expect(Number.isFinite(value)).toBe(true);
			}
			return { x: f[0], y: f[1], z: f[2], bpIdx: f[3], stackIdx: f[4], threePrimeIdx: f[5] };
		});
}

function segmentOf(segments: Set<OligoSegment>): OligoSegment {
	const seg = [...segments][0];
	if (!seg) throw new Error('Expected oligo segment');
	return seg;
}

interface TopoStats {
	ntCount: number;
	dsDnaCount: number; // bp_idx != -1
	ssDnaCount: number; // bp_idx == -1
	stackingPairCount: number; // stack_idx != -1
	strandTerminalCount: number; // three_prime_idx == -1 (= number of 3' ends = number of strands for linear)
	strandCount: number; // chains found by following three_prime_idx links
}

function topoStats(rows: MrdnaRow[]): TopoStats {
	const n = rows.length;
	let dsDnaCount = 0;
	let stackingPairCount = 0;
	let strandTerminalCount = 0;

	// Build a set of nt indices that are pointed to as a 3' neighbour (= have a 5' predecessor)
	const hasPrev = new Uint8Array(n);
	for (const row of rows) {
		if (row.bpIdx !== -1) dsDnaCount++;
		if (row.stackIdx !== -1) stackingPairCount++;
		if (row.threePrimeIdx === -1) strandTerminalCount++;
		else hasPrev[row.threePrimeIdx] = 1;
	}

	// Count strands: each nt with no predecessor (hasPrev[i] === 0) is a 5' end of a strand
	let strandCount = 0;
	for (let i = 0; i < n; i++) {
		if (!hasPrev[i]) strandCount++;
	}

	return {
		ntCount: n,
		dsDnaCount,
		ssDnaCount: n - dsDnaCount,
		stackingPairCount,
		strandTerminalCount,
		strandCount,
	};
}

function loadNontrivialUiuc() {
	const raw = fs.readFileSync(
		path.resolve('test_files/internal_cadnano_designs/nontrivial_uiuc.json'),
		'utf-8'
	);
	const json = JSON.parse(raw);
	const cadnano = new CadnanoJSON(json.name ?? 'nontrivial_uiuc', json.vstrands);
	return cadnano.toPart();
}

// ── nontrivial_uiuc reference topology tests ────────────────────────────────

describe('mrDNA export — nontrivial_uiuc topology', () => {
	const FIXTURE = path.resolve('test_files/fixtures/mrdna_export/nontrivial_uiuc.txt');

	it('nucleotide count matches reference fixture', () => {
		const part = loadNontrivialUiuc();
		const result = exportPartToMrdna(part);
		const refLines = fs
			.readFileSync(FIXTURE, 'utf-8')
			.split(/\r?\n/)
			.filter((l) => l.trim() && !l.startsWith('#'));
		expect(result.nucleotideCount).toBe(refLines.length);
	});

	it('bp pairing is symmetric: bp[bp[i]] === i for all dsDNA nts', () => {
		const part = loadNontrivialUiuc();
		const result = exportPartToMrdna(part);
		const rows = parseMrdnaTxt(result.txt);

		for (let i = 0; i < rows.length; i++) {
			const partner = rows[i].bpIdx;
			if (partner === -1) continue;
			expect(partner).toBeGreaterThanOrEqual(0);
			expect(partner).toBeLessThan(rows.length);
			expect(rows[partner].bpIdx).toBe(i);
		}
	});

	it('strand chains are valid: three_prime_idx links form well-formed chains', () => {
		const part = loadNontrivialUiuc();
		const result = exportPartToMrdna(part);
		const rows = parseMrdnaTxt(result.txt);
		const n = rows.length;

		// Build in-degree map: count how many nts point to each nt via three_prime_idx
		const inDegree = new Int32Array(n);
		for (const row of rows) {
			if (row.threePrimeIdx !== -1) {
				expect(row.threePrimeIdx).toBeGreaterThanOrEqual(0);
				expect(row.threePrimeIdx).toBeLessThan(n);
				inDegree[row.threePrimeIdx]++;
			}
		}
		// Each nt may be pointed to by at most one other nt (no branching)
		for (let i = 0; i < n; i++) {
			expect(inDegree[i]).toBeLessThanOrEqual(1);
		}
	});

	it('stack_idx is -1 or a valid nt index pointing to a dsDNA nt', () => {
		// stack_idx is physical co-axial stacking — independent of strand.
		// At a crossover, stack_idx may differ from three_prime_idx (cross-strand stacking).
		const part = loadNontrivialUiuc();
		const result = exportPartToMrdna(part);
		const rows = parseMrdnaTxt(result.txt);

		for (let i = 0; i < rows.length; i++) {
			const row = rows[i];
			if (row.stackIdx !== -1) {
				expect(row.stackIdx).toBeGreaterThanOrEqual(0);
				expect(row.stackIdx).toBeLessThan(rows.length);
				// Both this nt and its stacking partner must be dsDNA
				expect(row.bpIdx).not.toBe(-1);
				expect(rows[row.stackIdx].bpIdx).not.toBe(-1);
			}
		}
	});

	it('stack_idx is -1 for ssDNA nts (bpIdx === -1)', () => {
		const part = loadNontrivialUiuc();
		const result = exportPartToMrdna(part);
		const rows = parseMrdnaTxt(result.txt);

		for (const row of rows) {
			if (row.bpIdx === -1) {
				expect(row.stackIdx).toBe(-1);
			}
		}
	});

	it('positions are finite and in a plausible nm range', () => {
		const part = loadNontrivialUiuc();
		const result = exportPartToMrdna(part);
		const rows = parseMrdnaTxt(result.txt);

		for (const row of rows) {
			expect(Number.isFinite(row.x)).toBe(true);
			expect(Number.isFinite(row.y)).toBe(true);
			expect(Number.isFinite(row.z)).toBe(true);
			expect(Math.abs(row.x)).toBeLessThan(1000);
			expect(Math.abs(row.y)).toBeLessThan(1000);
			expect(Math.abs(row.z)).toBeLessThan(1000);
		}
	});
});

// ── topology statistics compared against the mrDNA reference file ────────────
//
// We cannot compare index values directly — our nucleotide ordering may differ
// from mrDNA's. Instead we compare ordering-independent counts derived from the
// three index columns. If our importer or exporter misclassifies pairing,
// stacking, or strand connectivity these counts will diverge.

describe('mrDNA export — topology statistics vs reference', () => {
	const FIXTURE = path.resolve('test_files/fixtures/mrdna_export/nontrivial_uiuc.txt');

	// compute once, shared across all it() blocks
	const part = loadNontrivialUiuc();
	const result = exportPartToMrdna(part);
	const ourStats: TopoStats = topoStats(parseMrdnaTxt(result.txt));
	const refStats: TopoStats = topoStats(parseMrdnaTxt(fs.readFileSync(FIXTURE, 'utf-8')));

	it('dsDNA nucleotide count matches reference', () => {
		expect(ourStats.dsDnaCount).toBe(refStats.dsDnaCount);
	});

	it('ssDNA nucleotide count matches reference', () => {
		expect(ourStats.ssDnaCount).toBe(refStats.ssDnaCount);
	});

	it('stacking-pair count matches reference (±2 tolerance)', () => {
		// Genuine empty-space gaps (e.g. VH4.bp19, VH1.bp37-38 in nontrivial_uiuc) bridged by an
		// internal same-VH connection are NOT stacked — the flanking nts are ≥2 rises apart —
		// matching mrDNA's reader exactly (diff 0). Skips/deletions still stack (helix closes up).
		const diff = ourStats.stackingPairCount - refStats.stackingPairCount;
		console.log(
			`stacking-pair count: ours=${ourStats.stackingPairCount} ref=${refStats.stackingPairCount} diff=${diff >= 0 ? '+' : ''}${diff}`
		);
		expect(Math.abs(diff)).toBeLessThanOrEqual(2);
	});

	it('strand count matches reference', () => {
		expect(ourStats.strandCount).toBe(refStats.strandCount);
	});

	it('strand terminal count matches reference', () => {
		expect(ourStats.strandTerminalCount).toBe(refStats.strandTerminalCount);
	});
});

// ── unit tests with synthetic parts ─────────────────────────────────────────

describe('mrDNA export — stacking at crossovers', () => {
	it('stack_idx is -1 at a cross-VH crossover with no same-VH physical neighbor', () => {
		const part = makeHoneycombPart('mrdna-crossover-stack');
		const vhA = addLatticeVh(part, 0, 0);
		const vhB = addLatticeVh(part, 2, 0);
		const oligoA = part.createOligo(vhA, 0, 3);
		const oligoB = part.createOligo(vhB, 3, 0);
		const segA = segmentOf(oligoA.segments);
		const segB = segmentOf(oligoB.segments);
		segA.threePrime.connectTo(segB.fivePrime);
		oligoA.addSegment(segB);
		part.oligos.delete(oligoB);

		const nts = collectMrdnaNucleotides(part);
		// The nt just before the crossover on vhA is the last nt of segA.
		// Its three_prime_idx points to the first nt of segB (on vhB).
		// Its stack_idx must be -1 because next is on a different VH.
		const lastOfSegA = nts
			.filter((nt) => nt.threePrimeIdx !== -1)
			.find((nt) => {
				const next = nts[nt.threePrimeIdx];
				// Detect crossover: nt and its 3' neighbour have different positions in y (different helix)
				return Math.abs(next.position.y - nt.position.y) > 0.5;
			});
		expect(lastOfSegA).toBeDefined();
		expect(lastOfSegA!.stackIdx).toBe(-1);
	});

	it('stack_idx can differ from three_prime_idx at a crossover when the helix continues', () => {
		const part = makeHoneycombPart('mrdna-crossover-with-stack');
		const vhA = addLatticeVh(part, 0, 0);
		const vhB = addLatticeVh(part, 2, 0);
		const oligoA = part.createOligo(vhA, 0, 2);
		const oligoB = part.createOligo(vhB, 2, 0);
		const segA = segmentOf(oligoA.segments);
		const segB = segmentOf(oligoB.segments);
		segA.threePrime.connectTo(segB.fivePrime);
		oligoA.addSegment(segB);
		part.oligos.delete(oligoB);
		part.createOligo(vhA, 3, 5);
		part.createOligo(vhA, 5, 0);

		const nts = collectMrdnaNucleotides(part);
		const crossoverWithStack = nts.find((nt) => {
			if (nt.threePrimeIdx === -1 || nt.stackIdx === -1 || nt.stackIdx === nt.threePrimeIdx) {
				return false;
			}
			const next = nts[nt.threePrimeIdx];
			const stacked = nts[nt.stackIdx];
			const nextHelixDistance = Math.hypot(
				next.position.x - nt.position.x,
				next.position.y - nt.position.y
			);
			const stackRise = Math.abs(stacked.position.z - nt.position.z);
			return nextHelixDistance > 0.5 && stackRise < RISE_NM * 1.5;
		});

		expect(crossoverWithStack).toBeDefined();
	});

	it('does NOT stack across a same-VH gap bridged by an end-to-end strand connection', () => {
		// The two domains (bp2..8 and bp10..18) are a continuous helix in topology but leave a
		// genuine empty-space gap at bp9 (no skip/deletion). They are physically ~2 rises apart,
		// so the bridging nt must NOT stack — stack_idx = -1, matching mrDNA's cadnano reader.
		const part = makeHoneycombPart('mrdna-same-vh-gap-stack');
		const vh = addLatticeVh(part, 0, 0);
		const oligoA = part.createOligo(vh, 2, 8);
		const oligoB = part.createOligo(vh, 10, 18);
		const segA = segmentOf(oligoA.segments);
		const segB = segmentOf(oligoB.segments);
		segA.threePrime.connectTo(segB.fivePrime);
		oligoA.addSegment(segB);
		part.oligos.delete(oligoB);
		part.createOligo(vh, 8, 2);
		part.createOligo(vh, 18, 10);

		const nts = collectMrdnaNucleotides(part);
		// The nt at the 3′ end of domain A (bp8, z = 8·RISE) whose 3′ neighbour is the 5′ end of
		// domain B (bp10, z = 10·RISE) across the empty gap at bp9.
		const beforeGap = nts.find(
			(nt) =>
				nt.threePrimeIdx !== -1 &&
				Math.abs(nt.position.z - 8 * RISE_NM) < 0.05 &&
				Math.abs(nts[nt.threePrimeIdx].position.z - 10 * RISE_NM) < 0.05
		);

		expect(beforeGap).toBeDefined();
		expect(beforeGap!.stackIdx).toBe(-1);
	});

	it('stack_idx equals three_prime_idx within a helix', () => {
		const part = makeHoneycombPart('mrdna-intrahelix-stack');
		const vh = addLatticeVh(part, 0, 0);
		part.createOligo(vh, 0, 4);
		part.createOligo(vh, 4, 0);

		const nts = collectMrdnaNucleotides(part);
		// All dsDNA interior nts (not 3' terminus) should stack with their 3' neighbour
		const interiorDsDna = nts.filter((nt) => nt.bpIdx !== -1 && nt.threePrimeIdx !== -1);
		expect(interiorDsDna.length).toBeGreaterThan(0);
		for (const nt of interiorDsDna) {
			// Only check same-VH nts (single VH design, so all are same-VH)
			expect(nt.stackIdx).toBe(nt.threePrimeIdx);
		}
	});

	it('positions are in nm (not oxDNA units)', () => {
		const part = makeHoneycombPart('mrdna-nm-units');
		const vh = addLatticeVh(part, 0, 0);
		// Two strands needed to get dsDNA nts (bpIdx !== -1)
		part.createOligo(vh, 0, 4);
		part.createOligo(vh, 4, 0);

		const nts = collectMrdnaNucleotides(part);
		// Take the forward strand (3' direction, ascending z)
		const strand0 = nts.filter((nt) => nt.bpIdx !== -1 && nt.threePrimeIdx !== -1);
		expect(strand0.length).toBeGreaterThan(1);
		// In nm the axial rise is ~0.332 nm; in oxDNA units it would be ~0.390.
		for (const nt of strand0) {
			const next = nts[nt.threePrimeIdx];
			if (next.bpIdx === -1) continue; // skip ssDNA 3' neighbours
			const rise = Math.abs(next.position.z - nt.position.z);
			expect(rise).toBeCloseTo(0.332, 1);
		}
	});
});

describe('mrDNA export — output format', () => {
	it('emits header comment lines before nucleotide data', () => {
		const part = makeHoneycombPart('mrdna-header');
		const vh = addLatticeVh(part, 0, 0);
		part.createOligo(vh, 0, 2);
		const result = exportPartToMrdna(part);
		const lines = result.txt.split(/\r?\n/).filter((l) => l.trim());
		expect(lines[0]).toMatch(/^#/);
	});

	it('omits sequence when includeSequence is false', () => {
		const part = makeHoneycombPart('mrdna-no-seq');
		const vh = addLatticeVh(part, 0, 0);
		part.createOligo(vh, 0, 2);
		const result = exportPartToMrdna(part, { includeSequence: false });
		const dataLines = result.txt.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
		for (const line of dataLines) {
			const fields = line.split(/\s+/);
			// Without sequence: exactly 6 fields (x y z bp stack 3')
			expect(fields).toHaveLength(6);
		}
	});

	it('includes rotation matrix when includeOrientation is true', () => {
		const part = makeHoneycombPart('mrdna-orientation');
		const vh = addLatticeVh(part, 0, 0);
		part.createOligo(vh, 0, 2);
		const result = exportPartToMrdna(part, { includeSequence: true, includeOrientation: true });
		const dataLines = result.txt.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
		for (const line of dataLines) {
			const fields = line.split(/\s+/);
			// x y z bp stack 3' seq R(9) = 16 fields
			expect(fields).toHaveLength(16);
		}
	});

	it('nucleotideCount and strandCount are consistent with output', () => {
		const part = makeHoneycombPart('mrdna-counts');
		const vh = addLatticeVh(part, 0, 0);
		part.createOligo(vh, 0, 4);
		part.createOligo(vh, 4, 0);
		const result = exportPartToMrdna(part);
		const dataLines = result.txt.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
		expect(dataLines).toHaveLength(result.nucleotideCount);
		expect(result.strandCount).toBe(2);
	});
});
