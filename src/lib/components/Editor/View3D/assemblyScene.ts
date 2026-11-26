import * as THREE from 'three';
import type { OccurrenceTransform } from '$lib/model/Assembly';

// The 3D view draws the active Part inside one group placed at its instance's transform, so every
// Part-space helper (strands, planes, cursor, overlays, picking) keeps working in Part coordinates.
// Other Parts and the active Part's other instances are copies drawn in lab space around it.

/** Name of the VH label group inside a built scene; instance copies leave it out. */
export const LABELS_NAME = 'vh-labels';
/** Name of the cylinder group inside a built scene; double-click picks instances by it. */
export const CYLINDERS_NAME = 'vh-cylinders';
/** Opacity factor for Parts other than the active one. */
export const GHOST_OPACITY = 0.3;

export function applyOccurrencePose(object: THREE.Object3D, t: OccurrenceTransform): void {
	object.position.set(t.position.x, t.position.y, t.position.z);
	object.quaternion.set(t.quaternion[0], t.quaternion[1], t.quaternion[2], t.quaternion[3]);
	object.updateMatrix();
	object.updateMatrixWorld(true);
}

/** Part space → lab space for an instance placed at `t`. */
export function occurrenceMatrix(
	t: OccurrenceTransform | null | undefined,
	out = new THREE.Matrix4()
): THREE.Matrix4 {
	if (!t) return out.identity();
	return out.compose(
		new THREE.Vector3(t.position.x, t.position.y, t.position.z),
		new THREE.Quaternion(t.quaternion[0], t.quaternion[1], t.quaternion[2], t.quaternion[3]),
		new THREE.Vector3(1, 1, 1)
	);
}

/**
 * A lighter, see-through copy look for a group whose materials it owns (a ghost Part's own build).
 * Never call it on the active Part's group: instance copies share those materials.
 */
export function ghostifyGroup(group: THREE.Object3D, opacity = GHOST_OPACITY): void {
	const seen = new Set<THREE.Material>();
	group.traverse((object) => {
		const material = (object as THREE.Mesh).material;
		if (!material) return;
		for (const m of Array.isArray(material) ? material : [material]) {
			if (seen.has(m)) continue;
			seen.add(m);
			m.transparent = true;
			m.opacity = (m.opacity ?? 1) * opacity;
			m.depthWrite = false;
			m.needsUpdate = true;
		}
	});
}

/**
 * A copy of `template` placed at `t`, sharing its geometry and materials (so the template owns
 * disposal), without VH labels. `occurrenceId` lets a double-click find the instance.
 */
export function instanceCopy(
	template: THREE.Object3D,
	t: OccurrenceTransform,
	occurrenceId: string
): THREE.Object3D {
	const copy = template.clone(true);
	copy.getObjectByName(LABELS_NAME)?.removeFromParent();
	copy.matrixAutoUpdate = true;
	copy.visible = true; // the template may be hidden (the edited instance's eye is off)
	copy.userData.occurrenceId = occurrenceId;
	applyOccurrencePose(copy, t);
	return copy;
}

/** Occurrence id of the instance copy that owns `object`, if any. */
export function occurrenceIdOf(object: THREE.Object3D | null): string | null {
	for (let o = object; o; o = o.parent) {
		if (typeof o.userData.occurrenceId === 'string') return o.userData.occurrenceId;
	}
	return null;
}
