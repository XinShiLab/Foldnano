import type { Part } from '../Part';
import type Oligo from '../Oligo';
import type OligoSegment from '../Oligo/OligoSegment.svelte';

// Sticky ends are found by sequence alone: every single-stranded stretch of every oligo is
// compared with every other, and an exact complementary run of at least `minLength` bases is a
// match. Nothing is stored; see docs/sticky-ends.md.

/** Matches shorter than this are too common by chance to be worth showing. */
export const MIN_STICKY_LENGTH = 5;
export const DEFAULT_STICKY_LENGTH = 7;

/** Which 3D lines join a match's sides when its Parts are placed several times: every pair of
 * instances that could bind, or one line from each instance to its nearest partner. */
export type StickyLinkMode = 'all' | 'nearest';

/** One base of a single-stranded run, where the views draw it. */
export interface StickyBase {
	vhId: string;
	strandIdx: 0 | 1;
	bpIndex: number;
	/** Which base of an insertion (0 for an ordinary bp), counted 5'→3' along the strand. */
	loopIndex: number;
}

/** A maximal stretch of one oligo, 5'→3', whose bases have no partner across the helix. */
export interface SingleStrandedRun {
	partId: string;
	oligoId: string;
	/** Index of the run's first base along the oligo, from its 5' end. */
	start: number;
	/** Upper-case bases; anything but A, C, G, T (unassigned) never matches. */
	bases: string;
	positions: StickyBase[];
}

/** One side of a match: `length` bases of a run, from `offset`. */
export interface StickySide {
	run: SingleStrandedRun;
	offset: number;
	length: number;
}

/**
 * Two stretches that can bind: `a`'s bases read 5'→3' are the complement of `b`'s read 3'→5'.
 * `self` when both sides are the same bases (a self-complementary stretch binds another copy of
 * itself).
 */
export interface StickyMatch {
	/** Stable while the two stretches stay where they are; used for colours and lists. */
	key: string;
	a: StickySide;
	b: StickySide;
	length: number;
	self: boolean;
}

const COMPLEMENT: Readonly<Record<string, string>> = { A: 'T', T: 'A', G: 'C', C: 'G' };

export const isBase = (base: string | undefined): boolean =>
	base === 'A' || base === 'C' || base === 'G' || base === 'T';

export const pairs = (x: string | undefined, y: string | undefined): boolean =>
	isBase(x) && COMPLEMENT[x!] === y;

/** The oligo's segments 5'→3' (a circular one from an arbitrary segment, each once). */
function segmentsInOrder(oligo: Oligo): OligoSegment[] {
	const all = [...oligo.segments].sort((a, b) => a.id.localeCompare(b.id));
	const ordered: OligoSegment[] = [];
	const seen = new Set<OligoSegment>();
	let current: OligoSegment | null = oligo.fivePrimeEndSegment ?? all[0] ?? null;
	while (current && !seen.has(current) && oligo.segments.has(current)) {
		ordered.push(current);
		seen.add(current);
		current = current.threePrime.connectedSegment;
	}
	for (const segment of all) if (!seen.has(segment)) ordered.push(segment);
	return ordered;
}

/**
 * Whether a base has a partner: the other strand of its helix has a base at the same bp and
 * insertion index. A partner with the wrong letter still pairs (that is a mismatch, not a
 * single-stranded base).
 */
function isPaired(part: Part, base: StickyBase): boolean {
	const opposite = part.getSegmentAtVh(base.vhId, (1 - base.strandIdx) as 0 | 1, base.bpIndex);
	return !!opposite && opposite.slotSeq(base.bpIndex).length > base.loopIndex;
}

/** Every base of an oligo 5'→3' (a circular one from an arbitrary segment), where it is drawn. */
export function oligoBases(oligo: Oligo): { bases: string; positions: StickyBase[] } {
	let bases = '';
	const positions: StickyBase[] = [];
	for (const segment of segmentsInOrder(oligo)) {
		const vhId = segment.inVirtualHelix.id;
		const strandIdx = segment.inStrandIndex as 0 | 1;
		for (const slot of segment.slots) {
			const count = slot.seq.length;
			for (let j = 0; j < count; j++) {
				// Strand 1 runs against the bp axis, so its insertion bases count down.
				const loopIndex = strandIdx === 0 ? j : count - 1 - j;
				bases += slot.seq[j].toUpperCase();
				positions.push({ vhId, strandIdx, bpIndex: slot.bpIndex, loopIndex });
			}
		}
	}
	return { bases, positions };
}

/** Every single-stranded run of the Part's oligos. Mirrors of repeat units are left out: their
 * base oligo stands for them. */
export function singleStrandedRuns(part: Part): SingleStrandedRun[] {
	const runs: SingleStrandedRun[] = [];
	for (const oligo of part.oligos) {
		if (oligo.isMirror) continue;
		const { bases, positions } = oligoBases(oligo);
		let current: SingleStrandedRun | null = null;
		positions.forEach((base, index) => {
			if (isPaired(part, base)) {
				current = null;
				return;
			}
			if (!current) {
				current = { partId: part.id, oligoId: oligo.id, start: index, bases: '', positions: [] };
				runs.push(current);
			}
			current.bases += bases[index];
			current.positions.push(base);
		});
	}
	return runs;
}

export function reverseComplement(bases: string): string {
	let out = '';
	for (let i = bases.length - 1; i >= 0; i--) out += COMPLEMENT[bases[i]] ?? 'N';
	return out;
}

const sideKey = (side: StickySide): string =>
	`${side.run.partId}:${side.run.oligoId}:${side.run.start + side.offset}:${side.length}`;

/**
 * Every maximal exact complementary pairing of at least `minLength` bases between the runs, each
 * once. Windows of `minLength` bases are indexed by their reverse complement; a hit is kept only
 * where it can't be extended towards `a`'s 5' end, then extended towards its 3' end, so each
 * maximal match is found from exactly one seed.
 */
export function findStickyMatches(runs: SingleStrandedRun[], minLength: number): StickyMatch[] {
	const k = Math.max(MIN_STICKY_LENGTH, Math.floor(minLength));
	const windows = new Map<string, { run: number; offset: number }[]>();
	runs.forEach((run, r) => {
		for (let i = 0; i + k <= run.bases.length; i++) {
			const window = run.bases.slice(i, i + k);
			if (![...window].every(isBase)) continue;
			const list = windows.get(window);
			if (list) list.push({ run: r, offset: i });
			else windows.set(window, [{ run: r, offset: i }]);
		}
	});

	const matches: StickyMatch[] = [];
	const seen = new Set<string>();
	runs.forEach((a, r) => {
		for (let i = 0; i + k <= a.bases.length; i++) {
			const window = a.bases.slice(i, i + k);
			if (![...window].every(isBase)) continue;
			for (const hit of windows.get(reverseComplement(window)) ?? []) {
				const b = runs[hit.run];
				// a[i + t] pairs with b[j + k - 1 - t]; seeds that extend towards a's 5' end are
				// found again from there.
				const j = hit.offset;
				if (pairs(a.bases[i - 1], b.bases[j + k])) continue;
				let length = k;
				while (pairs(a.bases[i + length], b.bases[j - 1 - (length - k)])) length++;
				const bOffset = j - (length - k);
				// Two overlapping stretches of one run would be a hairpin with no loop: not a match.
				const self = hit.run === r && bOffset === i;
				if (hit.run === r && !self && bOffset < i + length && i < bOffset + length) continue;
				const sideA: StickySide = { run: a, offset: i, length };
				const sideB: StickySide = { run: b, offset: bOffset, length };
				const [first, second] = [sideKey(sideA), sideKey(sideB)].sort();
				const key = `${first}|${second}`;
				if (seen.has(key)) continue;
				seen.add(key);
				const aFirst = sideKey(sideA) === first;
				matches.push({
					key,
					a: aFirst ? sideA : sideB,
					b: aFirst ? sideB : sideA,
					length,
					self,
				});
			}
		}
	});
	return matches;
}

/** The bases a side covers, where the views draw them. */
export function sidePositions(side: StickySide): StickyBase[] {
	return side.run.positions.slice(side.offset, side.offset + side.length);
}
