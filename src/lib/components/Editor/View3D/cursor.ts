import * as THREE from 'three';
import type { Part } from '$lib/model/Part';
import { HELIX_VISUAL_RADIUS, backbonePointNm } from './helixGeometry';

export interface CursorResult {
	/** LineLoop circles, one per VH — add to scene. Position.z slides with csCursorIdx. */
	ringGroup: THREE.Group;
	/** InstancedMesh spheres at occupied nucleotide positions at the cursor BP. */
	markers: THREE.InstancedMesh;
	/** Rebuild ring geometry from a fresh VH XY position map (call after scene rebuild). */
	rebuildRings(vhXYCache: Map<number, { x: number; y: number }>): void;
	/** Update instanced-mesh matrices to reflect occupied nucleotides at the given base-pair index. */
	updateMarkers(bp: number, part: Part, vhXYCache: Map<number, { x: number; y: number }>): void;
	dispose(): void;
}

const MAX_MARKERS = 1000;
const RING_SEGMENTS = 32;
const RING_RADIUS_OFFSET = 0.2;
const RING_COLOR = 0x3b82f6;
const MARKER_COLOR = 0xffd700;

export function createCursor(): CursorResult {
	const ringGroup = new THREE.Group();
	ringGroup.visible = false;

	const markerGeo = new THREE.SphereGeometry(0.45, 8, 6);
	const markerMat = new THREE.MeshBasicMaterial({ color: MARKER_COLOR });
	const markers = new THREE.InstancedMesh(markerGeo, markerMat, MAX_MARKERS);
	markers.count = 0;
	markers.visible = false;
	markers.frustumCulled = false; // bounding sphere goes stale when count changes dynamically

	const dummy = new THREE.Object3D();

	function rebuildRings(vhXYCache: Map<number, { x: number; y: number }>): void {
		for (const child of ringGroup.children) {
			const line = child as THREE.Line;
			line.geometry.dispose();
			(line.material as THREE.Material).dispose();
		}
		ringGroup.clear();

		const r = HELIX_VISUAL_RADIUS + RING_RADIUS_OFFSET;
		for (const [, pos] of vhXYCache) {
			const pts = new Float32Array((RING_SEGMENTS + 1) * 3);
			for (let i = 0; i <= RING_SEGMENTS; i++) {
				const theta = (i / RING_SEGMENTS) * Math.PI * 2;
				pts[i * 3] = pos.x + r * Math.cos(theta);
				pts[i * 3 + 1] = pos.y + r * Math.sin(theta);
				pts[i * 3 + 2] = 0;
			}
			const geo = new THREE.BufferGeometry();
			geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
			const mat = new THREE.LineBasicMaterial({
				color: RING_COLOR,
				transparent: true,
				opacity: 0.75,
				depthWrite: false,
			});
			ringGroup.add(new THREE.LineLoop(geo, mat));
		}
	}

	function updateMarkers(
		bp: number,
		part: Part,
		vhXYCache: Map<number, { x: number; y: number }>
	): void {
		let count = 0;
		outer: for (const oligo of part.oligos) {
			for (const seg of oligo.segments) {
				const lo = Math.min(seg.fivePrime.index, seg.threePrime.index);
				const hi = Math.max(seg.fivePrime.index, seg.threePrime.index);
				if (bp < lo || bp > hi) continue;
				const vhPos = vhXYCache.get(seg.inVirtualHelix.index);
				if (!vhPos) continue;
				if (count >= MAX_MARKERS) {
					console.warn(`[View3D] cursor markers truncated at ${MAX_MARKERS}`);
					break outer;
				}
				const region = part.getRegionForVh(seg.inVirtualHelix);
				const p = backbonePointNm(
					vhPos.x,
					vhPos.y,
					bp,
					seg.inStrandIndex,
					region.twistOffsetInDeg,
					region.twistPerBaseInDeg
				);
				dummy.position.set(p.x, p.y, p.z);
				dummy.updateMatrix();
				markers.setMatrixAt(count, dummy.matrix);
				count++;
			}
		}
		markers.count = count;
		markers.instanceMatrix.needsUpdate = true;
	}

	function dispose(): void {
		for (const child of ringGroup.children) {
			const line = child as THREE.Line;
			line.geometry.dispose();
			(line.material as THREE.Material).dispose();
		}
		ringGroup.clear();
		markerGeo.dispose();
		markerMat.dispose();
	}

	return { ringGroup, markers, rebuildRings, updateMarkers, dispose };
}
