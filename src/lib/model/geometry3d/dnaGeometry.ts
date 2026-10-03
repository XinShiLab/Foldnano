import type { Part } from '$lib/model/Part';
import type OligoSegment from '$lib/model/Oligo/OligoSegment.svelte';
import type { Quat, Transform3D, Vec3 } from './types';

export type { Vec3 };

export interface VirtualHelixFrame {
	/** nm — base of helix (bp index 0) */
	origin: Vec3;
	/** normalized unit vector along helix axis (increasing bp-index direction) */
	axis: Vec3;
	/** normalized unit vector perpendicular to axis; defines the phase-0 radial reference */
	radial0: Vec3;
}

// Physical DNA geometry constants derived from oxDNA v2 parameters (all in nm).
// OXDNA_NM = 0.8518 nm/unit, OXDNA_BASE_BASE = 0.3897628551303122 units/bp,
// OXDNA_SQ_DIST = 2.6 units, OXDNA_HEX_DIST = 2.55 units (inter-helix, center-to-center).
const _OXDNA_NM = 0.8518;
export const BACKBONE_RISE_NM = 0.3897628551303122 * _OXDNA_NM; // ~0.3317 nm/bp
// Backbone (phosphate) is at CM_center (0.6) + CM_to_backbone (0.4) = 1.0 oxDNA units from helix axis
export const BACKBONE_RADIUS_NM = 1.0 * _OXDNA_NM; // ~0.852 nm

// Per-lattice inter-helix center-to-center distances (nm). These match the oxDNA v2
// equilibrium distances used by the NT model and oxDNA export, so the 3D view,
// RBS, and export all share the same physical geometry.
export const SQ_INTERHELIX_NM = 2.6 * _OXDNA_NM; // ~2.2147 nm
export const HEX_INTERHELIX_NM = 2.55 * _OXDNA_NM; // ~2.1721 nm

function honeycombXY(col: number, row: number): { x: number; y: number } {
	const R = HEX_INTERHELIX_NM / 2; // ~1.0860 nm — nearest-neighbor distance = 2R
	const hr = Math.floor(row / 2);
	const x = col * Math.sqrt(3) * R;
	const y = row % 2 === 0 ? hr * 6 * R + (col % 2) * R : hr * 6 * R + 4 * R - (col % 2) * R;
	return { x, y };
}

function squareXY(col: number, row: number): { x: number; y: number } {
	return { x: col * SQ_INTERHELIX_NM, y: row * SQ_INTERHELIX_NM };
}

export function getHelixXY(
	col: number,
	row: number,
	latticeType: 'HONEYCOMB' | 'SQUARE' | 'UNDEFINED'
): { x: number; y: number } {
	return latticeType === 'SQUARE' ? squareXY(col, row) : honeycombXY(col, row);
}

// ── Frame geometry helpers ──────────────────────────────────────────────────

export function crossVec(a: Vec3, b: Vec3): Vec3 {
	return {
		x: a.y * b.z - a.z * b.y,
		y: a.z * b.x - a.x * b.z,
		z: a.x * b.y - a.y * b.x,
	};
}

export function normalizeVec(v: Vec3): Vec3 {
	const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
	if (len < 1e-9) return { x: 0, y: 0, z: 1 };
	return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/**
 * Returns a unit vector perpendicular to `axis` suitable as `radial0`.
 * For axis ≈ +Z (the default lattice axis), returns [1,0,0] to preserve the
 * existing twist-angle convention (matches `backbonePointNm` behavior).
 */
export function radial0ForAxis(axis: Vec3): Vec3 {
	// Project [1,0,0] onto the plane perpendicular to axis (Gram-Schmidt).
	// Adding 0 to each component avoids -0 floating-point artifacts.
	const dot = axis.x;
	const r = { x: 1 - dot * axis.x + 0, y: -dot * axis.y + 0, z: -dot * axis.z + 0 };
	const len = Math.sqrt(r.x * r.x + r.y * r.y + r.z * r.z);
	if (len < 1e-6) {
		// axis ≈ ±X; fall back to projecting [0,1,0]
		const dot2 = axis.y;
		const r2 = { x: -dot2 * axis.x + 0, y: 1 - dot2 * axis.y + 0, z: -dot2 * axis.z + 0 };
		return normalizeVec(r2);
	}
	return { x: r.x / len, y: r.y / len, z: r.z / len };
}

export function framesEqual(a: VirtualHelixFrame, b: VirtualHelixFrame): boolean {
	return (
		a.origin.x === b.origin.x &&
		a.origin.y === b.origin.y &&
		a.origin.z === b.origin.z &&
		a.axis.x === b.axis.x &&
		a.axis.y === b.axis.y &&
		a.axis.z === b.axis.z &&
		a.radial0.x === b.radial0.x &&
		a.radial0.y === b.radial0.y &&
		a.radial0.z === b.radial0.z
	);
}

/** 3D center of the helix axis at the given bp index (nm). */
export function helixCenterPoint(frame: VirtualHelixFrame, bpIdx: number): Vec3 {
	return {
		x: frame.origin.x + frame.axis.x * bpIdx * BACKBONE_RISE_NM,
		y: frame.origin.y + frame.axis.y * bpIdx * BACKBONE_RISE_NM,
		z: frame.origin.z + frame.axis.z * bpIdx * BACKBONE_RISE_NM,
	};
}

/**
 * Frame-aware backbone point (nm).
 * Equivalent to `backbonePointNm(origin.x, origin.y, bpIdx, strandIdx, …)`
 * when frame has axis=[0,0,1] and radial0=[1,0,0].
 */
export function backbonePoint(
	frame: VirtualHelixFrame,
	bpIdx: number,
	strandIdx: 0 | 1,
	twistOffsetDeg: number,
	twistPerBaseDeg: number
): Vec3 {
	const center = helixCenterPoint(frame, bpIdx);
	// radial1 is the second orthogonal basis vector in the cross-section plane
	const radial1 = crossVec(frame.axis, frame.radial0);
	const angleDeg = strandIdx * 180 + twistOffsetDeg + twistPerBaseDeg * bpIdx;
	const angleRad = (angleDeg * Math.PI) / 180;
	const c = Math.cos(angleRad);
	const s = Math.sin(angleRad);
	return {
		x: center.x + BACKBONE_RADIUS_NM * (c * frame.radial0.x + s * radial1.x),
		y: center.y + BACKBONE_RADIUS_NM * (c * frame.radial0.y + s * radial1.y),
		z: center.z + BACKBONE_RADIUS_NM * (c * frame.radial0.z + s * radial1.z),
	};
}

/**
 * Like `backbonePoint` but writes XYZ directly into `out[offset..offset+2]`.
 * Accepts a precomputed `radial1 = crossVec(frame.axis, frame.radial0)` so the
 * cross-product is not recomputed per nucleotide.
 */
export function backbonePointInto(
	frame: VirtualHelixFrame,
	radial1: Vec3,
	bpIdx: number,
	strandIdx: 0 | 1,
	twistOffsetDeg: number,
	twistPerBaseDeg: number,
	out: Float32Array,
	offset: number
): void {
	const cx = frame.origin.x + frame.axis.x * bpIdx * BACKBONE_RISE_NM;
	const cy = frame.origin.y + frame.axis.y * bpIdx * BACKBONE_RISE_NM;
	const cz = frame.origin.z + frame.axis.z * bpIdx * BACKBONE_RISE_NM;
	const angleDeg = strandIdx * 180 + twistOffsetDeg + twistPerBaseDeg * bpIdx;
	const angleRad = (angleDeg * Math.PI) / 180;
	const c = Math.cos(angleRad);
	const s = Math.sin(angleRad);
	out[offset] = cx + BACKBONE_RADIUS_NM * (c * frame.radial0.x + s * radial1.x);
	out[offset + 1] = cy + BACKBONE_RADIUS_NM * (c * frame.radial0.y + s * radial1.y);
	out[offset + 2] = cz + BACKBONE_RADIUS_NM * (c * frame.radial0.z + s * radial1.z);
}

export function getVhXYMap(part: Part): Map<number, { x: number; y: number }> {
	const map = new Map<number, { x: number; y: number }>();
	for (const vh of part.virtualHelices) {
		const frame = part.getVirtualHelixFrame(vh);
		map.set(vh.index, { x: frame.origin.x, y: frame.origin.y });
	}
	return map;
}

export type PhysOffsetMaps = Map<string, { offsets: number[] }>;

/**
 * physOffset[bpIdx] = cumulative extra nts before bpIdx due to inserts/skips.
 * insert (seqLen > 1): each extra nt adds 1 to all subsequent offsets.
 * skip   (seqLen = 0): removes 1 nt, shifts subsequent positions back by 1.
 * normal (seqLen = 1): no change.
 */
export function buildPhysicalOffsetMaps(part: Part): PhysOffsetMaps {
	const physOffsetMaps: PhysOffsetMaps = new Map();
	for (const vh of part.virtualHelices) {
		for (const strandIdx of [0, 1] as const) {
			const seqLenMap = new Map<number, number>();
			for (const segId of vh.strandSets[strandIdx].segmentIds) {
				const seg = part.getSegmentById(segId);
				if (!seg) continue;
				for (const slot of seg.slots) seqLenMap.set(slot.bpIndex, slot.seq.length);
			}
			const offsets = new Array<number>(vh.length + 1).fill(0);
			for (let i = 0; i < vh.length; i++) {
				offsets[i + 1] = offsets[i] + (seqLenMap.get(i) ?? 1) - 1;
			}
			physOffsetMaps.set(`${vh.index}:${strandIdx}`, { offsets });
		}
	}
	return physOffsetMaps;
}

export function getPhysicalStart(
	vhIndex: number,
	strandIdx: 0 | 1,
	lo: number,
	insertEffects: boolean,
	physOffsetMaps: PhysOffsetMaps
): number {
	if (!insertEffects) return lo;
	const entry = physOffsetMaps.get(`${vhIndex}:${strandIdx}`);
	return lo + (entry ? (entry.offsets[lo] ?? 0) : 0);
}

export function getSegmentPhysicalRange(
	seg: OligoSegment,
	insertEffects: boolean,
	physOffsetMaps: PhysOffsetMaps
): { lo: number; hi: number; totalNts: number } {
	const lo = Math.min(seg.fivePrime.index, seg.threePrime.index);
	const hi = Math.max(seg.fivePrime.index, seg.threePrime.index);
	const totalNts = insertEffects ? seg.totalNucleotides : hi - lo + 1;
	const physStart = getPhysicalStart(
		seg.inVirtualHelix.index,
		seg.inStrandIndex,
		lo,
		insertEffects,
		physOffsetMaps
	);
	return {
		lo: physStart,
		hi: physStart + Math.max(0, totalNts - 1),
		totalNts,
	};
}

export function getSegmentEndPhysicalIndex(
	seg: OligoSegment,
	end: 'fivePrime' | 'threePrime',
	insertEffects: boolean,
	physOffsetMaps: PhysOffsetMaps
): number {
	const range = getSegmentPhysicalRange(seg, insertEffects, physOffsetMaps);
	if (end === 'fivePrime') return seg.inStrandIndex === 0 ? range.lo : range.hi;
	return seg.inStrandIndex === 0 ? range.hi : range.lo;
}

export function backbonePointNm(
	hx: number,
	hy: number,
	bpIdx: number,
	strandIdx: number,
	twistOffsetDeg: number,
	twistPerBaseDeg: number
): Vec3 {
	const angleDeg = strandIdx * 180 + twistOffsetDeg + twistPerBaseDeg * bpIdx;
	const angleRad = (angleDeg * Math.PI) / 180;
	return {
		x: hx + BACKBONE_RADIUS_NM * Math.cos(angleRad),
		y: hy + BACKBONE_RADIUS_NM * Math.sin(angleRad),
		z: bpIdx * BACKBONE_RISE_NM,
	};
}

export function rotateVec(q: Quat, v: Vec3): Vec3 {
	const tx = 2 * (q.y * v.z - q.z * v.y);
	const ty = 2 * (q.z * v.x - q.x * v.z);
	const tz = 2 * (q.x * v.y - q.y * v.x);
	return {
		x: v.x + q.w * tx + (q.y * tz - q.z * ty),
		y: v.y + q.w * ty + (q.z * tx - q.x * tz),
		z: v.z + q.w * tz + (q.x * ty - q.y * tx),
	};
}

function addVec(a: Vec3, b: Vec3): Vec3 {
	return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function subVec(a: Vec3, b: Vec3): Vec3 {
	return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function applyTransform(p: Vec3, transform: Transform3D): Vec3 {
	return addVec(
		transform.position,
		rotateVec(transform.quaternion, subVec(p, transform.originalCenter))
	);
}
