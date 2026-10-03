import { addLatticeVh } from '$lib/model/test/testHelpers';
import { describe, expect, it } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import {
	canBatchMoveToTargets,
	planEndAlignment,
} from '$lib/canvasEditor/tools/select/handlers/endAlignmentOps';

function createPartWithVhs(count = 2) {
	const doc = new FoldnanoDocument();
	const part = doc.addNewPart('HONEYCOMB');
	const vhs = Array.from({ length: count }, (_, row) => addLatticeVh(part, 0, row));
	return { part, vhs };
}

describe('end alignment planning', () => {
	it('aligns selected free ends left to the minimum bp index', () => {
		const { part, vhs } = createPartWithVhs();
		const left = Array.from(part.createOligo(vhs[0], 5, 10).segments)[0];
		const right = Array.from(part.createOligo(vhs[1], 15, 20).segments)[0];

		const plan = planEndAlignment('left', [left.fivePrime, right.fivePrime]);

		expect(plan).toEqual([{ end: right.fivePrime, toIdx: 5 }]);
	});

	it('aligns selected free ends right to the maximum bp index', () => {
		const { part, vhs } = createPartWithVhs();
		const left = Array.from(part.createOligo(vhs[0], 5, 10).segments)[0];
		const right = Array.from(part.createOligo(vhs[1], 15, 20).segments)[0];

		const plan = planEndAlignment('right', [left.threePrime, right.threePrime]);

		expect(plan).toEqual([{ end: left.threePrime, toIdx: 20 }]);
	});

	it('aligns one-sided left-end selections to the right', () => {
		const { part, vhs } = createPartWithVhs();
		const left = Array.from(part.createOligo(vhs[0], 5, 30).segments)[0];
		const right = Array.from(part.createOligo(vhs[1], 15, 35).segments)[0];

		const plan = planEndAlignment('right', [left.fivePrime, right.fivePrime]);

		expect(plan).toEqual([{ end: left.fivePrime, toIdx: 15 }]);
	});

	it('aligns one-sided right-end selections to the left', () => {
		const { part, vhs } = createPartWithVhs();
		const left = Array.from(part.createOligo(vhs[0], 5, 30).segments)[0];
		const right = Array.from(part.createOligo(vhs[1], 15, 35).segments)[0];

		const plan = planEndAlignment('left', [left.threePrime, right.threePrime]);

		expect(plan).toEqual([{ end: right.threePrime, toIdx: 30 }]);
	});

	it('only moves the left end for Align Left when both segment ends are selected', () => {
		const { part, vhs } = createPartWithVhs();
		const segment = Array.from(part.createOligo(vhs[0], 10, 20).segments)[0];
		const target = Array.from(part.createOligo(vhs[1], 5, 15).segments)[0];

		const plan = planEndAlignment('left', [
			segment.fivePrime,
			segment.threePrime,
			target.fivePrime,
		]);

		expect(plan).toEqual([{ end: segment.fivePrime, toIdx: 5 }]);
	});

	it('only moves the right end for Align Right when both segment ends are selected', () => {
		const { part, vhs } = createPartWithVhs();
		const segment = Array.from(part.createOligo(vhs[0], 10, 20).segments)[0];
		const target = Array.from(part.createOligo(vhs[1], 5, 25).segments)[0];

		const plan = planEndAlignment('right', [
			segment.fivePrime,
			segment.threePrime,
			target.threePrime,
		]);

		expect(plan).toEqual([{ end: segment.threePrime, toIdx: 25 }]);
	});

	it('classifies reversed strand-set left and right by bp index', () => {
		const { part, vhs } = createPartWithVhs();
		const reversed = Array.from(part.createOligo(vhs[0], 30, 20).segments)[0];
		const target = Array.from(part.createOligo(vhs[1], 15, 5).segments)[0];

		const leftPlan = planEndAlignment('left', [
			reversed.fivePrime,
			reversed.threePrime,
			target.threePrime,
		]);
		const rightPlan = planEndAlignment('right', [
			reversed.fivePrime,
			reversed.threePrime,
			target.fivePrime,
		]);

		expect(leftPlan).toEqual([{ end: reversed.threePrime, toIdx: 5 }]);
		expect(rightPlan).toEqual([{ end: target.fivePrime, toIdx: 30 }]);
	});

	it('justifies left free ends to the minimum and right free ends to the maximum', () => {
		const { part, vhs } = createPartWithVhs();
		const left = Array.from(part.createOligo(vhs[0], 5, 10).segments)[0];
		const right = Array.from(part.createOligo(vhs[1], 15, 20).segments)[0];

		const plan = planEndAlignment('justify', [
			left.fivePrime,
			left.threePrime,
			right.fivePrime,
			right.threePrime,
		]);

		expect(plan).toEqual([
			{ end: right.fivePrime, toIdx: 5 },
			{ end: left.threePrime, toIdx: 20 },
		]);
	});

	it('does not justify one-sided end selections', () => {
		const { part, vhs } = createPartWithVhs();
		const left = Array.from(part.createOligo(vhs[0], 5, 10).segments)[0];
		const right = Array.from(part.createOligo(vhs[1], 15, 20).segments)[0];

		const leftOnlyPlan = planEndAlignment('justify', [left.fivePrime, right.fivePrime]);
		const rightOnlyPlan = planEndAlignment('justify', [left.threePrime, right.threePrime]);

		expect(leftOnlyPlan).toBeNull();
		expect(rightOnlyPlan).toBeNull();
	});

	it('ignores connected ends and rejects invalid overlapping batches', () => {
		const { part, vhs } = createPartWithVhs();
		const oligoA = part.createOligo(vhs[0], 0, 20);
		const oligoB = part.createOligo(vhs[1], 20, 0);
		const connectedSegment = Array.from(oligoB.segments)[0];
		part.createCrossover(oligoA, oligoB, connectedSegment, 10);

		const freeLeft = Array.from(part.createOligo(vhs[0], 25, 28).segments)[0];
		const freeRight = Array.from(part.createOligo(vhs[1], 30, 35).segments)[0];
		const connectedEnd = Array.from(oligoA.segments).find(
			(segment) => !segment.threePrime.isFree
		)!.threePrime;

		const plan = planEndAlignment('left', [connectedEnd, freeLeft.fivePrime, freeRight.fivePrime]);

		expect(plan).toEqual([{ end: freeRight.fivePrime, toIdx: 25 }]);

		const blockerA = Array.from(part.createOligo(vhs[0], 32, 35).segments)[0];
		const blockerB = Array.from(part.createOligo(vhs[0], 37, 40).segments)[0];

		expect(
			canBatchMoveToTargets([
				{ end: blockerA.threePrime, toIdx: 40 },
				{ end: blockerB.threePrime, toIdx: 40 },
			])
		).toBe(false);
	});
});
