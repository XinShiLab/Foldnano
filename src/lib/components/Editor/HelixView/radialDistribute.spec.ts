import { describe, expect, it } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import type { Part } from '$lib/model/Part';
import { addFreeformVh } from '$lib/model/test/testHelpers';
import { SQ_INTERHELIX_NM, isFrameOrthonormal } from '$lib/model/geometry3d/dnaGeometry';
import { planRadialDistribute } from './radialDistribute';

function freeformPart(): Part {
	return new FoldnanoDocument().addNewPart('FREEFORM');
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
	Math.hypot(a.x - b.x, a.y - b.y);

describe('planRadialDistribute', () => {
	it('spaces helices evenly on a ring around their centroid, keeping mean radius and order', () => {
		const part = freeformPart();
		const vhs = [
			addFreeformVh(part, [10, 0, 0]),
			addFreeformVh(part, [0, 9, 0]),
			addFreeformVh(part, [-11, 1, 0]),
			addFreeformVh(part, [1, -10, 0]),
		];
		const plan = planRadialDistribute(vhs)!;
		expect(plan.map(({ vh }) => vh)).toEqual([vhs[3], vhs[0], vhs[1], vhs[2]]);

		const cx = plan.reduce((s, m) => s + m.from.origin.x, 0) / 4;
		const cy = plan.reduce((s, m) => s + m.from.origin.y, 0) / 4;
		const meanR = plan.reduce((s, m) => s + dist(m.from.origin, { x: cx, y: cy }), 0) / 4;
		for (const { to } of plan) {
			expect(dist(to.origin, { x: cx, y: cy })).toBeCloseTo(meanR, 9);
		}
		const sides = plan.map(({ to }, i) => dist(to.origin, plan[(i + 1) % 4].to.origin));
		for (const side of sides) expect(side).toBeCloseTo(sides[0], 9);
		for (const { from, to } of plan) expect(dist(from.origin, to.origin)).toBeLessThan(2);
	});

	it('pushes a cramped ring out to one inter-helix spacing between neighbours', () => {
		const part = freeformPart();
		const vhs = [0, 1, 2, 3, 4, 5].map((i) =>
			addFreeformVh(part, [0.1 * Math.cos(i), 0.1 * Math.sin(i), 0])
		);
		const plan = planRadialDistribute(vhs)!;
		const side = dist(plan[0].to.origin, plan[1].to.origin);
		expect(side).toBeCloseTo(SQ_INTERHELIX_NM, 9);
	});

	it('keeps roll and z by default; faceCenter points radial0 at the centre', () => {
		const part = freeformPart();
		const vhs = [
			addFreeformVh(part, [5, 0, 2]),
			addFreeformVh(part, [-5, 0, 2]),
			addFreeformVh(part, [0, 5, 2]),
		];
		for (const { from, to } of planRadialDistribute(vhs)!) {
			expect(to.radial0).toEqual(from.radial0);
			expect(to.origin.z).toBe(2);
		}
		const facing = planRadialDistribute(vhs, { faceCenter: true })!;
		const cx = 0;
		const cy = 5 / 3;
		for (const { to } of facing) {
			expect(isFrameOrthonormal(to)).toBe(true);
			const toward = { x: cx - to.origin.x, y: cy - to.origin.y };
			const len = Math.hypot(toward.x, toward.y);
			expect(to.radial0.x).toBeCloseTo(toward.x / len, 9);
			expect(to.radial0.y).toBeCloseTo(toward.y / len, 9);
		}
	});

	it('refuses fewer than three helices or any in-plane helix', () => {
		const part = freeformPart();
		const a = addFreeformVh(part, [0, 0, 0]);
		const b = addFreeformVh(part, [5, 0, 0]);
		expect(planRadialDistribute([a, b])).toBeNull();
		const lying = addFreeformVh(part, [0, 5, 0], [1, 0, 0]);
		expect(planRadialDistribute([a, b, lying])).toBeNull();
	});
});
