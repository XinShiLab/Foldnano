import { toast } from 'svelte-sonner';
import { moveOligoEndCmd, segmentHasContentUnsafeForResize } from '$lib/commands/strands';
import type { TemporalPartInfo } from '$lib/components/Editor/context/types';
import type { MoveEndBoxProps } from '$lib/components/Editor/StrandView/temporalLayer/MoveEndBox.svelte';
import { keepsSegmentDirection, type SegmentEnd } from '$lib/model/Oligo';
import type OligoSegment from '$lib/model/Oligo/OligoSegment.svelte';
import type { ViewContext } from '$lib/canvasEditor/core/views';
import { addTempParts, removeTempPartsByType } from './drawTempPartsOps';

export interface MoveEndState {
	isMoving: boolean;
	endsToBeMoved: { end: SegmentEnd; toIdx: number }[];
	fromRefIdx: number;
	toRefIdx: number;
	tempById: Map<string, TemporalPartInfo>;
}

// helper functions

function getMoveEndBoxId(segmentId: string, isThreePrime: boolean): string {
	return `MoveEndBox-${segmentId}-${isThreePrime ? '3' : '5'}`;
}

// remove MoveEndBox safely without reassigning the array
export function removeMoveEndBox(ctx: ViewContext) {
	removeTempPartsByType(ctx, 'MoveEndBox');
}
// helper functions end

export function resetMoveState(ctx: ViewContext, movingEnds: MoveEndState) {
	movingEnds.isMoving = false;
	movingEnds.endsToBeMoved = [];
	movingEnds.fromRefIdx = -1;
	movingEnds.toRefIdx = -1;
	movingEnds.tempById.clear();
	removeMoveEndBox(ctx);
}

export function startMovingEnds(
	ctx: ViewContext,
	fromRefIdx: number,
	endsToMove: SegmentEnd[],
	movingEnds: MoveEndState
) {
	movingEnds.isMoving = true;
	movingEnds.endsToBeMoved = endsToMove.map((end) => ({ end, toIdx: end.index }));
	movingEnds.fromRefIdx = fromRefIdx;
	movingEnds.toRefIdx = fromRefIdx;

	const newTsToPlot: TemporalPartInfo[] = movingEnds.endsToBeMoved.flatMap(({ end }) => {
		const rowIdx = ctx.drawingDimensions.getDisplayRowForVh(end.segment.inVirtualHelix.id);
		if (rowIdx === null) return [];
		return [
			{
				type: 'MoveEndBox',
				props: {
					id: getMoveEndBoxId(end.segment.id, end.isThreePrime),
					rowIdx,
					fromBpIdx: end.index,
					toBpIdx: end.index,
					strandIdx: end.segment.inStrandIndex as 0 | 1,
					isThreePrime: end.isThreePrime,
				} satisfies MoveEndBoxProps,
			},
		];
	});
	addTempParts(ctx, newTsToPlot);
	// Build map from the proxied entries in tempParts (not newTsToPlot) so reactive mutations work
	movingEnds.tempById = new Map(
		ctx.strandCtx.tempParts
			.filter((t): t is { type: 'MoveEndBox'; props: MoveEndBoxProps } => t.type === 'MoveEndBox')
			.map((t) => [t.props.id, t])
	);
}

/**
 * Returns segments where BOTH 5' and 3' ends are in the selection set.
 * A uniform delta preserves relative ordering between any two fully-moving segments
 * (p_A + D < p_B + D whenever p_A < p_B), so they cannot create new overlaps between
 * themselves. They are safe to exclude from the occupancy check.
 */
function getFullyMovingSegments(ends: SegmentEnd[], endSet: Set<SegmentEnd>): Set<OligoSegment> {
	const result = new Set<OligoSegment>();
	for (const end of ends) {
		const seg = end.segment;
		if (endSet.has(seg.fivePrime) && endSet.has(seg.threePrime)) {
			result.add(seg);
		}
	}
	return result;
}

/**
 * Returns true if all selected ends can move by `delta` simultaneously.
 *
 * Checks per end:
 *   1. Bounds
 *   2. Directionality (only when segment is partially selected — one end fixed)
 *   3. Occupancy, excluding fully-selected segments (they shift entirely, no new overlaps possible)
 *   4. For constrained ends: valid xover site at new position + partner propagation (if external)
 */
export function canBatchMoveByDelta(ends: SegmentEnd[], delta: number): boolean {
	if (delta === 0) return true;

	const endSet = new Set(ends);
	const fullyMovingSegments = getFullyMovingSegments(ends, endSet);

	for (const end of ends) {
		const candidateIdx = end.index + delta;
		const seg = end.segment;

		// 1. Bounds
		if (candidateIdx < 0 || candidateIdx >= seg.inVirtualHelix.length) return false;

		// 2. Directionality — only when exactly one end of the segment is selected (segment stretches)
		if (!fullyMovingSegments.has(seg)) {
			const fixedEnd = end.isThreePrime ? seg.fivePrime : seg.threePrime;
			if (!keepsSegmentDirection(end, candidateIdx, fixedEnd.index)) return false;
		}

		// 3. Occupancy on end's own VH
		const occupiedBy = seg.ownerStrandSet.isRangeOccupiedBy(end.index, candidateIdx);
		occupiedBy.delete(seg);
		for (const movingSeg of fullyMovingSegments) occupiedBy.delete(movingSeg);
		if (occupiedBy.size > 0) return false;

		// 4. Constrained end checks
		if (end.isConstrained) {
			const otherEnd = end.connectedEnd;
			if (otherEnd === null) return false;

			// a. Xover site check: new position must be a valid lattice crossover site to same partner VH
			if (!end.inPart.hasMatchingXoverSiteAt(end, candidateIdx)) return false;

			// b. Partner propagation check — only when partner is not also in the selection.
			//    If the partner is selected it validates itself in its own iteration.
			if (!endSet.has(otherEnd)) {
				const partnerCandidateIdx = candidateIdx; // constrained: both ends must share same bp
				const partnerSeg = otherEnd.segment;

				// i. Bounds on partner's VH
				if (partnerCandidateIdx < 0 || partnerCandidateIdx >= otherEnd.inVirtualHelix.length)
					return false;

				// ii. Directionality of partner's segment (partner end moves, its other end stays fixed)
				const partnerFixed = otherEnd.isThreePrime ? partnerSeg.fivePrime : partnerSeg.threePrime;
				if (!keepsSegmentDirection(otherEnd, partnerCandidateIdx, partnerFixed.index)) return false;

				// iii. Occupancy on partner's VH
				const partnerOccupied = partnerSeg.ownerStrandSet.isRangeOccupiedBy(
					otherEnd.index,
					partnerCandidateIdx
				);
				partnerOccupied.delete(partnerSeg);
				if (partnerOccupied.size > 0) return false;
			}
		}
	}

	// 5. Skip/insert relocation safety — a fully-translating segment must be able to carry its
	//    skip/insert markers (and mirror them onto the complementary strand) at the new positions.
	//    Every fully-moving segment shares this one scalar `delta`, so a duplex pair dragged
	//    together is recognized as co-moving (its pairing is preserved automatically, not
	//    re-validated against itself). Same for a crossover-connected pair dragged together: a
	//    constrained end whose partner segment is *also* fully-moving by this delta is eligible
	//    for the carry-along path (see Part.translateOligoSegments); one whose partner isn't
	//    co-moving falls back to the per-end resize path, which never shifts existing slot
	//    content (it only clips-outside/blank-fills-new), so any non-blank slot content would be
	//    silently stranded at its old bp — rejected here instead of letting the drag preview
	//    offer a position that would produce that result.
	const coMovingByDelta = new Map<OligoSegment, number>(
		[...fullyMovingSegments].map((seg) => [seg, delta])
	);
	for (const seg of fullyMovingSegments) {
		const isEligible = [seg.fivePrime, seg.threePrime].every((end) => {
			if (!end.isConstrained) return true;
			const partnerSegment = end.connectedEnd?.segment;
			return partnerSegment !== undefined && coMovingByDelta.get(partnerSegment) === delta;
		});
		if (!isEligible) {
			if (segmentHasContentUnsafeForResize(seg)) return false;
			continue;
		}
		if (!seg.canTranslateSlotsBy(delta, coMovingByDelta)) return false;
	}

	return true;
}

/**
 * Finds the nearest integer delta to `proposedDelta` for which all selected ends can move.
 * Searches symmetrically outward up to MAX_SNAP positions (covers two square-lattice periods).
 * Returns null if no valid delta is found within the search range.
 */
function findNearestValidDelta(ends: SegmentEnd[], proposedDelta: number): number | null {
	if (canBatchMoveByDelta(ends, proposedDelta)) return proposedDelta;

	const MAX_SNAP = 32;
	for (let offset = 1; offset <= MAX_SNAP; offset++) {
		if (canBatchMoveByDelta(ends, proposedDelta + offset)) return proposedDelta + offset;
		if (canBatchMoveByDelta(ends, proposedDelta - offset)) return proposedDelta - offset;
	}
	return null;
}

/**
 * Attempts to move all selected ends by the same delta while preserving their relative positions.
 * - Snaps to the nearest valid delta if the proposed position is blocked (e.g. constrained xover sites).
 * - If no valid delta is found within ±32, the preview is left unchanged.
 * - Updates MoveEndBox temp parts when a valid delta is found.
 */
export function updateMovingEnds(_ctx: ViewContext, toRefIdx: number, movingEnds: MoveEndState) {
	if (toRefIdx === movingEnds.toRefIdx) return;
	const proposedDelta = toRefIdx - movingEnds.fromRefIdx;
	const ends = movingEnds.endsToBeMoved.map(({ end }) => end);

	const validDelta = findNearestValidDelta(ends, proposedDelta);
	if (validDelta === null) return;

	movingEnds.toRefIdx = movingEnds.fromRefIdx + validDelta;
	movingEnds.endsToBeMoved = movingEnds.endsToBeMoved.map(({ end }) => ({
		end,
		toIdx: end.index + validDelta,
	}));

	movingEnds.endsToBeMoved.forEach(({ end, toIdx }) => {
		const t = movingEnds.tempById.get(getMoveEndBoxId(end.segment.id, end.isThreePrime));
		if (t && t.type === 'MoveEndBox') {
			t.props.toBpIdx = toIdx;
		}
	});
}

export function commitMovingEnds(ctx: ViewContext, movingEnds: MoveEndState) {
	// Capture pre-move: an end whose toIdx never changed didn't actually drag, so its
	// segment can't have introduced a *new* mismatch via this gesture.
	const movedEnds = movingEnds.endsToBeMoved
		.filter(({ end, toIdx }) => toIdx !== end.index)
		.map(({ end }) => end);

	try {
		moveOligoEndCmd(
			movingEnds.endsToBeMoved.map(({ end, toIdx }) => ({
				part: ctx.part,
				end,
				toIdx,
			})),
			ctx.history
		);
	} finally {
		// Always clear drag state, even when the move throws (e.g. a blocked crossover-connected
		// translate) — otherwise isMoving/endsToBeMoved/temp boxes stay stuck from the rejected
		// drag and corrupt the next interaction.
		resetMoveState(ctx, movingEnds);
	}

	if (movedEnds.length > 0) {
		const translatedSegments = getFullyMovingSegments(movedEnds, new Set(movedEnds));
		const mismatchCount = [...translatedSegments].reduce(
			(sum, seg) => sum + seg.mismatchedBps().length,
			0
		);
		if (mismatchCount > 0) {
			toast.warning(
				`This move kept the original sequence, which no longer matches its complementary strand at ${mismatchCount} position${mismatchCount === 1 ? '' : 's'}. Turn on Warnings → sequence mismatch to see where.`
			);
		}
	}
}
