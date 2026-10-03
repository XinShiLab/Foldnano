import * as THREE from 'three';
import { disposeMeshChildren } from './threeUtils';

export interface PlaneSelectorResult {
	/** Add to the scene once; update() rebuilds meshes in-place. */
	group: THREE.Group;
	update(options: {
		inSelectionMode: boolean;
		activePlane: 'XY' | 'XZ' | 'YZ' | null;
		regionKind: string | null;
	}): void;
	dispose(): void;
}

const PLANE_KIND_COLORS: Record<string, number> = {
	HONEYCOMB: 0x3b82f6,
	SQUARE: 0x22c55e,
	FREEFORM: 0xa855f7,
};
const DEFAULT_COLOR = 0x3b82f6;
const INACTIVE_COLOR = 0x888888;

const SIZE = 20;
const SEGS = 5;
const PLANE_DEFS: { key: 'XY' | 'XZ' | 'YZ'; rotateAxis: THREE.Vector3 | null; angle: number }[] = [
	{ key: 'XY', rotateAxis: null, angle: 0 },
	{ key: 'XZ', rotateAxis: new THREE.Vector3(1, 0, 0), angle: -Math.PI / 2 },
	{ key: 'YZ', rotateAxis: new THREE.Vector3(0, 1, 0), angle: Math.PI / 2 },
];

export function createPlaneSelector(): PlaneSelectorResult {
	const group = new THREE.Group();

	function update({
		inSelectionMode,
		activePlane,
		regionKind,
	}: {
		inSelectionMode: boolean;
		activePlane: 'XY' | 'XZ' | 'YZ' | null;
		regionKind: string | null;
	}): void {
		disposeMeshChildren(group);
		group.visible = inSelectionMode;
		if (!inSelectionMode) return;

		const kindColor = PLANE_KIND_COLORS[regionKind ?? 'HONEYCOMB'] ?? DEFAULT_COLOR;

		for (const { key, rotateAxis, angle } of PLANE_DEFS) {
			const isActive = key === activePlane;
			const color = isActive ? kindColor : INACTIVE_COLOR;

			const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEGS, SEGS);
			const mat = new THREE.MeshBasicMaterial({
				color,
				transparent: true,
				opacity: isActive ? 0.22 : 0.06,
				side: THREE.DoubleSide,
				depthWrite: false,
			});
			const mesh = new THREE.Mesh(geo, mat);
			if (rotateAxis) mesh.rotateOnAxis(rotateAxis, angle);

			const wireMat = new THREE.MeshBasicMaterial({
				color,
				transparent: true,
				opacity: isActive ? 0.45 : 0.12,
				wireframe: true,
				depthWrite: false,
			});
			const wireMesh = new THREE.Mesh(geo.clone(), wireMat);
			if (rotateAxis) wireMesh.rotateOnAxis(rotateAxis, angle);

			group.add(mesh);
			group.add(wireMesh);
		}
	}

	function dispose(): void {
		disposeMeshChildren(group);
	}

	return { group, update, dispose };
}
