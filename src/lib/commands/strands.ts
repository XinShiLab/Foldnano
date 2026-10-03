import type { OligoSegment, SegmentEnd } from '../model/Oligo';
import type Oligo from '../model/Oligo';
import type { Part } from '../model/Part';
import type { CrossoverSite } from '../model/Part/Part.svelte';
import type { LatticedDesignRegion } from '../model/Part/DesignRegion';
import type VirtualHelix from '../model/VirtualHelix';
import type { HistoryStack } from './history.svelte';
import { endRef, oligoRef, partRef, type HistoryRecorder } from './historyChanges';
import type { ModificationDef } from '../model/modifications';
import { InvalidOperationError } from '../errors';

type SlotState = {
	segment: OligoSegment;
	bpIndex: number;
	seq: string;
};

const uniqueSegments = (segments: Iterable<OligoSegment | null | undefined>): OligoSegment[] => {
	const byId = new Map<string, OligoSegment>();
	for (const segment of segments) {
		if (segment) byId.set(segment.id, segment);
	}
	return [...byId.values()];
};

const captureSegmentSlots = (segments: Iterable<OligoSegment>): SlotState[] => {
	const states: SlotState[] = [];
	for (const segment of uniqueSegments(segments)) {
		for (const slot of segment.slots) {
			states.push({ segment, bpIndex: slot.bpIndex, seq: slot.seq });
		}
	}
	return states;
};

/** True if `segment` has any non-blank slot (skip, insert, or an assigned base) that would be
 * silently stranded at its old bp if this translate-ineligible segment falls through to the
 * per-end resize path — resize only clips content outside the new range and blank-fills newly
 * covered positions, it never shifts existing content, regardless of whether the old bp still
 * happens to land inside the new range. */
export const segmentHasContentUnsafeForResize = (segment: OligoSegment): boolean =>
	segment.slots.some((s) => s.seq !== 'N');

const captureSegmentAndComplementSlots = (segments: Iterable<OligoSegment>): SlotState[] => {
	const allSegments: OligoSegment[] = [];
	for (const segment of uniqueSegments(segments)) {
		allSegments.push(segment);
		const complementaryStrandIdx = (1 - segment.inStrandIndex) as 0 | 1;
		for (const slot of segment.slots) {
			const { segment: compSeg } = segment.inPart.getEntitiesAt(
				segment.inVirtualHelix.listRow,
				complementaryStrandIdx,
				slot.bpIndex
			);
			if (compSeg) allSegments.push(compSeg);
		}
	}
	return captureSegmentSlots(allSegments);
};

/** Segments on the other strand opposite `segment`'s bps: resizing a segment past a skip/insert
 * also clears its mirror there, so the undo scope must include them. */
const complementarySegments = (segment: OligoSegment): OligoSegment[] => {
	const otherStrand = (1 - segment.inStrandIndex) as 0 | 1;
	const found = new Set<OligoSegment>();
	for (const slot of segment.slots) {
		const { segment: comp } = segment.inPart.getEntitiesAtVh(
			segment.inVirtualHelix.id,
			otherStrand,
			slot.bpIndex
		);
		if (comp) found.add(comp);
	}
	return [...found];
};

const recordSlotDiffs = (rec: HistoryRecorder, before: SlotState[], after: SlotState[]): void => {
	const afterByKey = new Map(after.map((state) => [`${state.segment.id}:${state.bpIndex}`, state]));
	for (const beforeState of before) {
		const afterState = afterByKey.get(`${beforeState.segment.id}:${beforeState.bpIndex}`);
		if (!afterState) continue;
		rec.slot(beforeState.segment, beforeState.bpIndex, beforeState.seq, afterState.seq);
	}
};

const captureOligoFieldState = (oligos: Iterable<Oligo | null | undefined>) => {
	return uniqueOligos(oligos).map((oligo) => ({
		oligo,
		color: oligo.color,
		isScaffold: oligo.isScaffold,
		isSequenceLocked: oligo.isSequenceLocked,
		name: oligo.name,
	}));
};

const uniqueOligos = (oligos: Iterable<Oligo | null | undefined>): Oligo[] => {
	const byId = new Map<string, Oligo>();
	for (const oligo of oligos) {
		if (oligo) byId.set(oligo.id, oligo);
	}
	return [...byId.values()];
};

const recordOligoFieldDiffs = (
	rec: HistoryRecorder,
	before: ReturnType<typeof captureOligoFieldState>
): void => {
	for (const state of before) {
		rec.field(oligoRef(state.oligo), 'color', state.color, state.oligo.color);
		rec.field(oligoRef(state.oligo), 'isScaffold', state.isScaffold, state.oligo.isScaffold);
		rec.field(
			oligoRef(state.oligo),
			'isSequenceLocked',
			state.isSequenceLocked,
			state.oligo.isSequenceLocked
		);
		rec.field(oligoRef(state.oligo), 'name', state.name, state.oligo.name);
	}
};

export const drawStrandCmd = (
	para: {
		part: Part;
		vhIdx: number;
		startIdx: number;
		endIdx: number;
		color: string;
	},
	history: HistoryStack
): void => {
	history.tx('Draw strand', (rec) => {
		const { part, vhIdx, startIdx, endIdx, color } = para;
		const vh = part.getVhByIndex(vhIdx) as VirtualHelix;
		const scope = rec.capturePartScope(part, { vhIndices: [vhIdx] });
		part.createOligo(vh, startIdx, endIdx, color);
		scope.commit();
	});
};

export type CreateCrossoverResult = {
	/** Names of modifications cleared because their free end got connected by this crossover. */
	droppedModifications: string[];
};

/** Clears `.modification` on an end that a crossover just connected, if it had one —
 * connecting a modified free end otherwise leaves the modification orphaned (never
 * rendered again, but not deleted, so it can silently reappear if the crossover is
 * later removed). Only an oligo's overall 5'/3' termini can ever carry a modification,
 * so checking those two captured (pre-call) end references covers every case,
 * including the split-at-a-different-position branch (the captured end simply stays
 * free and untouched, and `!end.isFree` guards against clearing it). */
const dropModificationIfNowConnected = (
	rec: HistoryRecorder,
	end: SegmentEnd | null | undefined,
	modificationBefore: string | null
): string | null => {
	if (!end || modificationBefore === null || end.isFree) return null;
	rec.field(endRef(end), 'modification', modificationBefore, null);
	end.modification = null;
	return modificationBefore;
};

export const createCrossoverCmd = (
	para: {
		part: Part;
		fromOligo: Oligo;
		toOligo: Oligo;
		toSegment: OligoSegment;
		atIndexTarget: number;
	},
	history: HistoryStack
): CreateCrossoverResult => {
	return history.tx('Create crossover', (rec) => {
		const { part, fromOligo, toOligo, toSegment, atIndexTarget } = para;
		const fromEnd = fromOligo.threePrime;
		const toEnd = toOligo.fivePrime;
		const fromModBefore = fromEnd?.modification ?? null;
		const toModBefore = toEnd?.modification ?? null;
		const scope = rec.capturePartScope(part, {
			oligoIds: [fromOligo.id, toOligo.id],
			segmentIds: [toSegment.id],
			vhIndices: [
				...(fromOligo.threePrimeEndSegment
					? [fromOligo.threePrimeEndSegment.inVirtualHelix.index]
					: []),
				toSegment.inVirtualHelix.index,
			],
		});
		part.createCrossover(fromOligo, toOligo, toSegment, atIndexTarget);
		const droppedModifications = [
			dropModificationIfNowConnected(rec, fromEnd, fromModBefore),
			dropModificationIfNowConnected(rec, toEnd, toModBefore),
		].filter((name): name is string => name !== null);
		scope.commit();
		return { droppedModifications };
	});
};

type BreakOligoParams = {
	part: Part;
	oligo: Oligo;
	segment: OligoSegment;
	atIndex: number;
};

export const breakOligoCmd = (
	para: BreakOligoParams | BreakOligoParams[],
	history: HistoryStack
): void => {
	history.tx('Break oligo', (rec) => {
		const params = Array.isArray(para) ? para : [para];
		const scopes = params.map(({ part, oligo, segment }) =>
			rec.capturePartScope(part, {
				oligoIds: [oligo.id],
				segmentIds: [segment.id],
				vhIndices: [segment.inVirtualHelix.index],
			})
		);
		for (const { part, oligo, segment, atIndex } of params) {
			part.breakOligoAt(oligo, segment, atIndex);
		}
		for (const scope of scopes) scope.commit();
	});
};

export type AddSkipOrInsertionParams = {
	segment: OligoSegment;
	atIndex: number;
	count: number; // positive for insertion, negative for skip
};

export const addSkipOrInsertionCmd = (
	para: AddSkipOrInsertionParams | AddSkipOrInsertionParams[],
	history: HistoryStack
): void => {
	history.tx('Add skip or insertion', (rec) => {
		const params = Array.isArray(para) ? para : [para];
		const segments = uniqueSegments(params.map(({ segment }) => segment));
		const beforeSlots = captureSegmentAndComplementSlots(segments);
		const beforeOligos = captureOligoFieldState(segments.map((s) => s.oligo));
		for (const { segment, atIndex, count } of params) {
			segment.addSkipOrInsertion(atIndex, count);
		}
		recordSlotDiffs(rec, beforeSlots, captureSegmentAndComplementSlots(segments));
		recordOligoFieldDiffs(rec, beforeOligos);
	});
};

export type RemoveSkipOrInsertionParams = {
	segment: OligoSegment;
	atIndex: number;
};

export const removeSkipOrInsertionCmd = (
	para: RemoveSkipOrInsertionParams | RemoveSkipOrInsertionParams[],
	history: HistoryStack
): void => {
	history.tx('Remove skip or insertion', (rec) => {
		const params = Array.isArray(para) ? para : [para];
		const segments = uniqueSegments(params.map(({ segment }) => segment));
		const beforeSlots = captureSegmentAndComplementSlots(segments);
		const beforeOligos = captureOligoFieldState(segments.map((segment) => segment.oligo));
		for (const { segment, atIndex } of params) {
			segment.removeSkipOrInsertion(atIndex);
		}
		recordSlotDiffs(rec, beforeSlots, captureSegmentAndComplementSlots(segments));
		recordOligoFieldDiffs(rec, beforeOligos);
	});
};

export const removeAllSkipsInRegionCmd = (
	para: { part: Part; regionId: string },
	history: HistoryStack
): void => {
	const { part, regionId } = para;
	const params: RemoveSkipOrInsertionParams[] = [];
	for (const vh of part.virtualHelices.filter((vh) => vh.regionId === regionId)) {
		for (const strandSet of vh.strandSets) {
			for (const segId of strandSet.segmentIds) {
				const segment = part.getSegmentById(segId);
				if (!segment) continue;
				for (const slot of segment.slots) {
					if (slot.seq.length === 0) params.push({ segment, atIndex: slot.bpIndex });
				}
			}
		}
	}
	if (params.length === 0) return;
	removeSkipOrInsertionCmd(params, history);
};

export const removeAllInsertsInRegionCmd = (
	para: { part: Part; regionId: string },
	history: HistoryStack
): void => {
	const { part, regionId } = para;
	const params: RemoveSkipOrInsertionParams[] = [];
	for (const vh of part.virtualHelices.filter((vh) => vh.regionId === regionId)) {
		for (const strandSet of vh.strandSets) {
			for (const segId of strandSet.segmentIds) {
				const segment = part.getSegmentById(segId);
				if (!segment) continue;
				for (const slot of segment.slots) {
					if (slot.seq.length > 1) params.push({ segment, atIndex: slot.bpIndex });
				}
			}
		}
	}
	if (params.length === 0) return;
	removeSkipOrInsertionCmd(params, history);
};

type MoveOligoEndParams = {
	part: Part;
	end: SegmentEnd;
	toIdx: number;
};

type TranslateCandidate = {
	part: Part;
	segment: OligoSegment;
	delta: number;
};

/**
 * Moves oligo termini with direction-aware ordering to avoid intra-batch blocking.
 * - Rightward moves (toIdx > end.index): execute rightmost ends first.
 * - Leftward moves (toIdx < end.index): execute leftmost ends first.
 * - Mixed batches are grouped by direction: right movers, then stationary, then left movers.
 * This reduces collisions when neighboring ends move in the same direction.
 *
 * When both ends of a segment move by the same delta (a body-drag slide, not a resize), the
 * segment is translated as a whole via `Part.translateOligoSegments` instead: its slot content
 * (sequence + skip/insert markers) shifts to the new positions rather than being cleared and
 * reinitialized. All translating segments in one call are batched into a single
 * `translateOligoSegments` call per part so duplex pairs dragged together keep their skip/insert
 * pairing (see that method for why this can't be a per-segment loop).
 */
export const moveOligoEndCmd = (
	para: MoveOligoEndParams | MoveOligoEndParams[],
	history: HistoryStack
): void => {
	history.tx('Move oligo end', (rec) => {
		const list = Array.isArray(para) ? para.slice() : [para];

		// Detect translate candidates: segments whose both ends are moving by the same delta.
		const bySegment = new Map<OligoSegment, MoveOligoEndParams[]>();
		for (const p of list) {
			const arr = bySegment.get(p.end.segment) ?? [];
			arr.push(p);
			bySegment.set(p.end.segment, arr);
		}
		// First pass: every segment that *could* translate as a whole (both ends present, same
		// delta), regardless of constrained status yet — a constrained end's crossover partner
		// might be another entry in this same map, which is what makes it eligible below.
		const wouldTranslateByDelta = new Map<OligoSegment, number>();
		const paramsBySegment = new Map<OligoSegment, [MoveOligoEndParams, MoveOligoEndParams]>();
		for (const [segment, params] of bySegment) {
			if (params.length !== 2) continue;
			const [a, b] = params;
			const hasBothEnds =
				(a.end === segment.fivePrime && b.end === segment.threePrime) ||
				(a.end === segment.threePrime && b.end === segment.fivePrime);
			if (!hasBothEnds) continue;
			const deltaA = a.toIdx - a.end.index;
			const deltaB = b.toIdx - b.end.index;
			if (deltaA !== deltaB || deltaA === 0) continue;
			wouldTranslateByDelta.set(segment, deltaA);
			paramsBySegment.set(segment, [a, b]);
		}

		// Second pass: a segment is translate-eligible if it's unconstrained, or every constrained
		// end's crossover partner is *also* translating by the same delta — the crossover
		// invariant (both ends share one bp) is then preserved automatically since both sides
		// shift in lockstep. A constrained end whose partner isn't co-translating can't safely
		// carry its slots this way; it falls through to the per-end resize path below, which
		// clips or strands content instead of shifting it, so block up front rather than
		// silently corrupting it.
		const translateCandidates: TranslateCandidate[] = [];
		const translatedEnds = new Set<SegmentEnd>();
		for (const [segment, delta] of wouldTranslateByDelta) {
			const isEligible = [segment.fivePrime, segment.threePrime].every((end) => {
				if (!end.isConstrained) return true;
				const partnerSegment = end.connectedEnd?.segment;
				return partnerSegment !== undefined && wouldTranslateByDelta.get(partnerSegment) === delta;
			});
			if (!isEligible) {
				if (segmentHasContentUnsafeForResize(segment)) {
					throw new InvalidOperationError(
						"Cannot move: this strand has sequence, skip, or insertion content and is connected by a crossover whose other side isn't moving with it, so that content can't be carried along — the move would leave it in the wrong position or drop it."
					);
				}
				continue;
			}
			const [a, b] = paramsBySegment.get(segment)!;
			translateCandidates.push({ part: a.part, segment, delta });
			translatedEnds.add(a.end);
			translatedEnds.add(b.end);
		}
		const resizeList = list.filter((p) => !translatedEnds.has(p.end));

		// Group by part so each part gets exactly one scope (single before/after snapshot).
		// A per-end scope would call capturePartMemento N times — each iterating all oligos and
		// regions — and produce N separate applyPartMemento calls on undo, causing a freeze.
		const parts = new Set([
			...resizeList.map((p) => p.part),
			...translateCandidates.map((c) => c.part),
		]);
		const scopeByPart = new Map(
			[...parts].map((part) => {
				const endsForPart = resizeList.filter((p) => p.part === part);
				const translatesForPart = translateCandidates.filter((c) => c.part === part);

				const oligoIds = [
					...new Set([
						...endsForPart
							.map(({ end }) => end.segment.oligo?.id)
							.filter((id): id is string => Boolean(id)),
						...translatesForPart
							.map(({ segment }) => segment.oligo?.id)
							.filter((id): id is string => Boolean(id)),
					]),
				];
				const segmentIds = [
					...new Set([
						...endsForPart.flatMap(({ end }) => [
							end.segment.id,
							...(end.connectedSegment ? [end.connectedSegment.id] : []),
							...complementarySegments(end.segment).map((s) => s.id),
						]),
						...translatesForPart.flatMap(({ segment, delta }) => [
							segment.id,
							...segment.affectedComplementarySegmentsForTranslate(delta).map((s) => s.id),
						]),
					]),
				];
				const vhIndices = [
					...new Set([
						...endsForPart.flatMap(({ end }) => [
							end.segment.inVirtualHelix.index,
							...(end.connectedSegment ? [end.connectedSegment.inVirtualHelix.index] : []),
						]),
						...translatesForPart.map(({ segment }) => segment.inVirtualHelix.index),
					]),
				];
				return [part, rec.capturePartScope(part, { oligoIds, segmentIds, vhIndices })];
			})
		);

		resizeList.sort((a, b) => {
			const da = a.toIdx - a.end.index;
			const db = b.toIdx - b.end.index;
			const sa = Math.sign(da);
			const sb = Math.sign(db);

			// Same direction: order by current index based on direction
			if (sa === sb) {
				if (sa > 0) return b.end.index - a.end.index; // right: rightmost first
				if (sa < 0) return a.end.index - b.end.index; // left: leftmost first
				return 0; // stationary: keep order
			}
			// Group by direction: right (1) -> stationary (0) -> left (-1)
			return sb - sa;
		});

		for (const { part, end, toIdx } of resizeList) {
			part.moveOligoTerminusTo(end, toIdx);
		}
		// One batch call per part — translating candidates together (not one at a time) lets
		// Part resolve each segment's complementary partner before any of them have moved, so a
		// duplex pair dragged together keeps its skip/insert pairing instead of corrupting it.
		for (const part of parts) {
			const movesForPart = translateCandidates.filter((c) => c.part === part);
			if (movesForPart.length > 0) part.translateOligoSegments(movesForPart);
		}
		for (const scope of scopeByPart.values()) scope.commit();
	});
};

/** Copies whole oligos `delta` bp along their own VHs as independent oligos. A snapshot tx:
 * the copy may grow a region, which touches every VH in it. */
export const duplicateOligosCmd = (
	{ part, oligos, delta }: { part: Part; oligos: Oligo[]; delta: number },
	history: HistoryStack
): Oligo[] =>
	history.snapshotTx(`Duplicate ${oligos.length} oligo${oligos.length === 1 ? '' : 's'}`, () =>
		part.duplicateOligos(oligos, delta)
	);

type RemoveOligoParams = {
	part: Part;
	oligo: Oligo;
};

export const removeOligoCmd = (
	para: RemoveOligoParams | RemoveOligoParams[],
	history: HistoryStack
): void => {
	history.tx('Remove oligo', (rec) => {
		const params = Array.isArray(para) ? para : [para];
		const scopes = params.map(({ part, oligo }) =>
			rec.capturePartScope(part, {
				oligoIds: [oligo.id],
				vhIndices: Array.from(oligo.segments).map((segment) => segment.inVirtualHelix.index),
			})
		);
		for (const { part, oligo } of params) {
			part.removeOligo(oligo);
		}
		for (const scope of scopes) scope.commit();
	});
};

type RemoveSegmentFromOligoParams = {
	part: Part;
	oligo: Oligo;
	segment: OligoSegment;
};

export const removeSegmentFromOligoCmd = (
	para: RemoveSegmentFromOligoParams | RemoveSegmentFromOligoParams[],
	history: HistoryStack
): void => {
	history.tx('Remove segment from oligo', (rec) => {
		const params = Array.isArray(para) ? para : [para];
		const scopes = params.map(({ part, oligo, segment }) =>
			rec.capturePartScope(part, {
				oligoIds: [oligo.id],
				segmentIds: [segment.id],
				vhIndices: [segment.inVirtualHelix.index],
			})
		);
		for (const { part, oligo, segment } of params) {
			part.removeSegmentFromOligo(oligo, segment);
		}
		for (const scope of scopes) scope.commit();
	});
};

const isStartOfCrossover = (xoverInfo: CrossoverSite, strandSet: 0 | 1): boolean => {
	return (strandSet === 0) !== xoverInfo.right;
};

export const makeCrossoverCmd = (
	para: {
		part: Part;
		fromVhIdx: number;
		strandIdx: 0 | 1;
		bpIdx: number;
		toVhIdx: number;
		right: boolean;
	},
	history: HistoryStack
): CreateCrossoverResult => {
	return history.tx('Make crossover', (rec) => {
		const { part, fromVhIdx, strandIdx, bpIdx, toVhIdx, right } = para;

		const xoverInfo: CrossoverSite = { bpIdx, toVhIdx, right };

		const startInfo = isStartOfCrossover(xoverInfo, strandIdx)
			? { vhIdx: fromVhIdx, strandIdx, bpIdx }
			: { vhIdx: toVhIdx, strandIdx: (1 - strandIdx) as 0 | 1, bpIdx };

		const endInfo = isStartOfCrossover(xoverInfo, strandIdx)
			? { vhIdx: toVhIdx, strandIdx: (1 - strandIdx) as 0 | 1, bpIdx }
			: { vhIdx: fromVhIdx, strandIdx, bpIdx };

		const endVh = part.getVhByIndex(endInfo.vhIdx);
		const startVh = part.getVhByIndex(startInfo.vhIdx);
		const endSegment = endVh
			? part.getOligoByVh(endVh.id, endInfo.strandIdx, endInfo.bpIdx)?.segment
			: null;

		if (!endSegment) {
			throw new Error('End oligo segment not found');
		}

		if (
			endInfo.bpIdx === endSegment.threePrime.index ||
			endInfo.bpIdx === endSegment.threePrime.minus1Index
		) {
			throw new Error("Cannot create crossover at or 1nt away from 3' end");
		}

		const startOligo = startVh
			? part.getOligoByVh(startVh.id, startInfo.strandIdx, startInfo.bpIdx)
			: null;
		if (!startOligo) return { droppedModifications: [] };
		const endOligoBefore = part.getOligoBySegment(endSegment);
		const scope = rec.capturePartScope(part, {
			oligoIds: [startOligo.oligo.id, ...(endOligoBefore ? [endOligoBefore.id] : [])],
			segmentIds: [startOligo.segment.id, endSegment.id],
			vhIndices: [fromVhIdx, toVhIdx],
		});

		// If bpIdx is already the start segment's free 3' end, breaking there discards that
		// end's object (and any modification on it) unconditionally, regardless of whether a
		// crossover ends up connecting it — capture it before the break so it can be reported.
		// (Already undo-safe: capturePartScope above snapshots this segment's pre-break state.)
		const fromModBefore =
			startOligo.segment.threePrime.index === bpIdx
				? startOligo.segment.threePrime.modification
				: null;

		part.breakOligoAt(startOligo.oligo, startOligo.segment, bpIdx);

		const droppedModifications: string[] = fromModBefore !== null ? [fromModBefore] : [];

		const endOligo = endVh ? part.getOligoByVh(endVh.id, endInfo.strandIdx, endInfo.bpIdx) : null;
		if (!endOligo) {
			scope.commit();
			return { droppedModifications };
		}

		const toEnd = endOligo.oligo.fivePrime;
		const toModBefore = toEnd?.modification ?? null;
		part.createCrossover(startOligo.oligo, endOligo.oligo, endOligo.segment, bpIdx);
		const toDropped = dropModificationIfNowConnected(rec, toEnd, toModBefore);
		if (toDropped !== null) droppedModifications.push(toDropped);

		scope.commit();
		return { droppedModifications };
	});
};

type FillEmptyVhParams = {
	part: Part;
	vhIdx: number;
	strandIdx: 0 | 1;
};

export const fillEmptyVhCmd = (
	para: FillEmptyVhParams | FillEmptyVhParams[],
	history: HistoryStack
): void => {
	history.tx('Fill empty virtual helix', (rec) => {
		const params = Array.isArray(para) ? para : [para];
		const scopes = params.map(({ part, vhIdx }) =>
			rec.capturePartScope(part, { vhIndices: [vhIdx] })
		);
		for (const { part, vhIdx, strandIdx } of params) {
			const vh = part.getVhByIndex(vhIdx);
			if (!vh) continue;
			part.fillEmptyStrandSet(vh, strandIdx);
		}
		for (const scope of scopes) scope.commit();
	});
};

export const autoStapleCmd = (
	para: {
		part: Part;
		region: LatticedDesignRegion;
	},
	history: HistoryStack
) => {
	history.snapshotTx(`Auto staple — ${para.region.name}`, () => {
		para.part.autoStapleRegion(para.region.id);
	});
};

export type PaintOligoParams = {
	oligo: Oligo;
	color: string;
};
export const paintOligoCmd = (
	para: PaintOligoParams | PaintOligoParams[],
	history: HistoryStack
): void => {
	history.tx('Paint oligo', (rec) => {
		const params = Array.isArray(para) ? para : [para];
		for (const { oligo, color } of params) {
			rec.field(oligoRef(oligo), 'color', oligo.color, color);
			oligo.color = color;
		}
	});
};

export type SetModificationParams = {
	end: SegmentEnd;
	modification: string | null;
};
export const setModificationCmd = (
	para: SetModificationParams | SetModificationParams[],
	history: HistoryStack
): void => {
	history.tx('Set end modification', (rec) => {
		const params = Array.isArray(para) ? para : [para];
		for (const { end, modification } of params) {
			rec.field(endRef(end), 'modification', end.modification, modification);
			end.modification = modification;
		}
	});
};

export const setCustomModificationsCmd = (
	part: Part,
	modifications: ModificationDef[],
	history: HistoryStack
): void => {
	history.tx('Update custom modifications', (rec) => {
		rec.field(partRef(part), 'customModifications', part.customModifications, modifications);
		part.customModifications = modifications;
	});
};

/** Deletes a custom modification definition and clears it from every end that
 * currently carries it, in one undoable step — otherwise those ends would be
 * silently orphaned (still holding the name, but with no definition to render). */
export const removeCustomModificationCmd = (
	part: Part,
	modificationName: string,
	history: HistoryStack
): void => {
	history.tx('Remove custom modification', (rec) => {
		for (const end of part.getEndsWithModification(modificationName)) {
			rec.field(endRef(end), 'modification', end.modification, null);
			end.modification = null;
		}
		const remaining = part.customModifications.filter((m) => m.name !== modificationName);
		rec.field(partRef(part), 'customModifications', part.customModifications, remaining);
		part.customModifications = remaining;
	});
};

export type FillRandomSequenceToOligoParams = {
	oligo: Oligo;
	gcContent?: number; // optional GC content percentage (0-1), default to 0.5
	onlyEmpty?: boolean;
};
export const fillRandomSequenceToOligoCmd = (
	para: FillRandomSequenceToOligoParams | FillRandomSequenceToOligoParams[],
	history: HistoryStack
): void => {
	history.tx('Fill random sequence to oligo', (rec) => {
		const params = Array.isArray(para) ? para : [para];
		const oligos = uniqueOligos(params.map(({ oligo }) => oligo));
		const segments = uniqueSegments(oligos.flatMap((oligo) => Array.from(oligo.segments)));
		const beforeSlots = captureSegmentAndComplementSlots(segments);
		const beforeOligos = captureOligoFieldState(oligos);
		for (const { oligo, gcContent, onlyEmpty } of params) {
			oligo.fillRandomSequence(gcContent, onlyEmpty);
		}
		recordSlotDiffs(rec, beforeSlots, captureSegmentAndComplementSlots(segments));
		recordOligoFieldDiffs(rec, beforeOligos);
	});
};

export type FillRandomSequenceToSegmentParams = {
	segment: OligoSegment;
	gcContent?: number; // optional GC content percentage (0-1), default to 0.5
	onlyEmpty?: boolean;
};

export const fillRandomSequenceToSegmentCmd = (
	para: FillRandomSequenceToSegmentParams | FillRandomSequenceToSegmentParams[],
	history: HistoryStack
): void => {
	history.tx('Fill random sequence to segment', (rec) => {
		const params = Array.isArray(para) ? para : [para];
		const segments = uniqueSegments(params.map(({ segment }) => segment));
		const beforeSlots = captureSegmentAndComplementSlots(segments);
		const beforeOligos = captureOligoFieldState(segments.map((segment) => segment.oligo));
		for (const { segment, gcContent, onlyEmpty } of params) {
			segment.fillRandomSequence(gcContent, onlyEmpty);
		}
		recordSlotDiffs(rec, beforeSlots, captureSegmentAndComplementSlots(segments));
		recordOligoFieldDiffs(rec, beforeOligos);
	});
};

export type FillSequenceToOligoParams = {
	oligo: Oligo;
	sequence: string;
	lockSequence?: boolean; // whether to lock the filled sequence, default to false
	onlyEmpty?: boolean;
};

export type FillSequenceToSegmentParams = {
	segment: OligoSegment;
	sequence: string;
	/** this lockSequence flag only works if the segment is the only segment in an Oligo */
	lockSequence?: boolean; // whether to lock the filled sequence, default to false
	onlyEmpty?: boolean;
};

type FillInfo = {
	leftover: string;
	missing: number;
};

export const fillSequenceToOligoCmd = (
	para: FillSequenceToOligoParams | FillSequenceToOligoParams[],
	history: HistoryStack
): FillInfo[] => {
	const fillInfo: FillInfo[] = [];
	history.tx('Fill sequence to oligo', (rec) => {
		const params = Array.isArray(para) ? para : [para];
		const oligos = uniqueOligos(params.map(({ oligo }) => oligo));
		const segments = uniqueSegments(oligos.flatMap((oligo) => Array.from(oligo.segments)));
		const beforeSlots = captureSegmentAndComplementSlots(segments);
		const beforeOligos = captureOligoFieldState(oligos);
		for (const { oligo, sequence, lockSequence, onlyEmpty } of params) {
			const res = oligo.fillSequence(sequence, lockSequence, onlyEmpty);
			fillInfo.push(res);
		}
		recordSlotDiffs(rec, beforeSlots, captureSegmentAndComplementSlots(segments));
		recordOligoFieldDiffs(rec, beforeOligos);
	});
	return fillInfo;
};

export const fillSequenceToSegmentCmd = (
	para: FillSequenceToSegmentParams | FillSequenceToSegmentParams[],
	history: HistoryStack
): FillInfo[] => {
	const fillInfo: FillInfo[] = [];
	history.tx('Fill sequence to segment', (rec) => {
		const params = Array.isArray(para) ? para : [para];
		const segments = uniqueSegments(params.map(({ segment }) => segment));
		const beforeSlots = captureSegmentAndComplementSlots(segments);
		const beforeOligos = captureOligoFieldState(segments.map((segment) => segment.oligo));
		for (const { segment, sequence, lockSequence, onlyEmpty } of params) {
			const res = segment.fillSequence(sequence, onlyEmpty);
			fillInfo.push(res);
			// if the segment is the only segment in a Oligo, set the oligo's lockSequence as well
			const oligo = segment.oligo;
			if (oligo && oligo.segments.size === 1 && lockSequence) {
				oligo.isSequenceLocked = true;
			}
		}
		recordSlotDiffs(rec, beforeSlots, captureSegmentAndComplementSlots(segments));
		recordOligoFieldDiffs(rec, beforeOligos);
	});
	return fillInfo;
};

export type ClearOligoSequenceParams = {
	oligo: Oligo;
};

export type ClearSegmentSequenceParams = {
	segment: OligoSegment;
};

export const clearOligoSequenceCmd = (
	para: ClearOligoSequenceParams | ClearOligoSequenceParams[],
	history: HistoryStack
): void => {
	history.tx('Clear oligo sequence', (rec) => {
		const params = Array.isArray(para) ? para : [para];
		const oligos = uniqueOligos(params.map(({ oligo }) => oligo));
		const segments = uniqueSegments(oligos.flatMap((oligo) => Array.from(oligo.segments)));
		const beforeSlots = captureSegmentSlots(segments);
		const beforeOligos = captureOligoFieldState(oligos);
		for (const { oligo } of params) {
			oligo.clearOwnSequence();
		}
		recordSlotDiffs(rec, beforeSlots, captureSegmentSlots(segments));
		recordOligoFieldDiffs(rec, beforeOligos);
	});
};

export const clearSegmentSequenceCmd = (
	para: ClearSegmentSequenceParams | ClearSegmentSequenceParams[],
	history: HistoryStack
): void => {
	history.tx('Clear segment sequence', (rec) => {
		const params = Array.isArray(para) ? para : [para];
		const segments = uniqueSegments(params.map(({ segment }) => segment));
		const beforeSlots = captureSegmentSlots(segments);
		const beforeOligos = captureOligoFieldState(segments.map((segment) => segment.oligo));
		for (const { segment } of params) {
			segment.clearOwnSequence();
		}
		recordSlotDiffs(rec, beforeSlots, captureSegmentSlots(segments));
		recordOligoFieldDiffs(rec, beforeOligos);
	});
};

export type ClearPartSequenceParams = {
	part: Part;
};

export const clearPartSequenceCmd = (
	para: ClearPartSequenceParams | ClearPartSequenceParams[],
	history: HistoryStack
): void => {
	history.tx('Clear part sequence', (rec) => {
		const params = Array.isArray(para) ? para : [para];
		const segments = uniqueSegments(
			params.flatMap(({ part }) =>
				Array.from(part.oligos).flatMap((oligo) => Array.from(oligo.segments))
			)
		);
		const beforeSlots = captureSegmentSlots(segments);
		const beforeOligos = captureOligoFieldState(segments.map((segment) => segment.oligo));
		for (const { part } of params) {
			part.clearAllSequences();
		}
		recordSlotDiffs(rec, beforeSlots, captureSegmentSlots(segments));
		recordOligoFieldDiffs(rec, beforeOligos);
	});
};

export type ToggleOligoAsScaffoldParams = {
	oligo: Oligo;
};

export const toggleOligoAsScaffoldCmd = (
	para: ToggleOligoAsScaffoldParams | ToggleOligoAsScaffoldParams[],
	history: HistoryStack
): void => {
	history.tx('Toggle oligo scaffold', (rec) => {
		const params = Array.isArray(para) ? para : [para];
		for (const { oligo } of params) {
			rec.field(oligoRef(oligo), 'isScaffold', oligo.isScaffold, !oligo.isScaffold);
			oligo.isScaffold = !oligo.isScaffold;
		}
	});
};
