import { describe, expect, it } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import { computeSimulationFreshnessSignature } from './view3dSimulationState';

describe('computeSimulationFreshnessSignature', () => {
	it('changes when a plane transform changes', () => {
		const doc = new FoldnanoDocument('doc-1', 'View3D signature test');
		const part = doc.addNewPart('HONEYCOMB');
		const plane = part.getDefaultPlane();

		const before = computeSimulationFreshnessSignature(part);
		part.setPlaneTransform(plane.id, {
			origin: { x: plane.origin.x + 10, y: plane.origin.y, z: plane.origin.z },
			u: plane.u,
			v: plane.v,
			normal: plane.normal,
		});
		const after = computeSimulationFreshnessSignature(part);

		expect(after).not.toBe(before);
	});
});
