import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import FoldnanoDocument from '$lib/model/document.svelte';
import { makeHoneycombPart, addLatticeVh } from '$lib/model/test/testHelpers';
import { buildBlocksAndConstraints, UNCONSTRAINED_CROSSOVER_REST_LENGTH_NM } from './buildBlocks';
import { solveBlockLayout } from './rbsEngine';
import type { BlockBody } from './rbsTypes';

describe('block-based RBS topology', () => {
	it('assigns the tetrahedral fixture into 6 blocks', () => {
		const raw = JSON.parse(
			readFileSync(
				join(process.cwd(), 'test_files/internal_cadnano_designs/test_tetrahedral2.fn.json'),
				'utf8'
			)
		);
		const doc = FoldnanoDocument.fromJSON(raw);
		const result = buildBlocksAndConstraints(doc.parts[0]);

		expect(result.blocks).toHaveLength(6);
	});

	it('welds constrained crossovers and emits no elastic constraint for them', () => {
		const part = makeHoneycombPart('constrained');
		const vhA = addLatticeVh(part, 0, 0);
		const vhB = addLatticeVh(part, 1, 0);
		const site = part
			.potentialXoverSites(vhA.index)[0]
			.find((s) => s.toVhIdx === vhB.index && s.bpIdx >= 6);
		expect(site).toBeTruthy();

		const a = part.createOligo(vhA, site!.bpIdx - 5, site!.bpIdx);
		const b = part.createOligo(vhB, site!.bpIdx, site!.bpIdx - 5);
		const segA = [...a.segments][0];
		const segB = [...b.segments][0];
		segA.threePrime.connectTo(segB.fivePrime);

		const result = buildBlocksAndConstraints(part);

		expect(segA.threePrime.isConstrained).toBe(true);
		expect(result.blocks).toHaveLength(1);
		expect(result.constraints).toHaveLength(0);
	});

	it('keeps unconstrained crossovers elastic with a 0.6 nm rest length', () => {
		const part = makeHoneycombPart('unconstrained');
		const vhA = addLatticeVh(part, 0, 0);
		const vhB = addLatticeVh(part, 8, 8);
		const a = part.createOligo(vhA, 0, 10);
		const b = part.createOligo(vhB, 10, 0);
		const segA = [...a.segments][0];
		const segB = [...b.segments][0];
		segA.threePrime.connectTo(segB.fivePrime);

		const result = buildBlocksAndConstraints(part);

		expect(segA.threePrime.isConstrained).toBe(false);
		expect(result.blocks).toHaveLength(2);
		expect(result.constraints).toHaveLength(1);
		expect(result.constraints[0].restLength).toBe(UNCONSTRAINED_CROSSOVER_REST_LENGTH_NM);
	});

	it('welds same-VH complementary occupied segments into one block', () => {
		const part = makeHoneycombPart('duplex');
		const vh = addLatticeVh(part, 0, 0);
		part.createOligo(vh, 0, 10);
		part.createOligo(vh, 10, 0);

		const result = buildBlocksAndConstraints(part);

		expect(result.blocks).toHaveLength(1);
	});

	it('keeps one continuous OligoSegment in one block', () => {
		const part = makeHoneycombPart('segment');
		const vh = addLatticeVh(part, 0, 0);
		const oligo = part.createOligo(vh, 0, 20);
		const seg = [...oligo.segments][0];

		const result = buildBlocksAndConstraints(part);

		expect(result.segmentToBlockId.get(seg.id)).toBe(result.blocks[0].blockId);
		expect(result.blocks).toHaveLength(1);
	});
});

describe('block-based RBS solver', () => {
	it('converges a single unconstrained crossover toward 0.6 nm', () => {
		const part = makeHoneycombPart('solver');
		const vhA = addLatticeVh(part, 0, 0);
		const vhB = addLatticeVh(part, 8, 8);
		const a = part.createOligo(vhA, 0, 10);
		const b = part.createOligo(vhB, 10, 0);
		[...a.segments][0].threePrime.connectTo([...b.segments][0].fivePrime);
		const built = buildBlocksAndConstraints(part);

		const solved = solveBlockLayout(built.blocks, built.constraints, {
			iterations: 1200,
			collisionPasses: 0,
		});

		expect(solved.maxConstraintError).toBeLessThan(0.05);
	});

	it('rotates blocks when springs act away from the center of mass', () => {
		const part = makeHoneycombPart('rotation');
		const vhA = addLatticeVh(part, 0, 0);
		const vhB = addLatticeVh(part, 8, 8);
		const a = part.createOligo(vhA, 0, 20);
		const b = part.createOligo(vhB, 20, 0);
		[...a.segments][0].threePrime.connectTo([...b.segments][0].fivePrime);
		const built = buildBlocksAndConstraints(part);

		const solved = solveBlockLayout(built.blocks, built.constraints, {
			iterations: 1200,
			collisionPasses: 0,
		});
		const q = [...solved.transforms.values()][0].quaternion;

		expect(Math.abs(q.x) + Math.abs(q.y) + Math.abs(q.z)).toBeGreaterThan(0.001);
	});

	it('separates overlapping block spans', () => {
		const makeBlock = (blockId: string): BlockBody => ({
			blockId,
			spans: [
				{
					spanId: `${blockId}-span`,
					vhIndex: 0,
					rowIdx: 0,
					strandIdx: 0,
					lo: 0,
					hi: 10,
					segmentIds: [`${blockId}-seg`],
				},
			],
			collisionCapsules: [
				{
					id: `${blockId}-cap`,
					vhIndex: 0,
					lo: 0,
					hi: 10,
					localStart: { x: 0, y: 0, z: -1 },
					localEnd: { x: 0, y: 0, z: 1 },
					radius: 1,
				},
			],
			originalCenter: { x: 0, y: 0, z: 0 },
			position: { x: 0, y: 0, z: 0 },
			quaternion: { x: 0, y: 0, z: 0, w: 1 },
			mass: 1,
			inertia: { x: 1, y: 1, z: 1 },
			radius: 2,
		});

		const solved = solveBlockLayout([makeBlock('B1'), makeBlock('B2')], [], {
			iterations: 4,
			collisionPasses: 4,
		});

		expect(solved.maxOverlap).toBeLessThan(0.001);
	});

	it('is deterministic for the same block input', () => {
		const part = makeHoneycombPart('deterministic');
		const vhA = addLatticeVh(part, 0, 0);
		const vhB = addLatticeVh(part, 8, 8);
		const a = part.createOligo(vhA, 0, 10);
		const b = part.createOligo(vhB, 10, 0);
		[...a.segments][0].threePrime.connectTo([...b.segments][0].fivePrime);
		const built = buildBlocksAndConstraints(part);

		const first = solveBlockLayout(built.blocks, built.constraints).transforms;
		const second = solveBlockLayout(built.blocks, built.constraints).transforms;

		expect(first).toEqual(second);
	});
});
