import type Oligo from '$lib/model/Oligo';
import type OligoSegment from '$lib/model/Oligo/OligoSegment.svelte';

export type ScaffoldKind = 'circular' | 'broken-circular' | 'linear';

// Angle constants
const GAP_HALF_RAD = 0.08; // ~4.6° gap for broken-circular break marker
const LINEAR_PAD = Math.PI / 3; // 60° pad each side → 120° gap at top

export function classifyScaffold(oligo: Oligo): ScaffoldKind {
	if (oligo.isCircular) return 'circular';
	const tp = oligo.threePrime;
	const fp = oligo.fivePrime;
	if (tp && fp && tp.isAdjacentTo(fp)) return 'broken-circular';
	return 'linear';
}

export function scaffoldPosToAngle(pos: number, total: number, kind: ScaffoldKind): number {
	const t = total > 0 ? pos / total : 0;
	switch (kind) {
		case 'circular':
			return -Math.PI / 2 + t * 2 * Math.PI;
		case 'broken-circular':
			return -Math.PI / 2 + GAP_HALF_RAD + t * (2 * Math.PI - 2 * GAP_HALF_RAD);
		case 'linear':
			return -Math.PI / 2 + LINEAR_PAD + t * (2 * Math.PI - 2 * LINEAR_PAD);
	}
}

export interface ScaffoldPositionMap {
	posMap: Map<string, number>;
	/** Which scaffold segment owns each bp — used to detect scaffold crossover spans. */
	segMap: Map<string, OligoSegment>;
	totalLength: number;
}

function posKey(vhId: string, strandIdx: number, bpIdx: number): string {
	return `${vhId}:${strandIdx}:${bpIdx}`;
}

function getOrderedSegments(scaffold: Oligo): OligoSegment[] {
	const segs: OligoSegment[] = [];
	if (scaffold.isCircular) {
		const startSeg = Array.from(scaffold.segments)[0];
		if (!startSeg) return segs;
		let cur: OligoSegment | null = startSeg;
		do {
			segs.push(cur);
			cur = cur.threePrime.connectedSegment;
		} while (cur && cur !== startSeg);
	} else {
		let cur: OligoSegment | null = scaffold.fivePrimeEndSegment;
		while (cur) {
			segs.push(cur);
			cur = cur.threePrime.connectedSegment;
		}
	}
	return segs;
}

export function buildScaffoldPositionMap(scaffold: Oligo): ScaffoldPositionMap {
	const posMap = new Map<string, number>();
	const segMap = new Map<string, OligoSegment>();
	let pos = 0;
	for (const seg of getOrderedSegments(scaffold)) {
		const vhId = seg.inVirtualHelix.id;
		const strandIdx = seg.inStrandIndex;
		for (const slot of seg.slots) {
			if (slot.seq.length === 0) continue; // skip slots have no nucleotide
			const key = posKey(vhId, strandIdx, slot.bpIndex);
			posMap.set(key, pos);
			segMap.set(key, seg);
			pos += slot.seq.length; // insertions count as multiple positions
		}
	}
	return { posMap, segMap, totalLength: pos };
}

function getOrderedStapleSegments(staple: Oligo): OligoSegment[] {
	const segs: OligoSegment[] = [];
	let cur: OligoSegment | null = staple.fivePrimeEndSegment;
	if (!cur) {
		cur = Array.from(staple.segments)[0] ?? null;
		if (!cur) return segs;
		const start = cur;
		do {
			segs.push(cur);
			cur = cur.threePrime.connectedSegment;
		} while (cur && cur !== start);
		return segs;
	}
	while (cur) {
		segs.push(cur);
		cur = cur.threePrime.connectedSegment;
	}
	return segs;
}

export interface StapleVisualization {
	arcs: { startPos: number; endPos: number }[];
	chords: { pos1: number; pos2: number }[];
}

/**
 * Returns arcs (hybridized scaffold regions) and chords (connections) for a staple.
 *
 * Arcs are split wherever the staple spans a scaffold crossover — i.e., when consecutive
 * bp indices of the staple map to different scaffold segments. The chord between those
 * split arcs represents the physical continuity of the double helix across the scaffold
 * crossover, which the staple "bridges" without its own crossover.
 *
 * Real staple crossovers (connections between separate segments) also produce chords.
 */
export function getStapleVisualization(
	staple: Oligo,
	posMapData: ScaffoldPositionMap
): StapleVisualization {
	const arcs: { startPos: number; endPos: number }[] = [];
	const chords: { pos1: number; pos2: number }[] = [];
	const orderedSegs = getOrderedStapleSegments(staple);

	for (let si = 0; si < orderedSegs.length; si++) {
		const seg = orderedSegs[si];
		const vhId = seg.inVirtualHelix.id;
		const scaffoldStrandIdx = 1 - seg.inStrandIndex;

		// Collect scaffold positions for each slot of this staple segment, sorted by bp index.
		const entries: { bp: number; pos: number; scaffoldSeg: OligoSegment }[] = [];
		for (const slot of seg.slots) {
			const key = posKey(vhId, scaffoldStrandIdx, slot.bpIndex);
			const pos = posMapData.posMap.get(key);
			const scaffoldSeg = posMapData.segMap.get(key);
			if (pos !== undefined && scaffoldSeg !== undefined) {
				entries.push({ bp: slot.bpIndex, pos, scaffoldSeg });
			}
		}
		entries.sort((a, b) => a.bp - b.bp);

		if (entries.length === 0) continue;

		// Walk through entries, grouping by scaffold segment membership.
		// When the group changes → emit the current arc and a chord to the next group.
		let groupMinPos = entries[0].pos;
		let groupMaxPos = entries[0].pos;
		let lastEntry = entries[0];

		for (let i = 1; i < entries.length; i++) {
			const cur = entries[i];
			if (cur.scaffoldSeg === lastEntry.scaffoldSeg) {
				groupMinPos = Math.min(groupMinPos, cur.pos);
				groupMaxPos = Math.max(groupMaxPos, cur.pos);
			} else {
				// Scaffold crossover span detected: this staple segment crosses a point
				// where the scaffold itself jumps to a different region of the design.
				arcs.push({ startPos: groupMinPos, endPos: groupMaxPos });
				chords.push({ pos1: lastEntry.pos, pos2: cur.pos });
				groupMinPos = cur.pos;
				groupMaxPos = cur.pos;
			}
			lastEntry = cur;
		}
		arcs.push({ startPos: groupMinPos, endPos: groupMaxPos });

		// Real staple crossover to the next segment → chord.
		if (si < orderedSegs.length - 1) {
			const nextSeg = orderedSegs[si + 1];
			if (!seg.isAdjacentTo(nextSeg)) {
				const pos1 = posMapData.posMap.get(posKey(vhId, scaffoldStrandIdx, seg.threePrime.index));
				const nextVhId = nextSeg.inVirtualHelix.id;
				const nextScaffoldStrandIdx = 1 - nextSeg.inStrandIndex;
				const pos2 = posMapData.posMap.get(
					posKey(nextVhId, nextScaffoldStrandIdx, nextSeg.fivePrime.index)
				);
				if (pos1 !== undefined && pos2 !== undefined) {
					chords.push({ pos1, pos2 });
				}
			}
		}
	}

	return { arcs, chords };
}
