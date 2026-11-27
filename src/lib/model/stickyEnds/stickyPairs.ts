import type { Part } from '../Part';
import {
	isBase,
	MIN_STICKY_LENGTH,
	oligoBases,
	pairs,
	type StickyBase,
	type StickyMatch,
	type StickySide,
} from './stickyEnds';

// A saved pair (or ignored match) records which two stretches the user meant, so the editor can
// tell when an edit breaks it. See docs/sticky-ends.md § Saved pairs.

/**
 * One side of a saved record: `length` bases of an oligo, `offset` bases in from its 5' or 3' end
 * (whichever was nearer when saved, so growing the oligo at its other end doesn't move it).
 * `partId` only in the assembly, whose records join two Parts; a Part's own records leave it out.
 */
export interface StickyAnchor {
	partId?: string;
	oligoId: string;
	from: '5p' | '3p';
	offset: number;
}

/** A pair the user made, or a match they chose to ignore: two anchors and the length saved. */
export interface StickyRecord {
	id: string;
	a: StickyAnchor;
	b: StickyAnchor;
	length: number;
}

export type StickyList = 'pairs' | 'ignored';

/** How a saved pair stands against the current sequences. */
export type StickyPairStatus =
	/** Both stretches still complementary over the saved length. */
	| 'matching'
	/** Complementary over a shorter stretch only (at least the minimum match length). */
	| 'partial'
	/** No longer complementary. */
	| 'broken'
	/** An oligo or Part is gone, or too short now. */
	| 'missing'
	/** A base on either side has no sequence yet. */
	| 'noSequence';

/** Where a side sits now. */
export interface ResolvedSide {
	part: Part;
	oligoId: string;
	/** First base, counted from the oligo's 5' end. */
	start: number;
	bases: string;
	positions: StickyBase[];
}

/** The anchor for `length` bases of `oligoId` from base `start` (5' count), or null when the
 * oligo is circular (no ends to count from) or gone. */
export function anchorAt(
	part: Part,
	oligoId: string,
	start: number,
	length: number,
	withPartId: boolean
): StickyAnchor | null {
	const oligo = part.getOligoById(oligoId);
	if (!oligo || oligo.isCircular) return null;
	const total = oligoBases(oligo).bases.length;
	const fromThree = total - (start + length);
	const anchor: StickyAnchor =
		fromThree < start
			? { oligoId, from: '3p', offset: fromThree }
			: { oligoId, from: '5p', offset: start };
	return withPartId ? { partId: part.id, ...anchor } : anchor;
}

/** The anchor of one side of a detected match. */
export function anchorOfSide(
	part: Part,
	side: StickySide,
	withPartId: boolean
): StickyAnchor | null {
	return anchorAt(part, side.run.oligoId, side.run.start + side.offset, side.length, withPartId);
}

/** Where an anchor points now, or null when its oligo is gone or no longer long enough. */
export function resolveAnchor(
	part: Part | undefined,
	anchor: StickyAnchor,
	length: number
): ResolvedSide | null {
	const oligo = part?.getOligoById(anchor.oligoId);
	if (!part || !oligo || oligo.isCircular) return null;
	const all = oligoBases(oligo);
	const start = anchor.from === '5p' ? anchor.offset : all.bases.length - anchor.offset - length;
	if (start < 0 || start + length > all.bases.length) return null;
	return {
		part,
		oligoId: oligo.id,
		start,
		bases: all.bases.slice(start, start + length),
		positions: all.positions.slice(start, start + length),
	};
}

/** Both sides of a record, resolved in the Part that holds it (`home`) or across the document. */
export function resolveRecord(
	parts: readonly Part[],
	home: Part | null,
	record: StickyRecord
): [ResolvedSide | null, ResolvedSide | null] {
	const partOf = (anchor: StickyAnchor) => home ?? parts.find((part) => part.id === anchor.partId);
	return [
		resolveAnchor(partOf(record.a), record.a, record.length),
		resolveAnchor(partOf(record.b), record.b, record.length),
	];
}

/** Longest run of `a[i]` pairing `b[n-1-i]`. */
function longestComplementaryRun(a: string, b: string): number {
	let best = 0;
	let run = 0;
	for (let i = 0; i < a.length; i++) {
		run = pairs(a[i], b[b.length - 1 - i]) ? run + 1 : 0;
		best = Math.max(best, run);
	}
	return best;
}

export function stickyPairStatus(
	sides: [ResolvedSide | null, ResolvedSide | null]
): StickyPairStatus {
	const [a, b] = sides;
	if (!a || !b) return 'missing';
	if (![...a.bases, ...b.bases].every(isBase)) return 'noSequence';
	const run = longestComplementaryRun(a.bases, b.bases);
	if (run === a.bases.length) return 'matching';
	return run >= MIN_STICKY_LENGTH ? 'partial' : 'broken';
}

const overlaps = (side: StickySide, resolved: ResolvedSide | null): boolean =>
	!!resolved &&
	resolved.part.id === side.run.partId &&
	resolved.oligoId === side.run.oligoId &&
	side.run.start + side.offset < resolved.start + resolved.positions.length &&
	resolved.start < side.run.start + side.offset + side.length;

/** Whether a detected match is the one a record saved: each side overlaps one of the record's. */
export function recordCovers(
	sides: [ResolvedSide | null, ResolvedSide | null],
	match: StickyMatch
): boolean {
	const [a, b] = sides;
	if (match.self) return overlaps(match.a, a) && overlaps(match.a, b);
	return (
		(overlaps(match.a, a) && overlaps(match.b, b)) || (overlaps(match.a, b) && overlaps(match.b, a))
	);
}

const isAnchor = (value: unknown, withPartId: boolean): value is StickyAnchor => {
	if (typeof value !== 'object' || value === null) return false;
	const { partId, oligoId, from, offset } = value as Record<string, unknown>;
	return (
		(withPartId ? typeof partId === 'string' : partId === undefined) &&
		typeof oligoId === 'string' &&
		(from === '5p' || from === '3p') &&
		Number.isInteger(offset) &&
		(offset as number) >= 0
	);
};

/** Whether `value` is a record in the shape a Part (`withPartId` false) or the assembly keeps. */
export function isStickyRecord(value: unknown, withPartId: boolean): value is StickyRecord {
	if (typeof value !== 'object' || value === null) return false;
	const { id, a, b, length } = value as Record<string, unknown>;
	return (
		typeof id === 'string' &&
		isAnchor(a, withPartId) &&
		isAnchor(b, withPartId) &&
		Number.isInteger(length) &&
		(length as number) > 0
	);
}
