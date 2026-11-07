import { OXDNA_NM } from '$lib/model/io/oxdnaConstants';
import type { SimulationNucleotide } from '$lib/model/io/simulationNtModel';

import { FRAME_STRIDE, type OxDnaFrame } from './oxdnaTrajectory';

/** oxDNA places the backbone and base interaction sites 0.4 units along ∓a1 from the CM. */
const SITE_OFFSET = 0.4;

/** Design-side data every frame is posed against. Built once per loaded replay. */
export interface ReplayReference {
	nucleotideCount: number;
	/** Design CM positions in nm, 3 per nucleotide. */
	designPositionsNm: Float64Array;
	/** 0-based strand index per nucleotide. */
	strandOf: Int32Array;
	/** Row of the base-pair partner, or -1. */
	partnerOf: Int32Array;
	/** Rows of each strand. */
	strandRows: number[][];
}

export interface PosedFrame {
	/** Backbone sites in nm, lab frame, 3 per nucleotide. */
	backboneNm: Float32Array;
	/** Base sites in nm, lab frame, 3 per nucleotide. */
	baseNm: Float32Array;
}

export function buildReplayReference(nts: readonly SimulationNucleotide[]): ReplayReference {
	const n = nts.length;
	const designPositionsNm = new Float64Array(n * 3);
	const strandOf = new Int32Array(n);
	const partnerOf = new Int32Array(n).fill(-1);
	const strandRows: number[][] = [];
	const byPairKey = new Map<string, number>();
	for (let i = 0; i < n; i++) {
		const nt = nts[i];
		designPositionsNm[i * 3] = nt.positionNm.x;
		designPositionsNm[i * 3 + 1] = nt.positionNm.y;
		designPositionsNm[i * 3 + 2] = nt.positionNm.z;
		const strand = nt.strandId - 1;
		strandOf[i] = strand;
		(strandRows[strand] ??= []).push(i);
		const other = byPairKey.get(nt.pairKey);
		if (other === undefined) {
			byPairKey.set(nt.pairKey, i);
		} else {
			partnerOf[i] = other;
			partnerOf[other] = i;
		}
	}
	for (let s = 0; s < strandRows.length; s++) strandRows[s] ??= [];
	return { nucleotideCount: n, designPositionsNm, strandOf, partnerOf, strandRows };
}

function shiftStrand(
	data: Float32Array,
	rows: readonly number[],
	dx: number,
	dy: number,
	dz: number
): void {
	if (dx === 0 && dy === 0 && dz === 0) return;
	for (const row of rows) {
		const b = row * FRAME_STRIDE;
		data[b] += dx;
		data[b + 1] += dy;
		data[b + 2] += dz;
	}
}

function strandCentroid(data: Float32Array, rows: readonly number[]): [number, number, number] {
	let x = 0,
		y = 0,
		z = 0;
	for (const row of rows) {
		const b = row * FRAME_STRIDE;
		x += data[b];
		y += data[b + 1];
		z += data[b + 2];
	}
	const k = rows.length || 1;
	return [x / k, y / k, z / k];
}

/**
 * oxDNA may move whole strands by box multiples (periodic boundaries). Walks the strand graph
 * from the longest strand along base pairs and shifts each strand next to its partner, so paired
 * strands never sit a box apart. Strands with no pairs go to the nearest image of the anchor.
 */
export function unwrapStrandsInPlace(
	data: Float32Array,
	ref: ReplayReference,
	box: readonly [number, number, number]
): void {
	const strandCount = ref.strandRows.length;
	if (strandCount < 2) return;
	const imageShift = (delta: number, side: number) =>
		side > 0 && Number.isFinite(side) ? Math.round(delta / side) * side : 0;

	let anchor = 0;
	for (let s = 1; s < strandCount; s++) {
		if (ref.strandRows[s].length > ref.strandRows[anchor].length) anchor = s;
	}
	const placed = new Uint8Array(strandCount);
	placed[anchor] = 1;
	const queue = [anchor];
	while (queue.length > 0) {
		const strand = queue.shift()!;
		for (const row of ref.strandRows[strand]) {
			const partner = ref.partnerOf[row];
			if (partner < 0) continue;
			const other = ref.strandOf[partner];
			if (placed[other]) continue;
			const a = row * FRAME_STRIDE;
			const b = partner * FRAME_STRIDE;
			shiftStrand(
				data,
				ref.strandRows[other],
				imageShift(data[a] - data[b], box[0]),
				imageShift(data[a + 1] - data[b + 1], box[1]),
				imageShift(data[a + 2] - data[b + 2], box[2])
			);
			placed[other] = 1;
			queue.push(other);
		}
	}

	const anchorCenter = strandCentroid(data, ref.strandRows[anchor]);
	for (let s = 0; s < strandCount; s++) {
		if (placed[s] || ref.strandRows[s].length === 0) continue;
		const c = strandCentroid(data, ref.strandRows[s]);
		shiftStrand(
			data,
			ref.strandRows[s],
			imageShift(anchorCenter[0] - c[0], box[0]),
			imageShift(anchorCenter[1] - c[1], box[1]),
			imageShift(anchorCenter[2] - c[2], box[2])
		);
	}
}

/** Unit quaternion (w, x, y, z) as a plain tuple. */
export type Quat = [number, number, number, number];

// Cyclic Jacobi on a symmetric 4×4; returns the eigenvector of the largest eigenvalue.
function largestEigenvector4(m: number[][]): Quat {
	const a = m.map((row) => row.slice());
	const v = [
		[1, 0, 0, 0],
		[0, 1, 0, 0],
		[0, 0, 1, 0],
		[0, 0, 0, 1],
	];
	for (let sweep = 0; sweep < 50; sweep++) {
		let off = 0;
		for (let p = 0; p < 3; p++) for (let q = p + 1; q < 4; q++) off += a[p][q] * a[p][q];
		if (off < 1e-20) break;
		for (let p = 0; p < 3; p++) {
			for (let q = p + 1; q < 4; q++) {
				if (Math.abs(a[p][q]) < 1e-30) continue;
				const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
				const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
				const c = 1 / Math.sqrt(t * t + 1);
				const s = t * c;
				for (let k = 0; k < 4; k++) {
					const akp = a[k][p];
					const akq = a[k][q];
					a[k][p] = c * akp - s * akq;
					a[k][q] = s * akp + c * akq;
				}
				for (let k = 0; k < 4; k++) {
					const apk = a[p][k];
					const aqk = a[q][k];
					a[p][k] = c * apk - s * aqk;
					a[q][k] = s * apk + c * aqk;
				}
				for (let k = 0; k < 4; k++) {
					const vkp = v[k][p];
					const vkq = v[k][q];
					v[k][p] = c * vkp - s * vkq;
					v[k][q] = s * vkp + c * vkq;
				}
			}
		}
	}
	let best = 0;
	for (let i = 1; i < 4; i++) if (a[i][i] > a[best][best]) best = i;
	const q: Quat = [v[0][best], v[1][best], v[2][best], v[3][best]];
	const norm = Math.hypot(...q) || 1;
	return [q[0] / norm, q[1] / norm, q[2] / norm, q[3] / norm];
}

export interface RigidFit {
	rotation: Quat;
	/** Centroid of the moving set. */
	fromCenter: [number, number, number];
	/** Centroid of the reference set. */
	toCenter: [number, number, number];
}

function centroid3(points: ArrayLike<number>, count: number): [number, number, number] {
	let x = 0,
		y = 0,
		z = 0;
	for (let i = 0; i < count; i++) {
		x += points[i * 3];
		y += points[i * 3 + 1];
		z += points[i * 3 + 2];
	}
	const k = count || 1;
	return [x / k, y / k, z / k];
}

/** Least-squares rigid fit (Horn's quaternion method) taking `moving` onto `reference`. */
export function bestFitRigid(
	moving: ArrayLike<number>,
	reference: ArrayLike<number>,
	count: number
): RigidFit {
	const pc = centroid3(moving, count);
	const qc = centroid3(reference, count);
	let sxx = 0,
		sxy = 0,
		sxz = 0,
		syx = 0,
		syy = 0,
		syz = 0,
		szx = 0,
		szy = 0,
		szz = 0;
	for (let i = 0; i < count; i++) {
		const px = moving[i * 3] - pc[0];
		const py = moving[i * 3 + 1] - pc[1];
		const pz = moving[i * 3 + 2] - pc[2];
		const qx = reference[i * 3] - qc[0];
		const qy = reference[i * 3 + 1] - qc[1];
		const qz = reference[i * 3 + 2] - qc[2];
		sxx += px * qx;
		sxy += px * qy;
		sxz += px * qz;
		syx += py * qx;
		syy += py * qy;
		syz += py * qz;
		szx += pz * qx;
		szy += pz * qy;
		szz += pz * qz;
	}
	const rotation = largestEigenvector4([
		[sxx + syy + szz, syz - szy, szx - sxz, sxy - syx],
		[syz - szy, sxx - syy - szz, sxy + syx, szx + sxz],
		[szx - sxz, sxy + syx, -sxx + syy - szz, syz + szy],
		[sxy - syx, szx + sxz, syz + szy, -sxx - syy + szz],
	]);
	return { rotation, fromCenter: pc, toCenter: qc };
}

/** Applies `fit` to every point of `points` in place. */
export function applyRigidFit(points: Float32Array, fit: RigidFit): void {
	const [w, x, y, z] = fit.rotation;
	// Rotation matrix of a unit quaternion.
	const r00 = 1 - 2 * (y * y + z * z);
	const r01 = 2 * (x * y - w * z);
	const r02 = 2 * (x * z + w * y);
	const r10 = 2 * (x * y + w * z);
	const r11 = 1 - 2 * (x * x + z * z);
	const r12 = 2 * (y * z - w * x);
	const r20 = 2 * (x * z - w * y);
	const r21 = 2 * (y * z + w * x);
	const r22 = 1 - 2 * (x * x + y * y);
	const [fx, fy, fz] = fit.fromCenter;
	const [tx, ty, tz] = fit.toCenter;
	for (let i = 0; i < points.length; i += 3) {
		const px = points[i] - fx;
		const py = points[i + 1] - fy;
		const pz = points[i + 2] - fz;
		points[i] = r00 * px + r01 * py + r02 * pz + tx;
		points[i + 1] = r10 * px + r11 * py + r12 * pz + ty;
		points[i + 2] = r20 * px + r21 * py + r22 * pz + tz;
	}
}

export interface PoseOptions {
	/** Rigid-fit each frame onto the design. Off: only the centroid is matched. */
	alignToDesign: boolean;
}

/**
 * Turns a raw frame into lab-frame backbone/base sites in nm, placed over the design.
 * `frame.data` is modified (periodic unwrap); decode a fresh copy per call.
 */
export function poseFrame(frame: OxDnaFrame, ref: ReplayReference, opts: PoseOptions): PosedFrame {
	const n = ref.nucleotideCount;
	unwrapStrandsInPlace(frame.data, ref, frame.box);

	const cmNm = new Float32Array(n * 3);
	const backboneNm = new Float32Array(n * 3);
	const baseNm = new Float32Array(n * 3);
	const d = frame.data;
	for (let i = 0; i < n; i++) {
		const b = i * FRAME_STRIDE;
		for (let k = 0; k < 3; k++) {
			const r = d[b + k];
			const a1 = d[b + 3 + k];
			cmNm[i * 3 + k] = r * OXDNA_NM;
			backboneNm[i * 3 + k] = (r - SITE_OFFSET * a1) * OXDNA_NM;
			baseNm[i * 3 + k] = (r + SITE_OFFSET * a1) * OXDNA_NM;
		}
	}

	const fit: RigidFit = opts.alignToDesign
		? bestFitRigid(cmNm, ref.designPositionsNm, n)
		: {
				rotation: [1, 0, 0, 0],
				fromCenter: centroid3(cmNm, n),
				toCenter: centroid3(ref.designPositionsNm, n),
			};
	applyRigidFit(backboneNm, fit);
	applyRigidFit(baseNm, fit);
	return { backboneNm, baseNm };
}
