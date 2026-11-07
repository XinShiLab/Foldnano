import { describe, expect, it } from 'vitest';
import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync } from 'node:fs';
import { join } from 'node:path';

import FoldnanoDocument from '$lib/model/document.svelte';
import { exportPartToOxDna } from '$lib/model/io/oxdnaExport';
import {
	applyRigidFit,
	bestFitRigid,
	buildReplayReference,
	poseFrame,
	unwrapStrandsInPlace,
} from '$lib/model/oxdnaReplay/framePose';
import { OxDnaTopologyParseError, parseOxDnaTopology } from '$lib/model/oxdnaReplay/oxdnaTopology';
import {
	FRAME_STRIDE,
	OxDnaTrajectoryParseError,
	parseOxDnaFrame,
	scanFrameStarts,
} from '$lib/model/oxdnaReplay/oxdnaTrajectory';
import { matchTopologyToDesign } from '$lib/model/oxdnaReplay/replayMapping';
import { MeanStructureAccumulator } from '$lib/model/oxdnaReplay/meanStructure';
import { CM_TO_BACKBONE_NM } from '$lib/model/io/simulationNtModel';

function loadPart(path: string) {
	const raw = JSON.parse(readFileSync(join(process.cwd(), path), 'utf-8'));
	return FoldnanoDocument.fromJSON(raw).parts[0];
}

const bytes = (text: string) => new TextEncoder().encode(text);

describe('parseOxDnaTopology', () => {
	it('reads the classic per-nucleotide format', () => {
		const top = parseOxDnaTopology('3 2\n1 A 1 -1\n1 C -1 0\n2 G -1 -1\n');
		expect(top.nucleotideCount).toBe(3);
		expect(top.strandCount).toBe(2);
		expect([...top.strandIds]).toEqual([1, 1, 2]);
		expect(top.bases).toEqual(['A', 'C', 'G']);
		expect([...top.next]).toEqual([1, -1, -1]);
		expect([...top.prev]).toEqual([-1, 0, -1]);
	});

	it('rejects a row count that disagrees with the header', () => {
		expect(() => parseOxDnaTopology('3 1\n1 A 1 -1\n')).toThrow(OxDnaTopologyParseError);
	});

	it('rejects the new 5->3 topology format', () => {
		expect(() => parseOxDnaTopology('1 1 5->3\nAAA\n')).toThrow(/new-format/);
	});
});

describe('scanFrameStarts', () => {
	const text = 't = 0\nb = 1 1 1\nE = 0 0 0\n1 2 3\nt = 10\nb = 1 1 1\n';

	it('finds every frame header', () => {
		expect(scanFrameStarts(bytes(text), 0)).toEqual([0, text.indexOf('t = 10')]);
	});

	it('finds headers across chunk boundaries', () => {
		const all = bytes(text);
		for (let split = 1; split < all.length; split++) {
			const first = scanFrameStarts(all.subarray(0, split), 0);
			const second = scanFrameStarts(all.subarray(split), split);
			expect([...first, ...second]).toEqual([0, text.indexOf('t = 10')]);
		}
	});

	it('ignores the t in Infinity, even at a chunk boundary', () => {
		const inf = bytes('t = 0\nb = 1 1 1\nE = 0 0 0\nInfinity 0 0\n');
		for (let split = 1; split < inf.length; split++) {
			const first = scanFrameStarts(inf.subarray(0, split), 0);
			expect([...first, ...scanFrameStarts(inf.subarray(split), split)]).toEqual([0]);
		}
	});

	it('splits off a header glued to the cut-off last line of an interrupted run', () => {
		// A restarted run appends after a partly written row, with no newline in between.
		const glued = 't = 0\nb = 1 1 1\nE = 0 0 0\n1 2 3 0.5 0.t = 10\nb = 1 1 1\n';
		expect(scanFrameStarts(bytes(glued), 0)).toEqual([0, glued.indexOf('t = 10')]);
	});
});

describe('parseOxDnaFrame', () => {
	const row = (x: number) => `${x} 0 0 1 0 0 0 0 1 0.1 0.2 0.3 0 0 0`;

	it('keeps r, a1, a3 and drops velocities', () => {
		const frame = parseOxDnaFrame(`t = 42\nb = 5 6 7\nE = 0 0 0\n${row(1)}\n${row(2)}\n`, 2);
		expect(frame.time).toBe(42);
		expect(frame.box).toEqual([5, 6, 7]);
		expect(frame.data.length).toBe(2 * FRAME_STRIDE);
		expect([...frame.data.subarray(FRAME_STRIDE)]).toEqual([2, 0, 0, 1, 0, 0, 0, 0, 1]);
	});

	it('rejects a frame whose row count differs from the topology', () => {
		expect(() => parseOxDnaFrame(`t = 0\nb = 5 5 5\nE = 0 0 0\n${row(1)}\n`, 2)).toThrow(
			OxDnaTrajectoryParseError
		);
		const twoRows = `t = 0\nb = 5 5 5\nE = 0 0 0\n${row(1)}\n${row(2)}\n`;
		expect(() => parseOxDnaFrame(twoRows, 1)).toThrow(/more rows than the 1/);
	});

	it('ignores NUL padding before the next header', () => {
		const padded = `t = 0\nb = 5 5 5\nE = 0 0 0\n${row(1)}\n\0\0\0\0`;
		expect(parseOxDnaFrame(padded, 1).data[0]).toBe(1);
	});

	it('reports a frame cut off mid-row', () => {
		expect(() =>
			parseOxDnaFrame(`t = 0\nb = 5 5 5\nE = 0 0 0\n${row(1)}\n1 2 3 0.5 0.`, 2)
		).toThrow(/cut off/);
	});
});

describe('bestFitRigid', () => {
	it('recovers a known rotation and translation', () => {
		const ref = new Float32Array([0, 0, 0, 3, 0, 0, 0, 2, 0, 0, 0, 5, 1, 1, 1]);
		// Rotate 90° about z, then translate.
		const moving = new Float32Array(ref.length);
		for (let i = 0; i < ref.length; i += 3) {
			moving[i] = -ref[i + 1] + 10;
			moving[i + 1] = ref[i] - 4;
			moving[i + 2] = ref[i + 2] + 2;
		}
		const fit = bestFitRigid(moving, ref, ref.length / 3);
		applyRigidFit(moving, fit);
		for (let i = 0; i < ref.length; i++) expect(moving[i]).toBeCloseTo(ref[i], 4);
	});
});

describe('MeanStructureAccumulator', () => {
	it('averages backbone and base sites over frames', () => {
		const mean = new MeanStructureAccumulator(1);
		mean.add({ backboneNm: new Float32Array([0, 0, 0]), baseNm: new Float32Array([1, 1, 1]) });
		mean.add({ backboneNm: new Float32Array([2, 4, 6]), baseNm: new Float32Array([3, 3, 3]) });
		expect(mean.count).toBe(2);
		const result = mean.result();
		expect([...result.backboneNm]).toEqual([1, 2, 3]);
		expect([...result.baseNm]).toEqual([2, 2, 2]);
	});
});

describe('replay against an exported design', () => {
	const part = loadPart('test_files/fn_designs/10hb_tube.fn.json');
	const exported = exportPartToOxDna(part);
	const top = parseOxDnaTopology(exported.top);

	it('maps every topology row back onto the design', () => {
		const result = matchTopologyToDesign(part, top);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.mapping.nucleotides.length).toBe(exported.nucleotideCount);
		expect(result.mapping.includeMirrors).toBe(false);
	});

	it('refuses a topology from a different design', () => {
		const other = parseOxDnaTopology(
			exportPartToOxDna(loadPart('test_files/fn_designs/nontrivial_uiuc.fn.json')).top
		);
		const result = matchTopologyToDesign(part, other);
		expect(result.ok).toBe(false);
	});

	it('refuses a topology whose links were changed', () => {
		const broken = { ...top, next: top.next.slice() };
		broken.next[0] = 5;
		const result = matchTopologyToDesign(part, broken);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toMatch(/row 0/);
	});

	it('poses the exported configuration back onto the design backbone', () => {
		const result = matchTopologyToDesign(part, top);
		if (!result.ok) throw new Error(result.reason);
		const ref = buildReplayReference(result.mapping.nucleotides);
		const frame = parseOxDnaFrame(exported.dat, exported.nucleotideCount);
		const posed = poseFrame(frame, ref, { alignToDesign: true });
		result.mapping.nucleotides.forEach((nt, i) => {
			expect(posed.backboneNm[i * 3]).toBeCloseTo(nt.positionNm.x - CM_TO_BACKBONE_NM * nt.a1.x, 3);
			expect(posed.backboneNm[i * 3 + 1]).toBeCloseTo(
				nt.positionNm.y - CM_TO_BACKBONE_NM * nt.a1.y,
				3
			);
			expect(posed.backboneNm[i * 3 + 2]).toBeCloseTo(
				nt.positionNm.z - CM_TO_BACKBONE_NM * nt.a1.z,
				3
			);
		});
	});

	it('undoes a strand moved by a whole box length', () => {
		const result = matchTopologyToDesign(part, top);
		if (!result.ok) throw new Error(result.reason);
		const ref = buildReplayReference(result.mapping.nucleotides);
		const frame = parseOxDnaFrame(exported.dat, exported.nucleotideCount);
		const original = frame.data.slice();
		const moved = ref.strandRows.findIndex(
			(rows, s) => s > 0 && rows.some((r) => ref.partnerOf[r] >= 0)
		);
		for (const row of ref.strandRows[moved]) frame.data[row * FRAME_STRIDE + 1] += frame.box[1];
		unwrapStrandsInPlace(frame.data, ref, frame.box);
		for (let i = 0; i < original.length; i++) expect(frame.data[i]).toBeCloseTo(original[i], 3);
	});
});

// Real trajectory from a Foldnano export; untracked (test_files/ref_*), so skipped on CI.
const REF_DIR = join(process.cwd(), 'test_files/ref_oxDNA_reply');
const hasRef = existsSync(join(REF_DIR, 'trajectory_prod-7.dat'));

describe.skipIf(!hasRef)('reference oxDNA trajectory (Atrail-dart)', () => {
	it('matches the design and poses the first frame near it', () => {
		const part = loadPart('test_files/ref_oxDNA_reply/Atrail-dart.fn.json');
		const top = parseOxDnaTopology(readFileSync(join(REF_DIR, 'trajectory_prod-7.top'), 'utf-8'));
		const result = matchTopologyToDesign(part, top);
		if (!result.ok) throw new Error(result.reason);

		const fd = openSync(join(REF_DIR, 'trajectory_prod-7.dat'), 'r');
		const head = new Uint8Array(4 * 1024 * 1024);
		readSync(fd, head, 0, head.length, 0);
		closeSync(fd);
		const starts = scanFrameStarts(head, 0);
		expect(starts.length).toBeGreaterThan(2);
		const text = new TextDecoder().decode(head.subarray(starts[0], starts[1]));
		const frame = parseOxDnaFrame(text, top.nucleotideCount);

		const ref = buildReplayReference(result.mapping.nucleotides);
		const posed = poseFrame(frame, ref, { alignToDesign: true });
		let sum = 0;
		result.mapping.nucleotides.forEach((nt, i) => {
			const dx = posed.backboneNm[i * 3] - (nt.positionNm.x - CM_TO_BACKBONE_NM * nt.a1.x);
			const dy = posed.backboneNm[i * 3 + 1] - (nt.positionNm.y - CM_TO_BACKBONE_NM * nt.a1.y);
			const dz = posed.backboneNm[i * 3 + 2] - (nt.positionNm.z - CM_TO_BACKBONE_NM * nt.a1.z);
			sum += dx * dx + dy * dy + dz * dz;
		});
		const rmsd = Math.sqrt(sum / top.nucleotideCount);
		console.info(`Atrail-dart frame 0 backbone RMSD to design: ${rmsd.toFixed(2)} nm`);
		expect(rmsd).toBeLessThan(10);
	});
});

// An interrupted run: after the second-to-last frame, NUL padding stands in for a lost frame and
// the last header follows it on the same line.
const HMOTOR_DIR = join(REF_DIR, 'HMotor-FN-oxDNA');
const hasHmotor = existsSync(join(HMOTOR_DIR, 'trajectory_prod-5.dat'));

describe.skipIf(!hasHmotor)('reference oxDNA trajectory with an interrupted run (HMotor)', () => {
	it('reads the frames on both sides of the NUL padding', () => {
		const part = loadPart(
			'test_files/ref_oxDNA_reply/HMotor-FN-oxDNA/Hmotor_config_ds_coreadj2sc.json'
		);
		const top = parseOxDnaTopology(
			readFileSync(join(HMOTOR_DIR, 'Hmotor_config_ds_coreadj2sc.top'), 'utf-8')
		);
		const result = matchTopologyToDesign(part, top);
		if (!result.ok) throw new Error(result.reason);

		const path = join(HMOTOR_DIR, 'trajectory_prod-5.dat');
		const fd = openSync(path, 'r');
		const size = fstatSync(fd).size;
		const tailOffset = size - 24 * 1024 * 1024;
		const tail = new Uint8Array(size - tailOffset);
		readSync(fd, tail, 0, tail.length, tailOffset);
		closeSync(fd);

		const starts = scanFrameStarts(tail, tailOffset).map((s) => s - tailOffset);
		const decoder = new TextDecoder();
		const frameText = (k: number) =>
			decoder.decode(tail.subarray(starts[k], starts[k + 1] ?? tail.length));
		const last = starts.length - 1;
		expect(parseOxDnaFrame(frameText(last - 1), top.nucleotideCount).time).toBe(44300000);
		expect(parseOxDnaFrame(frameText(last), top.nucleotideCount).time).toBe(44500000);
	});
});
