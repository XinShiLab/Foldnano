import { moveOligoEndCmd } from '$lib/commands/strands';
import type { HistoryStack } from '$lib/commands/history.svelte';
import type { SegmentEnd } from '$lib/model/Oligo';
import type OligoSegment from '$lib/model/Oligo/OligoSegment.svelte';

export type EndAlignmentAction = 'left' | 'right' | 'justify';

export interface EndAlignmentMove {
	end: SegmentEnd;
	toIdx: number;
}

function leftEndOf(segment: OligoSegment): SegmentEnd {
	return segment.fivePrime.index <= segment.threePrime.index
		? segment.fivePrime
		: segment.threePrime;
}

function rightEndOf(segment: OligoSegment): SegmentEnd {
	return segment.fivePrime.index > segment.threePrime.index
		? segment.fivePrime
		: segment.threePrime;
}

function uniqueEnds(ends: Iterable<SegmentEnd>): SegmentEnd[] {
	return [...new Set(ends)];
}

function selectedFreeEnds(ends: Iterable<SegmentEnd>): SegmentEnd[] {
	return uniqueEnds(ends).filter((end) => end.isFree);
}

function selectedSegments(ends: Iterable<SegmentEnd>): OligoSegment[] {
	return [...new Set(Array.from(ends, (end) => end.segment))];
}

function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
	return Math.max(aStart, bStart) <= Math.min(aEnd, bEnd);
}

function finalInterval(segment: OligoSegment, targetByEnd: Map<SegmentEnd, number>) {
	const fivePrimeIdx = targetByEnd.get(segment.fivePrime) ?? segment.fivePrime.index;
	const threePrimeIdx = targetByEnd.get(segment.threePrime) ?? segment.threePrime.index;
	return {
		fivePrimeIdx,
		threePrimeIdx,
		start: Math.min(fivePrimeIdx, threePrimeIdx),
		end: Math.max(fivePrimeIdx, threePrimeIdx),
	};
}

function preservesStrandDirection(
	segment: OligoSegment,
	fivePrimeIdx: number,
	threePrimeIdx: number
): boolean {
	if (segment.inStrandIndex === 0) return fivePrimeIdx <= threePrimeIdx;
	return fivePrimeIdx >= threePrimeIdx;
}

export function canBatchMoveToTargets(targets: EndAlignmentMove[]): boolean {
	if (targets.length === 0) return true;

	const targetByEnd = new Map<SegmentEnd, number>();
	for (const { end, toIdx } of targets) {
		if (!end.isFree) return false;
		if (toIdx < 0 || toIdx >= end.segment.inVirtualHelix.length) return false;
		targetByEnd.set(end, toIdx);
	}

	const segments = selectedSegments(targetByEnd.keys());
	const segmentsByStrandSet = new Map<object, OligoSegment[]>();

	for (const segment of segments) {
		const interval = finalInterval(segment, targetByEnd);
		if (!preservesStrandDirection(segment, interval.fivePrimeIdx, interval.threePrimeIdx)) {
			return false;
		}

		const strandSetSegments = segmentsByStrandSet.get(segment.ownerStrandSet) ?? [];
		strandSetSegments.push(segment);
		segmentsByStrandSet.set(segment.ownerStrandSet, strandSetSegments);

		const occupiedBy = segment.ownerStrandSet.isRangeOccupiedBy(interval.start, interval.end);
		occupiedBy.delete(segment);
		for (const movingSegment of segments) occupiedBy.delete(movingSegment);
		if (occupiedBy.size > 0) return false;
	}

	for (const strandSetSegments of segmentsByStrandSet.values()) {
		for (let i = 0; i < strandSetSegments.length; i++) {
			const a = strandSetSegments[i];
			const aInterval = finalInterval(a, targetByEnd);
			for (let j = i + 1; j < strandSetSegments.length; j++) {
				const b = strandSetSegments[j];
				const bInterval = finalInterval(b, targetByEnd);
				if (overlap(aInterval.start, aInterval.end, bInterval.start, bInterval.end)) {
					return false;
				}
			}
		}
	}

	return true;
}

function dropStationaryMoves(targets: EndAlignmentMove[]): EndAlignmentMove[] {
	return targets.filter(({ end, toIdx }) => end.index !== toIdx);
}

function selectedEndsForSideAlign(ends: SegmentEnd[], side: 'left' | 'right'): SegmentEnd[] {
	const endSet = new Set(ends);
	const candidates: SegmentEnd[] = [];
	for (const segment of selectedSegments(ends)) {
		const hasFivePrime = endSet.has(segment.fivePrime);
		const hasThreePrime = endSet.has(segment.threePrime);
		if (hasFivePrime && hasThreePrime) {
			candidates.push(side === 'left' ? leftEndOf(segment) : rightEndOf(segment));
		} else if (hasFivePrime) {
			candidates.push(segment.fivePrime);
		} else if (hasThreePrime) {
			candidates.push(segment.threePrime);
		}
	}
	return candidates;
}

function planAlignLeft(ends: SegmentEnd[]): EndAlignmentMove[] | null {
	const candidates = selectedEndsForSideAlign(ends, 'left');
	if (candidates.length < 2) return null;
	const targetIdx = Math.min(...candidates.map((end) => end.index));
	const targets = candidates.map((end) => ({ end, toIdx: targetIdx }));
	if (!canBatchMoveToTargets(targets)) return null;
	const moves = dropStationaryMoves(targets);
	return moves.length > 0 ? moves : null;
}

function planAlignRight(ends: SegmentEnd[]): EndAlignmentMove[] | null {
	const candidates = selectedEndsForSideAlign(ends, 'right');
	if (candidates.length < 2) return null;
	const targetIdx = Math.max(...candidates.map((end) => end.index));
	const targets = candidates.map((end) => ({ end, toIdx: targetIdx }));
	if (!canBatchMoveToTargets(targets)) return null;
	const moves = dropStationaryMoves(targets);
	return moves.length > 0 ? moves : null;
}

function planJustify(ends: SegmentEnd[]): EndAlignmentMove[] | null {
	const segments = selectedSegments(ends);
	if (segments.length < 2) return null;

	const endSet = new Set(ends);
	const leftCandidates = segments.map((s) => leftEndOf(s)).filter((end) => endSet.has(end));
	const rightCandidates = segments.map((s) => rightEndOf(s)).filter((end) => endSet.has(end));

	if (leftCandidates.length === 0 || rightCandidates.length === 0) return null;

	const leftTargetIdx = Math.min(...leftCandidates.map((end) => end.index));
	const rightTargetIdx = Math.max(...rightCandidates.map((end) => end.index));
	const targets: EndAlignmentMove[] = [
		...leftCandidates.map((end) => ({ end, toIdx: leftTargetIdx })),
		...rightCandidates.map((end) => ({ end, toIdx: rightTargetIdx })),
	];

	if (!canBatchMoveToTargets(targets)) return null;
	const moves = dropStationaryMoves(targets);
	return moves.length > 0 ? moves : null;
}

export function planEndAlignment(
	action: EndAlignmentAction,
	selectedEndsInput: Iterable<SegmentEnd>
): EndAlignmentMove[] | null {
	const ends = selectedFreeEnds(selectedEndsInput);
	if (action === 'left') return planAlignLeft(ends);
	if (action === 'right') return planAlignRight(ends);
	return planJustify(ends);
}

export function applyEndAlignment(
	history: HistoryStack,
	action: EndAlignmentAction,
	selectedEndsInput: Iterable<SegmentEnd>
): boolean {
	const moves = planEndAlignment(action, selectedEndsInput);
	if (!moves) return false;
	moveOligoEndCmd(
		moves.map(({ end, toIdx }) => ({ part: end.segment.inVirtualHelix.inPart, end, toIdx })),
		history
	);
	return true;
}
