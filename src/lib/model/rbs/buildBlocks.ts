/**
 * Builds topology-first RBS blocks from the cadnano Part model.
 *
 * A block is a rigid connected component of occupied VH spans. Normal strand
 * continuity is represented by each OligoSegment span, complementary same-VH
 * overlap welds duplex material, and constrained crossovers weld blocks across
 * VHs. Unconstrained crossovers become distance constraints.
 */

import type { Part } from '$lib/model/Part';
import type OligoSegment from '$lib/model/Oligo/OligoSegment.svelte';
import {
	BACKBONE_RISE_NM,
	HEX_INTERHELIX_NM,
	backbonePoint,
	type VirtualHelixFrame,
} from '$lib/model/geometry3d/dnaGeometry';
import type {
	BlockBody,
	BlockBuildResult,
	BlockCollisionCapsule,
	BlockSpan,
	BlockTransformOverride,
	DistanceConstraint,
	Quat,
	Vec3,
} from './rbsTypes';

export const UNCONSTRAINED_CROSSOVER_REST_LENGTH_NM = 0.6;
// Scaled to maintain ~23% clearance at the tighter honeycomb spacing (2.172 nm).
// Old value was 1.0 nm for the 2.6 nm visual grid; preserving the ratio 1.0/1.3.
const HELIX_RADIUS_NM = (HEX_INTERHELIX_NM / 2) * (1.0 / 1.3); // ~0.835 nm

class UnionFind {
	private parent = new Map<string, string>();

	add(id: string): void {
		if (!this.parent.has(id)) this.parent.set(id, id);
	}

	find(id: string): string {
		const p = this.parent.get(id);
		if (!p) {
			this.parent.set(id, id);
			return id;
		}
		if (p === id) return id;
		const root = this.find(p);
		this.parent.set(id, root);
		return root;
	}

	union(a: string, b: string): void {
		const ra = this.find(a);
		const rb = this.find(b);
		if (ra !== rb) this.parent.set(rb, ra);
	}
}

function rangeOverlap(aLo: number, aHi: number, bLo: number, bHi: number): boolean {
	return aHi >= bLo && bHi >= aLo;
}

function getSegmentLoHi(seg: OligoSegment): { lo: number; hi: number } {
	return {
		lo: Math.min(seg.fivePrime.index, seg.threePrime.index),
		hi: Math.max(seg.fivePrime.index, seg.threePrime.index),
	};
}

function addVec(a: Vec3, b: Vec3): Vec3 {
	return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function subVec(a: Vec3, b: Vec3): Vec3 {
	return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scaleVec(a: Vec3, s: number): Vec3 {
	return { x: a.x * s, y: a.y * s, z: a.z * s };
}

function referencePoint(
	part: Part,
	vhIndex: number,
	strandIdx: 0 | 1,
	bpIdx: number,
	vhFrames: Map<number, VirtualHelixFrame>
): Vec3 {
	const frame = vhFrames.get(vhIndex);
	if (!frame) return { x: 0, y: 0, z: bpIdx * BACKBONE_RISE_NM };
	const vh = part.getVhByIndex(vhIndex);
	const region = vh ? part.getRegionForVh(vh) : null;
	const twistOffsetDeg = region?.twistOffsetInDeg ?? 0;
	const twistPerBaseDeg = region?.twistPerBaseInDeg ?? 0;
	return backbonePoint(frame, bpIdx, strandIdx, twistOffsetDeg, twistPerBaseDeg);
}

function identityQuat(): Quat {
	return { x: 0, y: 0, z: 0, w: 1 };
}

function isConstrainedConnection(seg: OligoSegment, toSeg: OligoSegment): boolean {
	return (
		seg.threePrime.isConstrained ||
		seg.threePrime.inPart.canEndsBeConstrained(seg.threePrime, toSeg.fivePrime)
	);
}

function buildBlockBody(
	blockId: string,
	inputSpans: BlockSpan[],
	part: Part,
	vhFrames: Map<number, VirtualHelixFrame>
): BlockBody {
	let pointSum: Vec3 = { x: 0, y: 0, z: 0 };
	let points = 0;

	for (const span of inputSpans) {
		const p0 = referencePoint(part, span.vhIndex, span.strandIdx, span.lo, vhFrames);
		const p1 = referencePoint(part, span.vhIndex, span.strandIdx, span.hi, vhFrames);
		pointSum = addVec(addVec(pointSum, p0), p1);
		points += 2;
	}

	const originalCenter = points > 0 ? scaleVec(pointSum, 1 / points) : { x: 0, y: 0, z: 0 };
	const spans = inputSpans.map((span) => ({ ...span, segmentIds: [...span.segmentIds] }));
	const collisionCapsules = buildCollisionCapsules(blockId, spans, part, vhFrames, originalCenter);
	const mass = 25;
	let radius = HELIX_RADIUS_NM;
	for (const capsule of collisionCapsules) {
		const startRadius = Math.hypot(
			capsule.localStart.x,
			capsule.localStart.y,
			capsule.localStart.z
		);
		const endRadius = Math.hypot(capsule.localEnd.x, capsule.localEnd.y, capsule.localEnd.z);
		radius = Math.max(radius, startRadius + HELIX_RADIUS_NM, endRadius + HELIX_RADIUS_NM);
	}
	const sphericalInertia = Math.max(0.4 * mass * radius * radius, 1e-6);
	const inertia = {
		x: sphericalInertia,
		y: sphericalInertia,
		z: sphericalInertia,
	};

	return {
		blockId,
		spans,
		collisionCapsules,
		originalCenter,
		position: { ...originalCenter },
		quaternion: identityQuat(),
		mass,
		inertia,
		radius,
	};
}

function buildCollisionCapsules(
	blockId: string,
	spans: BlockSpan[],
	part: Part,
	vhFrames: Map<number, VirtualHelixFrame>,
	originalCenter: Vec3
): BlockCollisionCapsule[] {
	const rangesByVh = new Map<number, Array<[number, number]>>();
	for (const span of spans) {
		let ranges = rangesByVh.get(span.vhIndex);
		if (!ranges) {
			ranges = [];
			rangesByVh.set(span.vhIndex, ranges);
		}
		ranges.push([span.lo, span.hi]);
	}

	const capsules: BlockCollisionCapsule[] = [];
	for (const [vhIndex, ranges] of rangesByVh) {
		ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
		const merged: Array<[number, number]> = [];
		for (const range of ranges) {
			const last = merged[merged.length - 1];
			if (last && range[0] <= last[1] + 1) last[1] = Math.max(last[1], range[1]);
			else merged.push([...range]);
		}
		for (const [lo, hi] of merged) {
			const p0 = referencePoint(part, vhIndex, 0, lo, vhFrames);
			const p1 = referencePoint(part, vhIndex, 0, hi, vhFrames);
			capsules.push({
				id: `${blockId}:vh${vhIndex}:${lo}-${hi}`,
				vhIndex,
				lo,
				hi,
				localStart: subVec(p0, originalCenter),
				localEnd: subVec(p1, originalCenter),
				radius: HELIX_RADIUS_NM,
			});
		}
	}
	return capsules;
}

export function buildBlocksAndConstraints(part: Part): BlockBuildResult {
	const spans: BlockSpan[] = [];
	const spanBySegmentId = new Map<string, BlockSpan>();
	const segments: OligoSegment[] = [];
	const uf = new UnionFind();
	const vhFrames = new Map<number, VirtualHelixFrame>();

	for (const vh of part.virtualHelices) {
		vhFrames.set(vh.index, part.getVirtualHelixFrame(vh));
	}

	for (const oligo of part.oligos) {
		for (const seg of oligo.segments) {
			const { lo, hi } = getSegmentLoHi(seg);
			const span: BlockSpan = {
				spanId: seg.id,
				vhIndex: seg.inVirtualHelix.index,
				rowIdx: seg.inVirtualHelix.listRow,
				strandIdx: seg.inStrandIndex,
				lo,
				hi,
				segmentIds: [seg.id],
			};
			spans.push(span);
			segments.push(seg);
			spanBySegmentId.set(seg.id, span);
			uf.add(span.spanId);
		}
	}

	// Weld complementary occupied spans on the same VH into duplex blocks.
	for (let i = 0; i < spans.length; i++) {
		for (let j = i + 1; j < spans.length; j++) {
			const a = spans[i];
			const b = spans[j];
			if (a.vhIndex !== b.vhIndex) continue;
			if (a.strandIdx === b.strandIdx) continue;
			if (rangeOverlap(a.lo, a.hi, b.lo, b.hi)) uf.union(a.spanId, b.spanId);
		}
	}

	// Weld constrained crossovers. Unconstrained crossovers are handled later.
	for (const seg of segments) {
		const toSeg = seg.threePrime.connectedSegment;
		if (!toSeg) continue;
		const fromSpan = spanBySegmentId.get(seg.id);
		const toSpan = spanBySegmentId.get(toSeg.id);
		if (!fromSpan || !toSpan) continue;
		if (isConstrainedConnection(seg, toSeg)) uf.union(fromSpan.spanId, toSpan.spanId);
	}

	const rootToSpans = new Map<string, BlockSpan[]>();
	for (const span of spans) {
		const root = uf.find(span.spanId);
		let list = rootToSpans.get(root);
		if (!list) {
			list = [];
			rootToSpans.set(root, list);
		}
		list.push(span);
	}

	const sortedGroups = [...rootToSpans.values()].sort((a, b) => {
		const a0 = a.slice().sort((x, y) => x.vhIndex - y.vhIndex || x.lo - y.lo)[0];
		const b0 = b.slice().sort((x, y) => x.vhIndex - y.vhIndex || x.lo - y.lo)[0];
		return a0.vhIndex - b0.vhIndex || a0.lo - b0.lo || a0.strandIdx - b0.strandIdx;
	});

	const blocks: BlockBody[] = [];
	const spanToBlockId = new Map<string, string>();
	const segmentToBlockId = new Map<string, string>();

	for (let i = 0; i < sortedGroups.length; i++) {
		const blockId = `B${i + 1}`;
		const groupSpans = sortedGroups[i].sort(
			(a, b) => a.vhIndex - b.vhIndex || a.lo - b.lo || a.strandIdx - b.strandIdx
		);
		for (const span of groupSpans) {
			spanToBlockId.set(span.spanId, blockId);
			for (const segmentId of span.segmentIds) segmentToBlockId.set(segmentId, blockId);
		}
		blocks.push(buildBlockBody(blockId, groupSpans, part, vhFrames));
	}

	const blockById = new Map(blocks.map((block) => [block.blockId, block]));
	const constraints: DistanceConstraint[] = [];
	for (const seg of segments) {
		const toSeg = seg.threePrime.connectedSegment;
		if (!toSeg) continue;
		if (isConstrainedConnection(seg, toSeg)) continue;
		const blockIdA = segmentToBlockId.get(seg.id);
		const blockIdB = segmentToBlockId.get(toSeg.id);
		if (!blockIdA || !blockIdB || blockIdA === blockIdB) continue;
		const blockA = blockById.get(blockIdA);
		const blockB = blockById.get(blockIdB);
		if (!blockA || !blockB) continue;

		const attachA = referencePoint(
			part,
			seg.inVirtualHelix.index,
			seg.inStrandIndex,
			seg.threePrime.index,
			vhFrames
		);
		const attachB = referencePoint(
			part,
			toSeg.inVirtualHelix.index,
			toSeg.inStrandIndex,
			toSeg.fivePrime.index,
			vhFrames
		);

		constraints.push({
			id: `${seg.id}:3-${toSeg.id}:5`,
			blockIdA,
			blockIdB,
			localAttachA: subVec(attachA, blockA.originalCenter),
			localAttachB: subVec(attachB, blockB.originalCenter),
			restLength: UNCONSTRAINED_CROSSOVER_REST_LENGTH_NM,
			source: 'unconstrained-crossover',
		});
	}

	return { blocks, constraints, segmentToBlockId, spanToBlockId };
}

export function buildSegmentBlockOverrides(
	segmentToBlockId: Map<string, string>,
	transforms: Map<string, BlockTransformOverride>
): Map<string, BlockTransformOverride> {
	const overrides = new Map<string, BlockTransformOverride>();
	for (const [segmentId, blockId] of segmentToBlockId) {
		const transform = transforms.get(blockId);
		if (transform) overrides.set(segmentId, transform);
	}
	return overrides;
}
