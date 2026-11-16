import * as THREE from 'three';
import type { Part } from '$lib/model/Part';
import {
	backbonePoint,
	crossVec,
	helixCenterPoint,
	type Vec3,
} from '$lib/model/geometry3d/dnaGeometry';
import { HELIX_VISUAL_RADIUS } from './helixGeometry';

export interface CursorResult {
	/** Rings round each helix of the cursor's region at the cursor base pair. */
	rings: THREE.LineSegments;
	/** Spheres on the strand backbones at the cursor base pair. */
	markers: THREE.InstancedMesh;
	/** Rebuilds both for base pair `bp` of region `regionId` (nothing when null). */
	update(part: Part, regionId: string | null, bp: number): void;
	dispose(): void;
}

export interface CursorGeometry {
	/** Line-segment pairs (6 floats each) of every ring. */
	rings: Float32Array;
	markers: Vec3[];
}

const MAX_MARKERS = 1000;
const RING_SEGMENTS = 32;
const RING_RADIUS_OFFSET = 0.2;
const RING_COLOR = 0x3b82f6;
const MARKER_COLOR = 0xffd700;

/**
 * Where the cross-section cursor sits in 3D: base pair `bp` of every helix in region `regionId`,
 * like the strand view's cursor line, which spans only that region. Each helix uses its own lab
 * frame, so it holds for any plane and for freeform and wireframe helices, where the rings no
 * longer form one flat slice. Helices shorter than `bp` get nothing.
 */
export function cursorGeometry(part: Part, regionId: string | null, bp: number): CursorGeometry {
	const rings: number[] = [];
	const markers: Vec3[] = [];
	if (regionId === null) return { rings: new Float32Array(), markers };
	const r = HELIX_VISUAL_RADIUS + RING_RADIUS_OFFSET;
	for (const vh of part.virtualHelices) {
		if (vh.regionId !== regionId || bp < 0 || bp >= vh.length) continue;
		const frame = part.getVirtualHelixFrame(vh);
		const c = helixCenterPoint(frame, bp);
		const u = frame.radial0;
		const v = crossVec(frame.axis, frame.radial0);
		const at = (i: number) => {
			const t = (i / RING_SEGMENTS) * Math.PI * 2;
			const cos = Math.cos(t) * r;
			const sin = Math.sin(t) * r;
			return [
				c.x + cos * u.x + sin * v.x,
				c.y + cos * u.y + sin * v.y,
				c.z + cos * u.z + sin * v.z,
			];
		};
		for (let i = 0; i < RING_SEGMENTS; i++) rings.push(...at(i), ...at(i + 1));

		const region = part.getRegionForVh(vh);
		for (const strandIdx of [0, 1] as const) {
			const covered = [...vh.strandSets[strandIdx].segmentIds].some((id) => {
				const seg = part.getSegmentById(id);
				if (!seg) return false;
				const lo = Math.min(seg.fivePrime.index, seg.threePrime.index);
				const hi = Math.max(seg.fivePrime.index, seg.threePrime.index);
				return bp >= lo && bp <= hi;
			});
			if (!covered) continue;
			markers.push(
				backbonePoint(frame, bp, strandIdx, region.twistOffsetInDeg, region.twistPerBaseInDeg)
			);
		}
	}
	return { rings: new Float32Array(rings), markers };
}

export function createCursor(): CursorResult {
	const rings = new THREE.LineSegments(
		new THREE.BufferGeometry(),
		new THREE.LineBasicMaterial({
			color: RING_COLOR,
			transparent: true,
			opacity: 0.75,
			depthWrite: false,
		})
	);
	rings.frustumCulled = false;
	rings.visible = false;

	const markerGeo = new THREE.SphereGeometry(0.45, 8, 6);
	const markerMat = new THREE.MeshBasicMaterial({ color: MARKER_COLOR });
	const markers = new THREE.InstancedMesh(markerGeo, markerMat, MAX_MARKERS);
	markers.count = 0;
	markers.visible = false;
	markers.frustumCulled = false; // bounding sphere goes stale when count changes dynamically

	const dummy = new THREE.Object3D();

	function update(part: Part, regionId: string | null, bp: number): void {
		const geo = cursorGeometry(part, regionId, bp);
		rings.geometry.dispose();
		rings.geometry = new THREE.BufferGeometry();
		rings.geometry.setAttribute('position', new THREE.BufferAttribute(geo.rings, 3));

		if (geo.markers.length > MAX_MARKERS) {
			console.warn(`[View3D] cursor markers truncated at ${MAX_MARKERS}`);
		}
		const count = Math.min(geo.markers.length, MAX_MARKERS);
		for (let i = 0; i < count; i++) {
			const p = geo.markers[i];
			dummy.position.set(p.x, p.y, p.z);
			dummy.updateMatrix();
			markers.setMatrixAt(i, dummy.matrix);
		}
		markers.count = count;
		markers.instanceMatrix.needsUpdate = true;
	}

	function dispose(): void {
		rings.geometry.dispose();
		(rings.material as THREE.Material).dispose();
		markerGeo.dispose();
		markerMat.dispose();
	}

	return { rings, markers, update, dispose };
}
