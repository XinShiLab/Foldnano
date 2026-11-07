import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';

import type { PosedFrame } from '$lib/model/oxdnaReplay/framePose';
import type { SimulationNucleotide } from '$lib/model/io/simulationNtModel';

const BACKBONE_RADIUS_NM = 0.24;
const BOND_WIDTH_NM = 0.28;
const BASE_WIDTH_NM = 0.16;
const BASE_LIGHTEN = 0.45;
const WHITE = new THREE.Color(0xffffff);
const HOVER_SCALE = 2;
/** Picking tolerance around a backbone site, a little larger than the sphere. */
const PICK_RADIUS_NM = 0.45;

export interface ReplayGeometry {
	group: THREE.Group;
	/** Moves every site to the posed frame without rebuilding buffers. */
	update(pose: PosedFrame): void;
	/** Recolours per nucleotide (oligo colours). */
	setColors(colors: readonly THREE.Color[]): void;
	/** Enlarges the sphere of one nucleotide (or none). */
	setHovered(row: number | null): void;
	/** Shows only the rows flagged in `mask` (null shows all); a bond needs both of its ends. */
	setVisible(mask: Uint8Array | null): void;
}

/**
 * Nearest backbone site along `ray` within the pick radius, or -1. A ray-to-point test over every
 * site is cheaper than raycasting thousands of instanced spheres.
 */
export function pickNucleotide(
	ray: THREE.Ray,
	backboneNm: Float32Array,
	visible: Uint8Array | null = null
): number {
	const ox = ray.origin.x,
		oy = ray.origin.y,
		oz = ray.origin.z;
	const dx = ray.direction.x,
		dy = ray.direction.y,
		dz = ray.direction.z;
	const r2 = PICK_RADIUS_NM * PICK_RADIUS_NM;
	let best = -1;
	let bestT = Infinity;
	for (let i = 0; i < backboneNm.length / 3; i++) {
		if (visible && !visible[i]) continue;
		const px = backboneNm[i * 3] - ox;
		const py = backboneNm[i * 3 + 1] - oy;
		const pz = backboneNm[i * 3 + 2] - oz;
		const t = px * dx + py * dy + pz * dz;
		if (t < 0 || t >= bestT) continue;
		const qx = px - t * dx,
			qy = py - t * dy,
			qz = pz - t * dz;
		if (qx * qx + qy * qy + qz * qz <= r2) {
			best = i;
			bestT = t;
		}
	}
	return best;
}

function makeLines(pairCount: number, width: number): LineSegments2 {
	const geo = new LineSegmentsGeometry();
	geo.setPositions(new Float32Array(pairCount * 6));
	geo.setColors(new Float32Array(pairCount * 6));
	const mat = new LineMaterial({ linewidth: width, worldUnits: true, vertexColors: true });
	const lines = new LineSegments2(geo, mat);
	lines.frustumCulled = false;
	return lines;
}

// LineSegmentsGeometry keeps start/end interleaved in one buffer (stride 6); rewrite it in place
// so playback never allocates GPU buffers.
function lineBuffer(lines: LineSegments2, attr: 'instanceStart' | 'instanceColorStart') {
	const attribute = lines.geometry.getAttribute(attr) as THREE.InterleavedBufferAttribute;
	return attribute.data;
}

/** oxView-style replay mesh: a sphere per backbone site, backbone bonds, and a stick to each base. */
export function buildReplayGeometry(nts: readonly SimulationNucleotide[]): ReplayGeometry {
	const n = nts.length;
	const group = new THREE.Group();
	group.name = 'oxdna-replay';

	const spheres = new THREE.InstancedMesh(
		new THREE.SphereGeometry(BACKBONE_RADIUS_NM, 10, 8),
		new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0 }),
		n
	);
	spheres.frustumCulled = false;
	const identity = new THREE.Matrix4();
	for (let i = 0; i < n; i++) {
		spheres.setMatrixAt(i, identity);
		spheres.setColorAt(i, WHITE);
	}
	group.add(spheres);

	// Bond i joins nucleotide `bondFrom[i]` to its 3′ neighbour (wraps for circular oligos).
	const bondFrom: number[] = [];
	const bondTo: number[] = [];
	for (let i = 0; i < n; i++) {
		if (nts[i].next >= 0) {
			bondFrom.push(i);
			bondTo.push(nts[i].next);
		}
	}
	const bonds = makeLines(bondFrom.length, BOND_WIDTH_NM);
	const bases = makeLines(n, BASE_WIDTH_NM);
	group.add(bonds, bases);

	// Shown bonds and base sticks are packed at the front of their buffers and `instanceCount`
	// cuts off the rest, so hidden ones are not drawn at all.
	let shownBonds = bondFrom.map((_, k) => k);
	let shownRows = Array.from({ length: n }, (_, i) => i);
	let visible: Uint8Array | null = null;
	let lastPose: PosedFrame | null = null;
	let lastColors: readonly THREE.Color[] | null = null;
	let hovered: number | null = null;

	function update(pose: PosedFrame): void {
		lastPose = pose;
		const { backboneNm, baseNm } = pose;
		const matrices = spheres.instanceMatrix.array as Float32Array;
		for (let i = 0; i < n; i++) {
			matrices[i * 16 + 12] = backboneNm[i * 3];
			matrices[i * 16 + 13] = backboneNm[i * 3 + 1];
			matrices[i * 16 + 14] = backboneNm[i * 3 + 2];
		}
		spheres.instanceMatrix.needsUpdate = true;

		const bondData = lineBuffer(bonds, 'instanceStart');
		const bondArray = bondData.array as Float32Array;
		shownBonds.forEach((b, k) => {
			bondArray.set(backboneNm.subarray(bondFrom[b] * 3, bondFrom[b] * 3 + 3), k * 6);
			bondArray.set(backboneNm.subarray(bondTo[b] * 3, bondTo[b] * 3 + 3), k * 6 + 3);
		});
		bondData.needsUpdate = true;

		const baseData = lineBuffer(bases, 'instanceStart');
		const baseArray = baseData.array as Float32Array;
		shownRows.forEach((i, k) => {
			baseArray.set(backboneNm.subarray(i * 3, i * 3 + 3), k * 6);
			baseArray.set(baseNm.subarray(i * 3, i * 3 + 3), k * 6 + 3);
		});
		baseData.needsUpdate = true;
	}

	function setColors(colors: readonly THREE.Color[]): void {
		lastColors = colors;
		for (let i = 0; i < n; i++) spheres.setColorAt(i, colors[i]);
		if (spheres.instanceColor) spheres.instanceColor.needsUpdate = true;

		const bondData = lineBuffer(bonds, 'instanceColorStart');
		const bondArray = bondData.array as Float32Array;
		shownBonds.forEach((b, k) => {
			const c = colors[bondFrom[b]];
			bondArray.set([c.r, c.g, c.b, c.r, c.g, c.b], k * 6);
		});
		bondData.needsUpdate = true;

		const baseData = lineBuffer(bases, 'instanceColorStart');
		const baseArray = baseData.array as Float32Array;
		const light = new THREE.Color();
		shownRows.forEach((i, k) => {
			light.copy(colors[i]).lerp(WHITE, BASE_LIGHTEN);
			baseArray.set([light.r, light.g, light.b, light.r, light.g, light.b], k * 6);
		});
		baseData.needsUpdate = true;
	}

	const restScale = (row: number) =>
		visible && !visible[row] ? 0 : row === hovered ? HOVER_SCALE : 1;

	function setScale(row: number, scale: number): void {
		const m = spheres.instanceMatrix.array as Float32Array;
		m[row * 16] = scale;
		m[row * 16 + 5] = scale;
		m[row * 16 + 10] = scale;
	}
	function setHovered(row: number | null): void {
		if (row === hovered) return;
		const previous = hovered;
		hovered = row !== null && row >= 0 && row < n ? row : null;
		if (previous !== null) setScale(previous, restScale(previous));
		if (hovered !== null) setScale(hovered, restScale(hovered));
		spheres.instanceMatrix.needsUpdate = true;
	}

	function setVisible(mask: Uint8Array | null): void {
		visible = mask;
		shownRows = Array.from({ length: n }, (_, i) => i).filter((i) => !mask || mask[i]);
		shownBonds = bondFrom
			.map((_, k) => k)
			.filter((k) => !mask || (mask[bondFrom[k]] && mask[bondTo[k]]));
		bonds.geometry.instanceCount = shownBonds.length;
		bases.geometry.instanceCount = shownRows.length;
		for (let i = 0; i < n; i++) setScale(i, restScale(i));
		spheres.instanceMatrix.needsUpdate = true;
		if (lastPose) update(lastPose);
		if (lastColors) setColors(lastColors);
	}

	return { group, update, setColors, setHovered, setVisible };
}
