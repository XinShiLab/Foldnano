import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GizmoDragController, type GizmoTarget } from './gizmoDragController';
import { createTransformGizmo } from './transformGizmo';
import type { PlaneTransform } from '$lib/commands/planes';

const pose = (x: number): PlaneTransform => ({
	origin: { x, y: 0, z: 0 },
	u: { x: 1, y: 0, z: 0 },
	v: { x: 0, y: 1, z: 0 },
	normal: { x: 0, y: 0, z: 1 },
});

describe('GizmoDragController.commit', () => {
	it('puts the target back and frees the camera when the commit is rejected', () => {
		const setControlsEnabled = vi.fn();
		const releasePointer = vi.fn();
		const controller = new GizmoDragController(
			createTransformGizmo(),
			new THREE.Raycaster(),
			setControlsEnabled,
			releasePointer
		);
		let current = pose(5);
		const target: GizmoTarget = {
			readTransform: () => current,
			writeTransform: (t) => (current = t),
			commit: () => {
				throw new Error('read-only');
			},
		};
		// A drag in progress, as `tryStart` would leave it.
		(controller as unknown as { dragState: unknown }).dragState = {
			mode: 'translate',
			axis: 'x',
			target,
			startTransform: pose(0),
			dragPlane: new THREE.Plane(),
			startIntersect: new THREE.Vector3(),
			worldAxis: new THREE.Vector3(1, 0, 0),
		};

		expect(() => controller.commit()).toThrow('read-only');
		expect(current.origin.x).toBe(0);
		expect(controller.isActive).toBe(false);
		expect(setControlsEnabled).toHaveBeenCalledWith(true);
		expect(releasePointer).toHaveBeenCalled();
	});
});
