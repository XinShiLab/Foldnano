import type { Part } from '$lib/model/Part';
import { assertSimulationReady } from '../checks/simulation';
import type Oligo from '$lib/model/Oligo/Oligo.svelte';
import type OligoSegment from '$lib/model/Oligo/OligoSegment.svelte';
import type VirtualHelix from '$lib/model/VirtualHelix';
import { type VirtualHelixFrame } from '$lib/model/geometry3d/dnaGeometry';
import type { Vec3 } from '$lib/model/geometry3d/types';
import { OXDNA_NM, OXDNA_BASE_BASE, OXDNA_CM_CENTER_DS } from './oxdnaConstants';

// All geometry in the NT model is in nanometres.
export const RISE_NM = OXDNA_BASE_BASE * OXDNA_NM;
export const CM_TO_BACKBONE_NM = 0.4 * OXDNA_NM; // CM → phosphate backbone offset along -a1
const CM_RADIUS_NM = OXDNA_CM_CENTER_DS * OXDNA_NM;

const BASES = ['A', 'T', 'C', 'G'] as const;
const COMPLEMENT: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G' };

export type SimulationFallbackBase = 'A' | 'T' | 'C' | 'G' | 'random';

export interface SimulationNtModel {
	nucleotides: SimulationNucleotide[];
	strandCount: number;
}

export interface SimulationNucleotide {
	id: number;
	strandId: number;
	base: string;
	/** True when `base` came from an assigned sequence char, not an auto-filled fallback. */
	baseAssigned: boolean;
	segmentId: string;
	vhId: string;
	vhIndex: number;
	strandIdx: 0 | 1;
	bpIndex: number;
	loopIndex: number;
	positionNm: Vec3;
	a1: Vec3;
	a3: Vec3;
	prev: number;
	next: number;
	pairKey: string;
	spanId: string;
	isFixed: boolean;
}

interface NtFrame {
	positionNm: Vec3;
	a1: Vec3;
	a3: Vec3;
	spanId: string;
	isFixed: boolean;
}

interface PhysicalLayer {
	bpIndex: number;
	loopIndex: number;
	isFixed: boolean;
	spanId: string;
}

interface SlotInfo {
	seqLenByStrand: [number | undefined, number | undefined];
	hasSlotByStrand: [boolean, boolean];
	isFixed: boolean;
}

function randomBase(): string {
	return BASES[Math.floor(Math.random() * 4)];
}

function isReal(base: string): base is 'A' | 'T' | 'C' | 'G' {
	return base === 'A' || base === 'T' || base === 'C' || base === 'G';
}

function crossVec(a: Vec3, b: Vec3): Vec3 {
	return {
		x: a.y * b.z - a.z * b.y,
		y: a.z * b.x - a.x * b.z,
		z: a.x * b.y - a.y * b.x,
	};
}

function addVec(a: Vec3, b: Vec3): Vec3 {
	return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scaleVec(v: Vec3, scale: number): Vec3 {
	return { x: v.x * scale, y: v.y * scale, z: v.z * scale };
}

function ntKey(vhIndex: number, strandIdx: 0 | 1, bpIndex: number, loopIndex: number): string {
	return loopIndex === 0
		? `${vhIndex}:${strandIdx}:${bpIndex}`
		: `${vhIndex}:${strandIdx}:${bpIndex}:${loopIndex}`;
}

function frameKey(vhId: string, strandIdx: 0 | 1, bpIndex: number, loopIndex: number): string {
	return `${vhId}:${strandIdx}:${bpIndex}:${loopIndex}`;
}

function pairKey(vhId: string, bpIndex: number, loopIndex: number): string {
	return `${vhId}:${bpIndex}:${loopIndex}`;
}

function sortedSegments(oligo: Oligo): OligoSegment[] {
	return [...oligo.segments].sort((a, b) => a.id.localeCompare(b.id));
}

function orderedSegments(oligo: Oligo): OligoSegment[] {
	const ordered: OligoSegment[] = [];
	const seen = new Set<string>();
	const fallback = sortedSegments(oligo);
	let current: OligoSegment | null = oligo.fivePrimeEndSegment ?? fallback[0] ?? null;

	while (current && !seen.has(current.id) && oligo.segments.has(current)) {
		ordered.push(current);
		seen.add(current.id);
		current = current.threePrime.connectedSegment;
	}

	for (const seg of fallback) {
		if (!seen.has(seg.id)) ordered.push(seg);
	}
	return ordered;
}

function isConstrainedAnchorAt(part: Part, vh: VirtualHelix, bpIndex: number): boolean {
	const region = part.getRegionForVh(vh);
	if (!region.supportsConstrainedXoverSites) return false;
	for (const strandIdx of [0, 1] as const) {
		const { end } = part.getEntitiesAtVh(vh.id, strandIdx, bpIndex);
		if (end && !end.isFree && end.isConstrained) return true;
	}
	return false;
}

function collectSlotInfo(part: Part, vh: VirtualHelix): Map<number, SlotInfo> {
	const byBp = new Map<number, SlotInfo>();
	for (const strandIdx of [0, 1] as const) {
		for (const segId of vh.strandSets[strandIdx].segmentIds) {
			const segment = part.getSegmentById(segId);
			if (!segment) continue;
			for (const slot of segment.slots) {
				let info = byBp.get(slot.bpIndex);
				if (!info) {
					info = {
						seqLenByStrand: [undefined, undefined],
						hasSlotByStrand: [false, false],
						isFixed: false,
					};
					byBp.set(slot.bpIndex, info);
				}
				info.seqLenByStrand[strandIdx] = slot.seq.length;
				info.hasSlotByStrand[strandIdx] = true;
			}
		}
	}
	for (const [bpIndex, info] of byBp) {
		info.isFixed = isConstrainedAnchorAt(part, vh, bpIndex);
	}
	return byBp;
}

export function simulationFrameForVh(part: Part, vh: VirtualHelix): VirtualHelixFrame {
	// The 3D view now uses physical (oxDNA) geometry for all lattice types, so the
	// regular VH frame is already at the correct physical position.
	return part.getVirtualHelixFrame(vh);
}

function physicalLayersForBp(bpIndex: number, info: SlotInfo): PhysicalLayer[] {
	const layerCount = Math.max(info.seqLenByStrand[0] ?? 0, info.seqLenByStrand[1] ?? 0);
	const layers: PhysicalLayer[] = [];
	for (let loopIndex = 0; loopIndex < layerCount; loopIndex++) {
		layers.push({
			bpIndex,
			loopIndex,
			isFixed: info.isFixed && loopIndex === 0,
			spanId: '',
		});
	}
	return layers;
}

function buildLayersForRange(
	bpIndices: number[],
	slotInfo: Map<number, SlotInfo>
): PhysicalLayer[] {
	const layers: PhysicalLayer[] = [];
	for (const bpIndex of bpIndices) {
		const info = slotInfo.get(bpIndex);
		if (!info) continue;
		layers.push(...physicalLayersForBp(bpIndex, info));
	}
	return layers;
}

function contiguousRanges(indices: number[]): number[][] {
	const ranges: number[][] = [];
	let current: number[] = [];
	for (const bpIndex of indices) {
		if (current.length === 0 || bpIndex === current[current.length - 1] + 1) {
			current.push(bpIndex);
		} else {
			ranges.push(current);
			current = [bpIndex];
		}
	}
	if (current.length > 0) ranges.push(current);
	return ranges;
}

function splitRangeByAnchors(range: number[], slotInfo: Map<number, SlotInfo>): number[][] {
	const anchors = range.filter((bpIndex) => slotInfo.get(bpIndex)?.isFixed);
	if (anchors.length === 0) return [range];
	// Build non-overlapping spans between consecutive boundary points.
	// Boundaries = range start + each anchor + range end (deduped and sorted).
	const boundaries = [...new Set([range[0], ...anchors, range[range.length - 1]])].sort(
		(a, b) => a - b
	);
	const spans: number[][] = [];
	for (let i = 0; i < boundaries.length - 1; i++) {
		spans.push(range.filter((bpIndex) => bpIndex >= boundaries[i] && bpIndex <= boundaries[i + 1]));
	}
	if (spans.length === 0) spans.push(range);
	return spans.filter((s) => s.length > 0);
}

function mergeAdjacentRanges(ranges: number[][], vh: VirtualHelix, part: Part): number[][] {
	if (ranges.length <= 1) return ranges;
	// Collect gaps that are bridged by a same-VH end-to-end segment connection.
	const bridgedGaps = new Set<string>();
	for (const strandIdx of [0, 1] as const) {
		for (const segId of vh.strandSets[strandIdx].segmentIds) {
			const seg = part.getSegmentById(segId);
			if (!seg || seg.threePrime.isFree) continue;
			const nextSeg = seg.threePrime.connectedSegment;
			if (!nextSeg || nextSeg.inVirtualHelix !== vh) continue;
			const lastBp = Math.max(...seg.slots.map((s) => s.bpIndex));
			const firstBp = Math.min(...nextSeg.slots.map((s) => s.bpIndex));
			bridgedGaps.add(`${lastBp}:${firstBp}`);
		}
	}
	const merged: number[][] = [];
	let current = ranges[0];
	for (let i = 1; i < ranges.length; i++) {
		const prevLast = current[current.length - 1];
		const nextFirst = ranges[i][0];
		if (bridgedGaps.has(`${prevLast}:${nextFirst}`)) {
			current = [...current, ...ranges[i]];
		} else {
			merged.push(current);
			current = ranges[i];
		}
	}
	merged.push(current);
	return merged;
}

function makeNtFrame(
	vhFrame: VirtualHelixFrame,
	strandIdx: 0 | 1,
	coord: number,
	angleDeg: number
): Pick<NtFrame, 'positionNm' | 'a1' | 'a3'> {
	const center = addVec(vhFrame.origin, scaleVec(vhFrame.axis, coord * RISE_NM));
	const radial1 = crossVec(vhFrame.axis, vhFrame.radial0);
	const angleRad = (angleDeg * Math.PI) / 180;
	const c = Math.cos(angleRad);
	const s = Math.sin(angleRad);
	const radial = {
		x: c * vhFrame.radial0.x + s * radial1.x,
		y: c * vhFrame.radial0.y + s * radial1.y,
		z: c * vhFrame.radial0.z + s * radial1.z,
	};
	const sign = strandIdx === 0 ? -1 : 1;
	return {
		positionNm: addVec(center, scaleVec(radial, CM_RADIUS_NM)),
		a1: scaleVec(radial, -1),
		a3: scaleVec(vhFrame.axis, sign),
	};
}

function buildGeometryFrames(part: Part): Map<string, NtFrame> {
	const frames = new Map<string, NtFrame>();
	for (const vh of part.virtualHelices) {
		const slotInfo = collectSlotInfo(part, vh);
		const bpIndices = [...slotInfo.keys()].sort((a, b) => a - b);
		if (bpIndices.length === 0) continue;
		const region = part.getRegionForVh(vh);
		const vhFrame = simulationFrameForVh(part, vh);
		const twistPerLayerDeg = region.twistPerBaseInDeg;
		const baseAngle = (coord: number) => region.twistOffsetInDeg + twistPerLayerDeg * coord;

		for (const range of mergeAdjacentRanges(contiguousRanges(bpIndices), vh, part)) {
			for (const span of splitRangeByAnchors(range, slotInfo)) {
				const layers = buildLayersForRange(span, slotInfo);
				if (layers.length === 0) continue;
				const firstBp = span[0];
				const lastBp = span[span.length - 1];
				const firstFixed = Boolean(slotInfo.get(firstBp)?.isFixed);
				const lastFixed = Boolean(slotInfo.get(lastBp)?.isFixed);
				const spanId = `${vh.id}:${firstBp}-${lastBp}`;
				const firstAngle = baseAngle(firstBp);
				const lastAngle = baseAngle(lastBp);

				// Precompute the cumulative net offset (inserts − skips) before each bpIndex.
				// seqLen − 1 is +n for an insert of n, 0 for a normal bp, −1 for a skip.
				// Using seqLen−1 (not clamped to 0) ensures skips compress coords just as
				// inserts stretch them, so the formula stays consistent with the original
				// layer-count approach while correctly handling physical gaps in merged ranges.
				const cumNetOffsetAt = new Map<number, number>();
				let runningNetOffset = 0;
				for (const bp of span) {
					cumNetOffsetAt.set(bp, runningNetOffset);
					const info = slotInfo.get(bp);
					const seqLen = Math.max(info?.seqLenByStrand[0] ?? 0, info?.seqLenByStrand[1] ?? 0);
					runningNetOffset += seqLen - 1;
				}
				const totalSpanNetOffset = runningNetOffset;

				for (let i = 0; i < layers.length; i++) {
					const layer = layers[i];
					let coord: number;
					let angleDeg: number;
					if (firstFixed && lastFixed && layers.length > 1) {
						// Distribute by each layer's natural bpIndex-anchored coordinate, not by
						// layer index. A merged same-VH gap inside a fixed-fixed span has missing
						// bpIndices (no layers); layer-index interpolation would spread layers evenly
						// and drop nucleotides into the empty gap. The natural coord preserves the gap,
						// then a linear rescale keeps both fixed endpoints pinned (conserving total
						// axial length/twist when the span contains inserts/skips). Fixed anchors carry
						// no insert/skip (assertSimulationReady enforces this), so natFirst = firstBp.
						const natFirst = firstBp;
						const natLast = lastBp + totalSpanNetOffset;
						const nat = layer.bpIndex + (cumNetOffsetAt.get(layer.bpIndex) ?? 0) + layer.loopIndex;
						const t = natLast === natFirst ? 0 : (nat - natFirst) / (natLast - natFirst);
						coord = firstBp + (lastBp - firstBp) * t;
						angleDeg = firstAngle + (lastAngle - firstAngle) * t;
					} else if (firstFixed || (!firstFixed && !lastFixed)) {
						// firstFixed or free-free: grow naturally from firstBp toward higher bpIndex.
						// bpIndex-based coord correctly preserves physical gaps in merged ranges.
						coord = layer.bpIndex + (cumNetOffsetAt.get(layer.bpIndex) ?? 0) + layer.loopIndex;
						angleDeg = baseAngle(coord);
					} else {
						// lastFixed: grow naturally backward from lastBp toward lower bpIndex.
						// (lastBp − bpIndex) counts canonical bp steps including any gap bpIndices,
						// so the gap contributes physical space without a nucleotide.
						const info = slotInfo.get(layer.bpIndex)!;
						const seqLen = Math.max(info.seqLenByStrand[0] ?? 1, info.seqLenByStrand[1] ?? 1);
						const cumBefore = cumNetOffsetAt.get(layer.bpIndex) ?? 0;
						const netAtBp = seqLen - 1; // ≥ 0 here: skips emit no layers
						const totalNetOffsetAfter = totalSpanNetOffset - cumBefore - netAtBp;
						const stepsFromAnchor =
							lastBp - layer.bpIndex + totalNetOffsetAfter + (seqLen - 1 - layer.loopIndex);
						coord = lastBp - stepsFromAnchor;
						angleDeg = baseAngle(coord);
					}
					layer.spanId = spanId;
					for (const strandIdx of [0, 1] as const) {
						const info = slotInfo.get(layer.bpIndex);
						if (!info?.hasSlotByStrand[strandIdx]) continue;
						const seqLen = info.seqLenByStrand[strandIdx] ?? 0;
						if (layer.loopIndex >= seqLen) continue;
						frames.set(frameKey(vh.id, strandIdx, layer.bpIndex, layer.loopIndex), {
							...makeNtFrame(vhFrame, strandIdx, coord, angleDeg + strandIdx * 180),
							spanId,
							isFixed: layer.isFixed,
						});
					}
				}
			}
		}
	}
	return frames;
}

function buildBaseCache(part: Part): { cache: Map<string, string>; occupied: Set<string> } {
	const cache = new Map<string, string>();
	const occupied = new Set<string>();
	for (const oligo of part.oligos) {
		for (const segment of oligo.segments) {
			const vhIndex = segment.inVirtualHelix.index;
			const strandIdx = segment.inStrandIndex as 0 | 1;
			for (const slot of segment.slots) {
				const count = slot.seq.length;
				const canonicalJ = strandIdx === 0 ? 0 : count - 1;
				let j = 0;
				for (const base of slot.seq) {
					const loopIndex = strandIdx === 0 ? j : count - 1 - j;
					const key = ntKey(vhIndex, strandIdx, slot.bpIndex, loopIndex);
					occupied.add(key);
					const b = base.toUpperCase();
					if (j === canonicalJ || loopIndex > 0) {
						if (isReal(b)) cache.set(key, b);
					}
					j++;
				}
			}
		}
	}
	return { cache, occupied };
}

function resolveBase(
	raw: string,
	vhIndex: number,
	strandIdx: 0 | 1,
	bpIndex: number,
	loopIndex: number,
	baseCache: Map<string, string>,
	occupied: Set<string>,
	ssDnaFallback: SimulationFallbackBase
): string {
	const upper = raw.toUpperCase();
	if (isReal(upper)) return upper;

	const key = ntKey(vhIndex, strandIdx, bpIndex, loopIndex);
	const compKey = ntKey(vhIndex, (1 - strandIdx) as 0 | 1, bpIndex, loopIndex);
	const compBase = baseCache.get(compKey);
	if (compBase) {
		const base = COMPLEMENT[compBase] ?? randomBase();
		baseCache.set(key, base);
		return base;
	}
	if (occupied.has(compKey)) {
		const base = randomBase();
		baseCache.set(key, base);
		return base;
	}
	const base = ssDnaFallback === 'random' ? randomBase() : ssDnaFallback;
	baseCache.set(key, base);
	return base;
}

export function buildSimulationNtModel(
	part: Part,
	options: { fallbackBase?: SimulationFallbackBase; includeMirrors?: boolean } = {}
): SimulationNtModel {
	assertSimulationReady(part);
	const fallbackBase = options.fallbackBase ?? 'T';
	const includeMirrors = options.includeMirrors ?? true;
	const frames = buildGeometryFrames(part);
	const { cache: baseCache, occupied } = buildBaseCache(part);
	const nucleotides: SimulationNucleotide[] = [];
	let strandId = 1;

	for (const oligo of part.oligos) {
		if (oligo.isMirror && !includeMirrors) continue;
		const strandStart = nucleotides.length;
		for (const segment of orderedSegments(oligo)) {
			const vh = segment.inVirtualHelix;
			const strandIdx = segment.inStrandIndex as 0 | 1;
			for (const slot of segment.slots) {
				const count = slot.seq.length;
				let j = 0;
				for (const rawBase of slot.seq) {
					const loopIndex = strandIdx === 0 ? j : count - 1 - j;
					const frame = frames.get(frameKey(vh.id, strandIdx, slot.bpIndex, loopIndex));
					if (!frame) {
						throw new Error(
							`Cannot export simulation model: missing geometry for VH ${vh.index}, ` +
								`strand ${strandIdx}, bp ${slot.bpIndex}, loop ${loopIndex}.`
						);
					}
					nucleotides.push({
						id: nucleotides.length,
						strandId,
						base: resolveBase(
							rawBase,
							vh.index,
							strandIdx,
							slot.bpIndex,
							loopIndex,
							baseCache,
							occupied,
							fallbackBase
						),
						baseAssigned: isReal(rawBase.toUpperCase()),
						segmentId: segment.id,
						vhId: vh.id,
						vhIndex: vh.index,
						strandIdx,
						bpIndex: slot.bpIndex,
						loopIndex,
						positionNm: frame.positionNm,
						a1: frame.a1,
						a3: frame.a3,
						prev: -1,
						next: -1,
						pairKey: pairKey(vh.id, slot.bpIndex, loopIndex),
						spanId: frame.spanId,
						isFixed: frame.isFixed,
					});
					j++;
				}
			}
		}
		const strandEnd = nucleotides.length;
		if (strandEnd > strandStart) {
			for (let i = strandStart; i < strandEnd; i++) {
				nucleotides[i].prev = i === strandStart ? -1 : i - 1;
				nucleotides[i].next = i === strandEnd - 1 ? -1 : i + 1;
			}
			if (oligo.isCircular) {
				nucleotides[strandStart].prev = strandEnd - 1;
				nucleotides[strandEnd - 1].next = strandStart;
			}
			strandId++;
		}
	}

	return { nucleotides, strandCount: strandId - 1 };
}
