import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { ReferenceMesh } from '$lib/model/Part/DesignRegion';
import { createReferenceMeshOverlay } from './referenceMeshOverlay';

const SQUARE: ReferenceMesh = {
	vertices: [
		[0, 0, 0],
		[10, 0, 0],
		[10, 20, 0],
		[0, 20, 0],
	],
	faces: [[0, 1, 2, 3]],
	edges: [],
};
const XY = {
	origin: { x: 0, y: 0, z: 0 },
	u: { x: 1, y: 0, z: 0 },
	v: { x: 0, y: 1, z: 0 },
	normal: { x: 0, y: 0, z: 1 },
};
// XZ-style plane, moved: U stays X, V becomes Z, W becomes -Y.
const MOVED = {
	origin: { x: 100, y: 0, z: 0 },
	u: { x: 1, y: 0, z: 0 },
	v: { x: 0, y: 0, z: 1 },
	normal: { x: 0, y: -1, z: 0 },
};

describe('reference mesh overlay', () => {
	it('draws edges and a fan of triangles', () => {
		const overlay = createReferenceMeshOverlay();
		overlay.update([{ key: 'r', mesh: SQUARE, plane: XY }]);

		const [drawn] = overlay.group.children;
		const [lines, faces] = drawn.children as THREE.Mesh[];
		expect(lines.geometry.index?.count).toBe(8);
		expect(Array.from(faces.geometry.index!.array)).toEqual([0, 1, 2, 0, 2, 3]);
	});

	it('places the mesh through the plane without rebuilding it', () => {
		const overlay = createReferenceMeshOverlay();
		overlay.update([{ key: 'r', mesh: SQUARE, plane: XY }]);
		const drawn = overlay.group.children[0];

		overlay.update([{ key: 'r', mesh: SQUARE, plane: MOVED }]);

		expect(overlay.group.children[0]).toBe(drawn);
		const box = overlay.boundsOf('r')!;
		expect(box.min.toArray()).toEqual([100, 0, 0]);
		expect(box.max.toArray()).toEqual([110, 0, 20]);
	});

	it('rebuilds when the mesh changes and drops items no longer listed', () => {
		const overlay = createReferenceMeshOverlay();
		overlay.update([{ key: 'r', mesh: SQUARE, plane: XY }]);
		const drawn = overlay.group.children[0];

		overlay.update([{ key: 'r', mesh: { ...SQUARE }, plane: XY }]);
		expect(overlay.group.children[0]).not.toBe(drawn);

		overlay.update([]);
		expect(overlay.group.children).toHaveLength(0);
		expect(overlay.boundsOf('r')).toBeNull();
		expect(overlay.bounds().isEmpty()).toBe(true);
	});

	it('draws a mesh that has only edges', () => {
		const overlay = createReferenceMeshOverlay();
		overlay.update([
			{ key: 'r', mesh: { vertices: SQUARE.vertices, faces: [], edges: [[0, 2]] }, plane: XY },
		]);

		expect(overlay.group.children[0].children).toHaveLength(1);
	});
});
