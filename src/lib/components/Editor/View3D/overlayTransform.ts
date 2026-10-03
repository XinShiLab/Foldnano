import * as THREE from 'three';
import type { ExternalStructureOverlay, OverlayBounds } from './externalStructureOverlay';

/**
 * Live placement of an external-structure overlay instance — view state the gizmo
 * writes during a drag. The transform object itself is not stored; for PDB the
 * final pose is persisted as a per-instance placement record
 * (`Part.overlayPlacements`: a unique instance `id` plus a `sourceKey` =
 * `overlayPlacementKey` → pdbId/filename that links copies of one structure).
 * mrDNA overlays have a null key and stay session-only.
 */
export interface OverlayTransform {
	position: { x: number; y: number; z: number };
	/** x, y, z, w */
	quaternion: [number, number, number, number];
}

export function identityOverlayTransform(): OverlayTransform {
	return { position: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] };
}

export function cloneOverlayTransform(t: OverlayTransform): OverlayTransform {
	return {
		position: { ...t.position },
		quaternion: [...t.quaternion] as [number, number, number, number],
	};
}

/**
 * Stable key for persisting an overlay's placement. PDB only (mrDNA is never
 * remembered): the RCSB accession when present, else the filename.
 */
export function overlayPlacementKey(overlay: ExternalStructureOverlay): string | null {
	return overlay.format === 'pdb' ? (overlay.pdbId ?? overlay.name) : null;
}

export function overlayTransformsEqual(a: OverlayTransform, b: OverlayTransform): boolean {
	return (
		a.position.x === b.position.x &&
		a.position.y === b.position.y &&
		a.position.z === b.position.z &&
		a.quaternion[0] === b.quaternion[0] &&
		a.quaternion[1] === b.quaternion[1] &&
		a.quaternion[2] === b.quaternion[2] &&
		a.quaternion[3] === b.quaternion[3]
	);
}

export function applyOverlayTransform(object: THREE.Object3D, t: OverlayTransform): void {
	object.position.set(t.position.x, t.position.y, t.position.z);
	object.quaternion.set(t.quaternion[0], t.quaternion[1], t.quaternion[2], t.quaternion[3]);
}

/** World-space AABB of `bounds` after applying `t` (8-corner transform). */
export function transformedBoundsBox(bounds: OverlayBounds, t: OverlayTransform): THREE.Box3 {
	const q = new THREE.Quaternion(
		t.quaternion[0],
		t.quaternion[1],
		t.quaternion[2],
		t.quaternion[3]
	);
	const offset = new THREE.Vector3(t.position.x, t.position.y, t.position.z);
	const box = new THREE.Box3();
	const corner = new THREE.Vector3();
	const { min, max } = bounds;
	for (const x of [min.x, max.x]) {
		for (const y of [min.y, max.y]) {
			for (const z of [min.z, max.z]) {
				corner.set(x, y, z).applyQuaternion(q).add(offset);
				box.expandByPoint(corner);
			}
		}
	}
	return box;
}
