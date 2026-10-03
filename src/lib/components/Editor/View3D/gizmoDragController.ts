import * as THREE from 'three';
import type { Part } from '$lib/model/Part';
import type { HistoryStack } from '$lib/commands/history.svelte';
import { transformPlaneCmd, type PlaneTransform } from '$lib/commands/planes';
import {
	quaternionFromPlaneBasis,
	type GizmoMode,
	type TransformGizmoResult,
} from './transformGizmo';
import type { PlaneOverlayResult } from './planeOverlay';
import { clonePlaneTransform } from './threeUtils';
import type { OverlayTransform } from './overlayTransform';

/**
 * What the gizmo edits. The drag math works in `PlaneTransform` (origin + u/v/normal
 * basis) terms; each target converts to/from its own storage and decides whether a
 * commit records history.
 */
export interface GizmoTarget {
	/** Current pose, or null if the target no longer exists. */
	readTransform(): PlaneTransform | null;
	/** Apply a pose live during drag — no history. */
	writeTransform(t: PlaneTransform): void;
	/** Persist the drag. Plane → history command; transient overlay → no-op. */
	commit(start: PlaneTransform, end: PlaneTransform): void;
}

/** Persisted, undoable design plane. */
export class PlaneGizmoTarget implements GizmoTarget {
	constructor(
		private part: Part,
		private planeId: string,
		private historyStack: HistoryStack,
		private overlay: PlaneOverlayResult
	) {}

	readTransform(): PlaneTransform | null {
		const plane = this.part.getPlaneById(this.planeId);
		return plane ? clonePlaneTransform(plane) : null;
	}

	writeTransform(t: PlaneTransform): void {
		this.part.setPlaneTransform(this.planeId, t);
		const plane = this.part.getPlaneById(this.planeId);
		if (plane) this.overlay.updatePosePlaneMesh(this.planeId, plane);
	}

	commit(start: PlaneTransform, end: PlaneTransform): void {
		transformPlaneCmd(this.historyStack, this.part, this.planeId, start, end);
	}
}

/**
 * External-structure overlay placement. The transform itself is transient (live
 * during drag), but `onCommit` lets the caller persist the final pose on drag end
 * (e.g. remembering a PDB's placement).
 */
export class OverlayGizmoTarget implements GizmoTarget {
	constructor(
		private getTransform: () => OverlayTransform,
		private setTransform: (t: OverlayTransform) => void,
		private onCommit?: () => void
	) {}

	readTransform(): PlaneTransform {
		const t = this.getTransform();
		const q = new THREE.Quaternion(
			t.quaternion[0],
			t.quaternion[1],
			t.quaternion[2],
			t.quaternion[3]
		);
		const u = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
		const v = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
		const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
		return {
			origin: { ...t.position },
			u: { x: u.x, y: u.y, z: u.z },
			v: { x: v.x, y: v.y, z: v.z },
			normal: { x: normal.x, y: normal.y, z: normal.z },
		};
	}

	writeTransform(t: PlaneTransform): void {
		const q = quaternionFromPlaneBasis(t.u, t.v, t.normal);
		this.setTransform({
			position: { x: t.origin.x, y: t.origin.y, z: t.origin.z },
			quaternion: [q.x, q.y, q.z, q.w],
		});
	}

	commit(): void {
		this.onCommit?.();
	}
}

type DragState = {
	mode: GizmoMode;
	axis: 'x' | 'y' | 'z';
	target: GizmoTarget;
	startTransform: PlaneTransform;
	dragPlane: THREE.Plane;
	startIntersect: THREE.Vector3;
	worldAxis: THREE.Vector3;
};

export class GizmoDragController {
	private dragState: DragState | null = null;

	constructor(
		private gizmo: TransformGizmoResult,
		private raycaster: THREE.Raycaster,
		/** Called with false to disable controls at drag start, true to re-enable on end. */
		private setControlsEnabled: (enabled: boolean) => void,
		/** Called to release pointer capture when drag ends. */
		private releasePointer: () => void
	) {}

	get isActive(): boolean {
		return this.dragState !== null;
	}

	/** Sync gizmo position + quaternion to the target's current pose. */
	syncPose(target: GizmoTarget): void {
		const t = target.readTransform();
		if (!t) return;
		this.gizmo.setPosition(new THREE.Vector3(t.origin.x, t.origin.y, t.origin.z));
		this.gizmo.setQuaternion(quaternionFromPlaneBasis(t.u, t.v, t.normal));
	}

	/**
	 * Try to start a gizmo drag from the current mouse position.
	 * Returns true if a handle was hit and drag has begun.
	 */
	tryStart(
		target: GizmoTarget,
		gizmoMode: GizmoMode,
		mouse: THREE.Vector2,
		camera: THREE.PerspectiveCamera
	): boolean {
		const activeHandles = this.gizmo.handles.filter((h) => h.userData.gizmoMode === gizmoMode);
		const hit = this.raycastMeshes(activeHandles, mouse, camera);
		if (!hit) return false;

		const startTransform = target.readTransform();
		if (!startTransform) return false;

		const axis = hit.userData.gizmoAxis as 'x' | 'y' | 'z';
		const gizmoPos = this.gizmo.group.position.clone();

		const localAxis =
			axis === 'x'
				? new THREE.Vector3(1, 0, 0)
				: axis === 'y'
					? new THREE.Vector3(0, 1, 0)
					: new THREE.Vector3(0, 0, 1);
		const worldAxis = localAxis.clone().applyQuaternion(this.gizmo.group.quaternion);

		let dragPlane: THREE.Plane;
		if (gizmoMode === 'rotate') {
			dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(worldAxis, gizmoPos);
		} else {
			// Translation: plane containing the axis, facing the camera as much as possible
			const viewDir = new THREE.Vector3().subVectors(gizmoPos, camera.position).normalize();
			let planeNormal = viewDir
				.clone()
				.sub(worldAxis.clone().multiplyScalar(viewDir.dot(worldAxis)));
			if (planeNormal.lengthSq() < 1e-6) {
				planeNormal = new THREE.Vector3(0, 1, 0).cross(worldAxis);
				if (planeNormal.lengthSq() < 1e-6)
					planeNormal = new THREE.Vector3(1, 0, 0).cross(worldAxis);
			}
			planeNormal.normalize();
			dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, gizmoPos);
		}

		const startIntersect = this.raycastPlane(dragPlane, mouse, camera);
		if (!startIntersect) return false;

		this.dragState = {
			mode: gizmoMode,
			axis,
			target,
			startTransform,
			dragPlane,
			startIntersect,
			worldAxis,
		};
		this.gizmo.setActive(hit);
		this.setControlsEnabled(false);
		return true;
	}

	/** Update the target transform live during a drag (called on pointermove). */
	update(mouse: THREE.Vector2, camera: THREE.PerspectiveCamera): void {
		const ds = this.dragState;
		if (!ds) return;
		const currIntersect = this.raycastPlane(ds.dragPlane, mouse, camera);
		if (!currIntersect) return;

		const gizmoPos = this.gizmo.group.position;

		if (ds.mode === 'rotate') {
			const startVec = new THREE.Vector3().subVectors(ds.startIntersect, gizmoPos).normalize();
			const currVec = new THREE.Vector3().subVectors(currIntersect, gizmoPos).normalize();
			const sinAngle = new THREE.Vector3().crossVectors(startVec, currVec).dot(ds.worldAxis);
			const cosAngle = startVec.dot(currVec);
			const angle = Math.atan2(sinAngle, cosAngle);

			const q = new THREE.Quaternion().setFromAxisAngle(ds.worldAxis, angle);
			const newU = new THREE.Vector3(
				ds.startTransform.u.x,
				ds.startTransform.u.y,
				ds.startTransform.u.z
			).applyQuaternion(q);
			const newV = new THREE.Vector3(
				ds.startTransform.v.x,
				ds.startTransform.v.y,
				ds.startTransform.v.z
			).applyQuaternion(q);
			const newNormal = new THREE.Vector3().crossVectors(newU, newV).normalize();

			ds.target.writeTransform({
				origin: ds.startTransform.origin,
				u: { x: newU.x, y: newU.y, z: newU.z },
				v: { x: newV.x, y: newV.y, z: newV.z },
				normal: { x: newNormal.x, y: newNormal.y, z: newNormal.z },
			});
		} else {
			const delta = new THREE.Vector3()
				.subVectors(currIntersect, ds.startIntersect)
				.dot(ds.worldAxis);
			const newOrigin = new THREE.Vector3(
				ds.startTransform.origin.x,
				ds.startTransform.origin.y,
				ds.startTransform.origin.z
			).addScaledVector(ds.worldAxis, delta);

			ds.target.writeTransform({
				origin: { x: newOrigin.x, y: newOrigin.y, z: newOrigin.z },
				u: ds.startTransform.u,
				v: ds.startTransform.v,
				normal: ds.startTransform.normal,
			});
		}

		this.syncPose(ds.target);
	}

	/** Revert the drag and restore the target to its original transform. */
	cancel(): void {
		const ds = this.dragState;
		if (!ds) return;
		ds.target.writeTransform(ds.startTransform);
		this.gizmo.setActive(null);
		this.setControlsEnabled(true);
		this.dragState = null;
		this.syncPose(ds.target);
		this.releasePointer();
	}

	/** Commit the drag by recording a history command (if the target persists). */
	commit(): void {
		const ds = this.dragState;
		if (!ds) return;
		const end = ds.target.readTransform();
		if (end) ds.target.commit(ds.startTransform, end);
		this.gizmo.setActive(null);
		this.setControlsEnabled(true);
		this.dragState = null;
		this.syncPose(ds.target);
		this.releasePointer();
	}

	private raycastMeshes(
		meshes: THREE.Mesh[],
		mouse: THREE.Vector2,
		camera: THREE.PerspectiveCamera
	): THREE.Mesh | null {
		if (meshes.length === 0) return null;
		this.raycaster.setFromCamera(mouse, camera);
		const hits = this.raycaster.intersectObjects(meshes, false);
		return hits.length > 0 && hits[0].object instanceof THREE.Mesh ? hits[0].object : null;
	}

	private raycastPlane(
		dragPlane: THREE.Plane,
		mouse: THREE.Vector2,
		camera: THREE.PerspectiveCamera
	): THREE.Vector3 | null {
		this.raycaster.setFromCamera(mouse, camera);
		const target = new THREE.Vector3();
		const hit = this.raycaster.ray.intersectPlane(dragPlane, target);
		return hit ? target.clone() : null;
	}
}
