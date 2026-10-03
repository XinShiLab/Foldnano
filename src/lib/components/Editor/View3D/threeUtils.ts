import * as THREE from 'three';
import type { PlaneTransform } from '$lib/commands/planes';

/** Recursively dispose geometry + material on every Mesh, Line, and Sprite in a group. */
export function disposeGroup(group: THREE.Group): void {
	group.traverse((obj) => {
		if (obj instanceof THREE.Mesh || (obj as { isLine?: boolean }).isLine) {
			(obj as THREE.Mesh).geometry?.dispose();
			const mat = (obj as THREE.Mesh).material;
			if (Array.isArray(mat)) mat.forEach((m) => (m as THREE.Material).dispose());
			else (mat as THREE.Material)?.dispose();
		} else if (obj instanceof THREE.Sprite) {
			obj.material.map?.dispose();
			obj.material.dispose();
		}
	});
}

/** Dispose geometry + material for every direct Mesh child of a group, then clear it. */
export function disposeMeshChildren(group: THREE.Group): void {
	for (const child of [...group.children]) {
		if (child instanceof THREE.Mesh) {
			child.geometry.dispose();
			(child.material as THREE.Material).dispose();
		}
	}
	group.clear();
}

/** Trigger a browser download for a data URL or blob URL. */
export function downloadFile(url: string, filename: string): void {
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	link.style.display = 'none';
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
}

/** Shallow-clone a PlaneTransform (each vec3 field is spread). */
export function clonePlaneTransform(t: PlaneTransform): PlaneTransform {
	return {
		origin: { ...t.origin },
		u: { ...t.u },
		v: { ...t.v },
		normal: { ...t.normal },
	};
}
