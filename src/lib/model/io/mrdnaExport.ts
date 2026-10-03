import type { Part } from '$lib/model/Part';
import { applyTransform, rotateVec } from '$lib/model/geometry3d/dnaGeometry';
import type { Vec3 } from '$lib/model/geometry3d/types';
import type { BlockTransformOverride } from '$lib/model/rbs/rbsTypes';
import {
	RISE_NM,
	buildSimulationNtModel,
	type SimulationFallbackBase,
	type SimulationNucleotide,
} from '$lib/model/io/simulationNtModel';

// Max axial (along-helix) separation, in nm, for two same-VH nucleotides to count as
// physically stacked. Stacked neighbours (including across cadnano skips/deletions, which
// close the helix up to ~1 rise) sit ~1 rise apart; a genuine empty-space gap — an internal
// same-VH connection bridging absent bp positions — preserves the axial distance, leaving the
// flanking nts ≥2 rises apart. 1.5 rises cleanly separates the two.
const MAX_STACK_AXIAL_NM = 1.5 * RISE_NM;

export type MrdnaFallbackBase = SimulationFallbackBase;

export interface MrdnaExportResult {
	txt: string;
	nucleotideCount: number;
	strandCount: number;
}

export interface MrdnaNucleotide {
	position: Vec3; // nm
	a1: Vec3;
	a3: Vec3;
	base: string;
	bpIdx: number;
	stackIdx: number;
	threePrimeIdx: number;
}

function crossVec(a: Vec3, b: Vec3): Vec3 {
	return {
		x: a.y * b.z - a.z * b.y,
		y: a.z * b.x - a.x * b.z,
		z: a.x * b.y - a.y * b.x,
	};
}

function transformFrame(
	positionNm: Vec3,
	a1: Vec3,
	a3: Vec3,
	override?: BlockTransformOverride
): { position: Vec3; a1: Vec3; a3: Vec3 } {
	if (!override) return { position: positionNm, a1, a3 };
	return {
		position: applyTransform(positionNm, override),
		a1: rotateVec(override.quaternion, a1),
		a3: rotateVec(override.quaternion, a3),
	};
}

function buildBpMap(nts: SimulationNucleotide[]): Int32Array {
	// pairKey → list of nt ids sharing that key
	const keyToIds = new Map<string, number[]>();
	for (const nt of nts) {
		let ids = keyToIds.get(nt.pairKey);
		if (!ids) {
			ids = [];
			keyToIds.set(nt.pairKey, ids);
		}
		ids.push(nt.id);
	}

	const bpOf = new Int32Array(nts.length).fill(-1);
	for (const ids of keyToIds.values()) {
		if (ids.length === 2) {
			bpOf[ids[0]] = ids[1];
			bpOf[ids[1]] = ids[0];
		}
		// length === 1 → ssDNA, leaves -1
	}
	return bpOf;
}

// Physical position key for a nucleotide within its VH, used for cross-strand stacking lookup.
function physPosKey(vhId: string, strandIdx: 0 | 1, bpIndex: number, loopIndex: number): string {
	return `${vhId}:${strandIdx}:${bpIndex}:${loopIndex}`;
}

// Axial separation (projection of the CM-to-CM vector onto the helix axis) between two
// nucleotides, in nm. a.a3 is the unit helix axis (signed by strand direction), so this
// measures along-helix distance and is unaffected by the per-base radial twist.
function axialSeparationNm(a: SimulationNucleotide, b: SimulationNucleotide): number {
	const dx = b.positionNm.x - a.positionNm.x;
	const dy = b.positionNm.y - a.positionNm.y;
	const dz = b.positionNm.z - a.positionNm.z;
	return Math.abs(dx * a.a3.x + dy * a.a3.y + dz * a.a3.z);
}

function buildPhysicalNeighborMap(nts: SimulationNucleotide[]): Int32Array {
	// Map (vhId, strandIdx, bpIndex, loopIndex) → nt id.
	const posToId = new Map<string, number>();
	for (const nt of nts) {
		posToId.set(physPosKey(nt.vhId, nt.strandIdx, nt.bpIndex, nt.loopIndex), nt.id);
	}

	// Max loopIndex per (vhId, strandIdx, bpIndex) — strandIdx=1 enters an insert at maxLoop.
	const maxLoop = new Map<string, number>();
	for (const nt of nts) {
		const k = `${nt.vhId}:${nt.strandIdx}:${nt.bpIndex}`;
		const cur = maxLoop.get(k) ?? 0;
		if (nt.loopIndex > cur) maxLoop.set(k, nt.loopIndex);
	}

	// For each nt, find the physically adjacent nt in the 3′ direction on the same VH.
	// - When nt.next is on the same VH, use it directly: the NT model already computes
	//   insert ordering correctly for both strandIdx=0 (ascending loopIndex) and
	//   strandIdx=1 (descending loopIndex). Segment-boundary gaps (internal same-VH
	//   connections) are treated the same as explicit cadnano skips — the NT model
	//   removes skipped positions, so the next same-VH nt is always the physical neighbor.
	// - When nt.next is cross-VH (a crossover), look up the physical neighbor by position:
	//   strandIdx=0 enters the adjacent bp at loopIndex=0 (ascending direction);
	//   strandIdx=1 enters the adjacent bp at maxLoopIndex (descending direction).
	const physNext = new Int32Array(nts.length).fill(-1);
	for (const nt of nts) {
		if (nt.next !== -1 && nts[nt.next].vhId === nt.vhId) {
			// Same-VH 3′ neighbour. Adjacent bases (including across skips/deletions, which
			// close the helix) stay ~1 rise apart and stack. A genuine empty-space gap — an
			// internal same-VH connection bridging absent bp positions (e.g. bp82→179
			// on one VH) — leaves the flanking nts far apart along the axis; they do NOT stack,
			// matching mrDNA's own cadnano reader, which sets stack=-1 across such gaps.
			physNext[nt.id] = axialSeparationNm(nt, nts[nt.next]) <= MAX_STACK_AXIAL_NM ? nt.next : -1;
		} else {
			// Cross-VH or 3′ terminus: look for physical neighbor at bpIndex±1.
			// strandIdx=0: 3′ direction = +bpIndex; enter adjacent bp at loopIndex=0.
			// strandIdx=1: 3′ direction = −bpIndex; enter adjacent bp at its maxLoopIndex.
			const dir = nt.strandIdx === 0 ? 1 : -1;
			const nextBp = nt.bpIndex + dir;
			const nextLi =
				nt.strandIdx === 0 ? 0 : (maxLoop.get(`${nt.vhId}:${nt.strandIdx}:${nextBp}`) ?? 0);
			const neighborId = posToId.get(physPosKey(nt.vhId, nt.strandIdx, nextBp, nextLi));
			if (neighborId !== undefined) physNext[nt.id] = neighborId;
		}
	}
	return physNext;
}

function collectMrdnaNucleotidesFromModel(
	nts: SimulationNucleotide[],
	segPositionOverrides?: Map<string, BlockTransformOverride>
): MrdnaNucleotide[] {
	const bpOf = buildBpMap(nts);
	const physNextOf = buildPhysicalNeighborMap(nts);

	return nts.map((nt) => {
		const frame = transformFrame(
			nt.positionNm,
			nt.a1,
			nt.a3,
			segPositionOverrides?.get(nt.segmentId)
		);

		const nextId = nt.next;
		const thisBp = bpOf[nt.id];
		const physN = physNextOf[nt.id];
		// Stacking is physical co-axial stacking along the helix — independent of strand.
		// Use the spatially adjacent nt on the same VH in the 3′ direction (physNext),
		// not the strand's next nt (which may jump to a different VH at a crossover).
		const stackIdx = thisBp !== -1 && physN !== -1 && bpOf[physN] !== -1 ? physN : -1;

		return {
			position: frame.position,
			a1: frame.a1,
			a3: frame.a3,
			base: nt.base,
			bpIdx: thisBp,
			stackIdx,
			threePrimeIdx: nextId,
		};
	});
}

/** Mirror oligos (repeat copies) are left out unless `includeMirrors`. */
export function collectMrdnaNucleotides(
	part: Part,
	segPositionOverrides?: Map<string, BlockTransformOverride>,
	fallbackBase: MrdnaFallbackBase = 'T',
	includeMirrors = false
): MrdnaNucleotide[] {
	const model = buildSimulationNtModel(part, { fallbackBase, includeMirrors });
	return collectMrdnaNucleotidesFromModel(model.nucleotides, segPositionOverrides);
}

function fmt2(n: number): string {
	return Number.isFinite(n) ? n.toFixed(2) : '0.00';
}

function fmt6(n: number): string {
	return Number.isFinite(n) ? n.toFixed(6) : '0.000000';
}

function formatTxt(
	nts: MrdnaNucleotide[],
	includeSequence: boolean,
	includeOrientation: boolean
): string {
	const lines: string[] = [
		'# Text input for mrdna: one line per nucleotide',
		'# coord_x(nm) coord_y(nm) coord_z(nm) bp_idx stack_on_three_prime_idx three_prime_idx' +
			(includeSequence ? ' [seq' : '') +
			(includeOrientation ? ' Rxx Rxy Rxz Ryx Ryy Ryz Rzx Rzy Rzz' : '') +
			(includeSequence ? ']' : ''),
	];

	for (const nt of nts) {
		const { position: p, a1, a3 } = nt;
		let line = `${fmt2(p.x)} ${fmt2(p.y)} ${fmt2(p.z)} ${nt.bpIdx} ${nt.stackIdx} ${nt.threePrimeIdx}`;

		if (includeSequence) {
			line += ` ${nt.base}`;
		}

		if (includeOrientation) {
			const a2 = crossVec(a3, a1);
			line +=
				` ${fmt6(a1.x)} ${fmt6(a1.y)} ${fmt6(a1.z)}` +
				` ${fmt6(a2.x)} ${fmt6(a2.y)} ${fmt6(a2.z)}` +
				` ${fmt6(a3.x)} ${fmt6(a3.y)} ${fmt6(a3.z)}`;
		}

		lines.push(line);
	}

	return `${lines.join('\n')}\n`;
}

export function exportPartToMrdna(
	part: Part,
	options?: {
		fallbackBase?: MrdnaFallbackBase;
		includeSequence?: boolean;
		includeOrientation?: boolean;
		segPositionOverrides?: Map<string, BlockTransformOverride>;
		/** Include mirror oligos (repeat copies), exporting the assembled multimer. */
		includeMirrors?: boolean;
	}
): MrdnaExportResult {
	const {
		fallbackBase = 'T',
		includeSequence = true,
		includeOrientation = false,
		segPositionOverrides,
		includeMirrors = false,
	} = options ?? {};

	const model = buildSimulationNtModel(part, { fallbackBase, includeMirrors });
	const nts = collectMrdnaNucleotidesFromModel(model.nucleotides, segPositionOverrides);

	return {
		txt: formatTxt(nts, includeSequence, includeOrientation),
		nucleotideCount: nts.length,
		strandCount: model.strandCount,
	};
}
