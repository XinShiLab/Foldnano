import { describe, expect, it } from 'vitest';
import { BACKBONE_RISE_NM, type VirtualHelixFrame } from '$lib/model/geometry3d/dnaGeometry';
import { depthFadeOpacity, helixDepthW } from './planeDepthFade';

const frame = (originW: number, axisW: number): VirtualHelixFrame => ({
	origin: { x: 0, y: 0, z: originW },
	axis: { x: Math.sqrt(1 - axisW * axisW), y: 0, z: axisW },
	radial0: { x: 0, y: 1, z: 0 },
});

describe('depthFadeOpacity', () => {
	it('makes the most negative W solid and the most positive W the faintest', () => {
		expect(depthFadeOpacity(-10, -10, 10)).toBe(1);
		const middle = depthFadeOpacity(0, -10, 10);
		const far = depthFadeOpacity(10, -10, 10);
		expect(far).toBeGreaterThan(0);
		expect(far).toBeLessThan(middle);
		expect(middle).toBeLessThan(1);
	});

	it('leaves helices at one depth solid', () => {
		expect(depthFadeOpacity(3, 3, 3)).toBe(1);
	});
});

describe('helixDepthW', () => {
	it('uses the middle of the dsDNA, not of the whole virtual helix', () => {
		const w = helixDepthW(frame(5, 1), [
			{ lowIndex: 10, highIndex: 20 },
			{ lowIndex: 30, highIndex: 50 },
		]);
		expect(w).toBeCloseTo(5 + 30 * BACKBONE_RISE_NM);
	});

	it('follows the axis direction, so a helix running toward the viewer gets nearer', () => {
		const w = helixDepthW(frame(5, -1), [{ lowIndex: 0, highIndex: 20 }]);
		expect(w).toBeCloseTo(5 - 10 * BACKBONE_RISE_NM);
	});

	it('ignores W along an in-plane helix and uses the origin of an empty one', () => {
		expect(helixDepthW(frame(5, 0), [{ lowIndex: 0, highIndex: 20 }])).toBeCloseTo(5);
		expect(helixDepthW(frame(5, 1), [])).toBe(5);
	});
});
