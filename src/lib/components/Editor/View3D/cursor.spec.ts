import { describe, expect, it } from 'vitest';
import { addFreeformVh, makeFreeformPart } from '$lib/model/test/testHelpers';
import { helixCenterPoint } from '$lib/model/geometry3d/dnaGeometry';
import { cursorGeometry } from './cursor';

function ringPoints(rings: Float32Array): [number, number, number][] {
	const out: [number, number, number][] = [];
	for (let i = 0; i < rings.length; i += 3) out.push([rings[i], rings[i + 1], rings[i + 2]]);
	return out;
}

describe('cursorGeometry', () => {
	it('rings each helix at the cursor base along its own axis, not world Z', () => {
		const part = makeFreeformPart();
		const vh = addFreeformVh(part, [1, 2, 3], [1, 0, 0]);
		const regionId = part.getDefaultRegion().id;
		const bp = 10;
		const { rings } = cursorGeometry(part, regionId, bp);
		expect(rings.length).toBeGreaterThan(0);

		const frame = part.getVirtualHelixFrame(vh);
		const c = helixCenterPoint(frame, bp);
		expect(c.x).toBeGreaterThan(frame.origin.x); // moved along +X, the helix axis
		const radii = new Set<string>();
		for (const [x, y, z] of ringPoints(rings)) {
			const d = [x - c.x, y - c.y, z - c.z];
			// Every ring point lies across the axis, at one radius from the centre.
			expect(d[0] * frame.axis.x + d[1] * frame.axis.y + d[2] * frame.axis.z).toBeCloseTo(0, 5);
			radii.add(Math.hypot(...d).toFixed(4));
		}
		expect(radii.size).toBe(1);
	});

	it('marks covered strands on their backbones and skips helices the cursor is past', () => {
		const part = makeFreeformPart();
		const vh = addFreeformVh(part, [0, 0, 0], [0, 1, 0]);
		part.createOligo(vh, 0, 20, '#ff0000');
		const regionId = part.getDefaultRegion().id;

		const at5 = cursorGeometry(part, regionId, 5);
		expect(at5.markers).toHaveLength(1);
		const c = helixCenterPoint(part.getVirtualHelixFrame(vh), 5);
		const m = at5.markers[0];
		expect(Math.hypot(m.x - c.x, m.y - c.y, m.z - c.z)).toBeGreaterThan(0.5);
		expect(m.y).toBeCloseTo(c.y, 5); // on the cross-section through the axis at that base

		expect(cursorGeometry(part, regionId, 30).markers).toHaveLength(0);
		const past = cursorGeometry(part, regionId, vh.length);
		expect(past.rings.length).toBe(0);
	});

	it('shows nothing without a cursor region, and nothing for other regions', () => {
		const part = makeFreeformPart();
		addFreeformVh(part, [0, 0, 0]);
		expect(cursorGeometry(part, null, 3).rings.length).toBe(0);
		expect(cursorGeometry(part, 'some-other-region', 3).rings.length).toBe(0);
	});
});
