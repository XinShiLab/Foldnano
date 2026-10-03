import { describe, expect, it } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import type OligoSegment from '$lib/model/Oligo/OligoSegment.svelte';
import type { Part } from '$lib/model/Part';
import { addLatticeVh } from '$lib/model/test/testHelpers';
import { StorageManager } from '$lib/services/storage/StorageManager';
import type { StorageProvider } from '$lib/services/storage/StorageProvider';
import { HistoryStack } from './history.svelte';
import { addSkipOrInsertionCmd, moveOligoEndCmd } from './strands';

class MockStorageProvider implements StorageProvider {
	async saveDocument(): Promise<boolean> {
		return true;
	}
	async loadDocument(): Promise<object | null> {
		return null;
	}
	async deleteDocument(): Promise<boolean> {
		return true;
	}
	async getDocumentList(): Promise<[]> {
		return [];
	}
	async saveContext(): Promise<boolean> {
		return true;
	}
	async loadContext(): Promise<object | null> {
		return null;
	}
	getProviderInfo() {
		return { name: 'Mock', type: 'memory' as const, description: 'Mock storage provider' };
	}
	async isAvailable(): Promise<boolean> {
		return true;
	}
}

function historyFor(doc: FoldnanoDocument): HistoryStack {
	const storage = new StorageManager('memory');
	storage.registerProvider('memory', new MockStorageProvider());
	return new HistoryStack(doc, storage);
}

function segmentOf(segments: Iterable<OligoSegment>): OligoSegment {
	return [...segments][0];
}

function makeDuplex() {
	const doc = new FoldnanoDocument();
	const part = doc.addNewPart('HONEYCOMB');
	const vh = addLatticeVh(part, 0, 0);
	const seg = segmentOf(part.createOligo(vh, 0, 10).segments);
	const compSeg = segmentOf(part.createOligo(vh, 10, 0).segments);
	return { doc, part, vh, seg, compSeg };
}

function slideSegment(part: Part, seg: OligoSegment, delta: number, history: HistoryStack): void {
	moveOligoEndCmd(
		[
			{ part, end: seg.fivePrime, toIdx: seg.fivePrime.index + delta },
			{ part, end: seg.threePrime, toIdx: seg.threePrime.index + delta },
		],
		history
	);
}

function findSite(part: Part, vhIndex: number, minBp: number): number {
	const site = part.potentialXoverSites(vhIndex)[0].find((candidate) => candidate.bpIdx > minBp);
	if (!site) throw new Error('Expected a usable crossover site');
	return site.bpIdx;
}

/** Finds a delta that moves the crossover site at `fromBp` to another valid site (same
 * direction, same partner VH) further along the same strand — i.e. a delta a constrained end
 * could actually be dragged by. */
function findTranslatableXoverDelta(
	part: Part,
	vhIndex: number,
	toVhIndex: number,
	fromBp: number
): number {
	const sites = part.potentialXoverSites(vhIndex)[0];
	const current = sites.find((s) => s.bpIdx === fromBp);
	if (!current) throw new Error('fromBp is not itself a valid crossover site');
	const next = sites
		.filter((s) => s.toVhIdx === toVhIndex && s.right === current.right && s.bpIdx > fromBp)
		.sort((a, b) => a.bpIdx - b.bpIdx)[0];
	if (!next) throw new Error('Expected a further matching crossover site');
	return next.bpIdx - fromBp;
}

describe('moveOligoEndCmd: translating a whole segment', () => {
	it('carries a skip along with a slide, and mirrors it on the complementary strand', () => {
		const { doc, part, seg, compSeg } = makeDuplex();
		const history = historyFor(doc);

		addSkipOrInsertionCmd({ segment: seg, atIndex: 5, count: -1 }, history);
		expect(seg.slotSeq(5)).toBe('');
		expect(compSeg.slotSeq(5)).toBe('');

		slideSegment(part, seg, 3, history);

		expect(seg.slotForBp(5)?.seq).toBe('N'); // vacated: now holds what used to be at bp 2
		expect(seg.slotSeq(8)).toBe(''); // skip relocated to 5 + delta
		expect(compSeg.slotSeq(5)).toBe('N'); // restored
		expect(compSeg.slotSeq(8)).toBe(''); // mirrored at the new position
	});

	it('carries an insertion along with a slide, and mirrors it on the complementary strand', () => {
		const { doc, part, seg, compSeg } = makeDuplex();
		const history = historyFor(doc);

		addSkipOrInsertionCmd({ segment: seg, atIndex: 5, count: 2 }, history);
		expect(seg.slotSeq(5)).toHaveLength(3);
		expect(compSeg.slotSeq(5)).toHaveLength(3);

		slideSegment(part, seg, 3, history);

		expect(seg.slotSeq(8)).toHaveLength(3);
		expect(compSeg.slotSeq(5)).toBe('N');
		expect(compSeg.slotSeq(8)).toHaveLength(3);
	});

	it('carries assigned sequence on plain slots along with a slide', () => {
		const { doc, part, seg } = makeDuplex();
		const history = historyFor(doc);
		seg.slotForBp(2)!.seq = 'A';

		slideSegment(part, seg, 3, history);

		expect(seg.slotForBp(5)?.seq).toBe('A');
		expect(seg.slotForBp(2)).toBeUndefined();
	});

	it('undoes and redoes a slide with a skip as one edit', () => {
		const { doc, part, seg, compSeg } = makeDuplex();
		const history = historyFor(doc);
		const segId = seg.id;
		const compSegId = compSeg.id;
		addSkipOrInsertionCmd({ segment: seg, atIndex: 5, count: -1 }, history);

		const before = doc.toJSON();
		slideSegment(part, seg, 3, history);
		const after = doc.toJSON();

		history.undoOnce();
		expect(doc.toJSON()).toEqual(before);
		// Undo/redo may reconstruct segment instances, so re-fetch by id rather than reusing
		// the pre-transaction references.
		expect(part.getSegmentById(segId)?.slotSeq(5)).toBe('');
		expect(part.getSegmentById(compSegId)?.slotSeq(5)).toBe('');

		history.redoOnce();
		expect(doc.toJSON()).toEqual(after);
		expect(part.getSegmentById(segId)?.slotSeq(8)).toBe('');
		expect(part.getSegmentById(compSegId)?.slotSeq(8)).toBe('');
	});

	it('blocks the whole move when the destination cannot host a relocated skip', () => {
		const { doc, part, seg, compSeg } = makeDuplex();
		const history = historyFor(doc);
		addSkipOrInsertionCmd({ segment: seg, atIndex: 5, count: -1 }, history);
		// Destination (bp 8) already has an incompatible complementary modification.
		compSeg.skipsAndInserts = [[8, 2]];

		const before = doc.toJSON();
		expect(() => slideSegment(part, seg, 3, history)).toThrow();
		expect(doc.toJSON()).toEqual(before);
		expect(seg.slotSeq(5)).toBe(''); // unchanged: move was fully rolled back
	});

	it('keeps a duplex pair correctly paired when both strands are dragged together (bulk move)', () => {
		const { doc, part, seg, compSeg } = makeDuplex();
		const history = historyFor(doc);
		const segId = seg.id;
		const compSegId = compSeg.id;
		// Two mirrored positions, so both oligos in the pair "contain skips" going into the move.
		addSkipOrInsertionCmd({ segment: seg, atIndex: 5, count: -1 }, history);
		addSkipOrInsertionCmd({ segment: seg, atIndex: 7, count: 1 }, history);
		expect(seg.slotSeq(5)).toBe('');
		expect(compSeg.slotSeq(5)).toBe('');
		expect(seg.slotSeq(7)).toHaveLength(2);
		expect(compSeg.slotSeq(7)).toHaveLength(2);

		const before = doc.toJSON();
		// All four ends (both strands of the duplex) move together by the same delta — a
		// bulk/pair drag, not a single-strand slide.
		moveOligoEndCmd(
			[
				{ part, end: seg.fivePrime, toIdx: seg.fivePrime.index + 3 },
				{ part, end: seg.threePrime, toIdx: seg.threePrime.index + 3 },
				{ part, end: compSeg.fivePrime, toIdx: compSeg.fivePrime.index + 3 },
				{ part, end: compSeg.threePrime, toIdx: compSeg.threePrime.index + 3 },
			],
			history
		);
		const after = doc.toJSON();

		// The pairing shifted in lockstep — relocated to the same new positions on both strands,
		// not scrambled or blocked because the "other side" briefly looked unoccupied/occupied
		// mid-batch.
		expect(seg.slotSeq(8)).toBe('');
		expect(compSeg.slotSeq(8)).toBe('');
		expect(seg.slotSeq(10)).toHaveLength(2);
		expect(compSeg.slotSeq(10)).toHaveLength(2);
		// Vacated positions are plain again, not stray skips/inserts.
		expect(seg.slotForBp(5)?.seq).toBe('N');
		expect(compSeg.slotForBp(5)?.seq).toBe('N');
		expect(seg.slotForBp(7)?.seq).toBe('N');
		expect(compSeg.slotForBp(7)?.seq).toBe('N');

		history.undoOnce();
		expect(doc.toJSON()).toEqual(before);
		expect(part.getSegmentById(segId)?.slotSeq(5)).toBe('');
		expect(part.getSegmentById(compSegId)?.slotSeq(5)).toBe('');

		history.redoOnce();
		expect(doc.toJSON()).toEqual(after);
		expect(part.getSegmentById(segId)?.slotSeq(8)).toBe('');
		expect(part.getSegmentById(compSegId)?.slotSeq(8)).toBe('');
	});

	it('moves two adjacent same-strand segments together without a spurious occupancy error', () => {
		const doc = new FoldnanoDocument();
		const part = doc.addNewPart('HONEYCOMB');
		const vh = addLatticeVh(part, 0, 0);
		// Two separate segments on the same strand set, back-to-back — segment a's new 3' sweep
		// would land right on segment b's old (not-yet-moved) range unless move order accounts
		// for it.
		const a = segmentOf(part.createOligo(vh, 0, 5).segments);
		const b = segmentOf(part.createOligo(vh, 6, 10).segments);
		const history = historyFor(doc);

		expect(() =>
			moveOligoEndCmd(
				[
					{ part, end: a.fivePrime, toIdx: a.fivePrime.index + 3 },
					{ part, end: a.threePrime, toIdx: a.threePrime.index + 3 },
					{ part, end: b.fivePrime, toIdx: b.fivePrime.index + 3 },
					{ part, end: b.threePrime, toIdx: b.threePrime.index + 3 },
				],
				history
			)
		).not.toThrow();

		expect([a.fivePrime.index, a.threePrime.index]).toEqual([3, 8]);
		expect([b.fivePrime.index, b.threePrime.index]).toEqual([9, 13]);
	});

	it('still clips out-of-range skips when only one end is resized (not a slide)', () => {
		const { doc, part, seg, compSeg } = makeDuplex();
		const history = historyFor(doc);
		addSkipOrInsertionCmd({ segment: seg, atIndex: 8, count: -1 }, history);

		// Shrink the segment's 3' end below bp 8: only one end moves, so this is a resize.
		moveOligoEndCmd({ part, end: seg.threePrime, toIdx: 6 }, history);

		expect(seg.slotForBp(8)).toBeUndefined();
		expect(compSeg.slotSeq(8)).toBe('N');
	});

	it('slides a duplex pair by a delta larger than the segment length (no old/new overlap)', () => {
		// Regression: moving both ends of two segments one at a time compared each end's target
		// against the *other* end's still-old index. That's fine for a small delta, but once
		// |delta| exceeds the segment's own length, the naive five-then-three order can violate
		// the five<=three (or five>=three) direction invariant even though the final state is
		// valid — this used to throw "Cannot set index: invalid move..." intermittently.
		const { doc, part, seg, compSeg } = makeDuplex();
		const history = historyFor(doc);
		addSkipOrInsertionCmd({ segment: seg, atIndex: 5, count: -1 }, history);
		const bigDelta = 20; // segment length is 10 (bp 0..10)

		expect(() =>
			moveOligoEndCmd(
				[
					{ part, end: seg.fivePrime, toIdx: seg.fivePrime.index + bigDelta },
					{ part, end: seg.threePrime, toIdx: seg.threePrime.index + bigDelta },
					{ part, end: compSeg.fivePrime, toIdx: compSeg.fivePrime.index + bigDelta },
					{ part, end: compSeg.threePrime, toIdx: compSeg.threePrime.index + bigDelta },
				],
				history
			)
		).not.toThrow();

		expect([seg.fivePrime.index, seg.threePrime.index]).toEqual([20, 30]);
		expect([compSeg.fivePrime.index, compSeg.threePrime.index]).toEqual([30, 20]);
		expect(seg.slotSeq(25)).toBe(''); // skip carried to 5 + 20
		expect(compSeg.slotSeq(25)).toBe('');
	});

	it('blocks a bulk move that would silently drop a skip on a crossover-connected strand', () => {
		const doc = new FoldnanoDocument();
		const part = doc.addNewPart('HONEYCOMB');
		const vh = addLatticeVh(part, 0, 0);
		const toVh = addLatticeVh(part, 1, 0);
		const bp = findSite(part, vh.index, 10);
		const from = segmentOf(part.createOligo(vh, 0, bp).segments);
		// Complementary strand on the same VH, so a skip at bp 2 has somewhere to mirror to.
		part.createOligo(vh, bp, 0);
		const to = segmentOf(part.createOligo(toVh, bp, bp - 1).segments);
		from.threePrime.connectTo(to.fivePrime);
		expect(from.threePrime.isConstrained).toBe(true);

		const history = historyFor(doc);
		addSkipOrInsertionCmd({ segment: from, atIndex: 2, count: -1 }, history);

		const before = doc.toJSON();
		expect(() =>
			moveOligoEndCmd(
				[
					{ part, end: from.fivePrime, toIdx: from.fivePrime.index + 5 },
					{ part, end: from.threePrime, toIdx: from.threePrime.index + 5 },
				],
				history
			)
		).toThrow(/crossover/);
		expect(doc.toJSON()).toEqual(before);
		expect(from.slotSeq(2)).toBe(''); // unchanged: move was fully rejected, not silently clipped
	});

	it('blocks a bulk move that would strand assigned sequence at its old bp on a crossover-connected strand', () => {
		// Same setup as the skip-drop test above, but with a plain assigned base instead of a
		// skip/insert, at a bp that still falls *inside* the segment's new range after the shift
		// (unlike the skip case, which is dropped because it falls outside) — the narrower
		// out-of-range-only check used to miss this and let the base silently strand in place.
		const doc = new FoldnanoDocument();
		const part = doc.addNewPart('HONEYCOMB');
		const vh = addLatticeVh(part, 0, 0);
		const toVh = addLatticeVh(part, 1, 0);
		const bp = findSite(part, vh.index, 20);
		const from = segmentOf(part.createOligo(vh, 0, bp).segments);
		part.createOligo(vh, bp, 0);
		const to = segmentOf(part.createOligo(toVh, bp, bp - 1).segments);
		from.threePrime.connectTo(to.fivePrime);
		expect(from.threePrime.isConstrained).toBe(true);

		const history = historyFor(doc);
		const delta = 5;
		const bpToCheck = 10; // stays inside [0 + delta, bp + delta] after the shift
		from.slotForBp(bpToCheck)!.seq = 'A';

		const before = doc.toJSON();
		expect(() =>
			moveOligoEndCmd(
				[
					{ part, end: from.fivePrime, toIdx: from.fivePrime.index + delta },
					{ part, end: from.threePrime, toIdx: from.threePrime.index + delta },
				],
				history
			)
		).toThrow(/crossover/);
		expect(doc.toJSON()).toEqual(before);
		// Unchanged: move was fully rejected, not silently left stranded at the old bp.
		expect(from.slotSeq(bpToCheck)).toBe('A');
	});

	it('carries a skip through a crossover-connected bulk move when both sides move together', () => {
		const doc = new FoldnanoDocument();
		const part = doc.addNewPart('HONEYCOMB');
		const vh = addLatticeVh(part, 0, 0);
		const toVh = addLatticeVh(part, 1, 0);
		const bp = findSite(part, vh.index, 10);
		const from = segmentOf(part.createOligo(vh, 0, bp).segments);
		// Complementary strand on `from`'s VH stays put — the skip's mirroring should still work
		// via the ordinary stationary-partner path, independent of the crossover partner moving.
		// Spans the whole VH so it still covers the skip's new (shifted) position.
		const fromComp = segmentOf(part.createOligo(vh, vh.length - 1, 0).segments);
		const to = segmentOf(part.createOligo(toVh, bp, bp - 1).segments);
		from.threePrime.connectTo(to.fivePrime);
		expect(from.threePrime.isConstrained).toBe(true);
		expect(to.fivePrime.isConstrained).toBe(true);

		const history = historyFor(doc);
		addSkipOrInsertionCmd({ segment: from, atIndex: 2, count: -1 }, history);
		expect(from.slotSeq(2)).toBe('');
		expect(fromComp.slotSeq(2)).toBe('');

		const delta = findTranslatableXoverDelta(part, vh.index, toVh.index, bp);

		// Both sides of the crossover — `from` and `to` — move together in one batch.
		expect(() =>
			moveOligoEndCmd(
				[
					{ part, end: from.fivePrime, toIdx: from.fivePrime.index + delta },
					{ part, end: from.threePrime, toIdx: from.threePrime.index + delta },
					{ part, end: to.fivePrime, toIdx: to.fivePrime.index + delta },
					{ part, end: to.threePrime, toIdx: to.threePrime.index + delta },
				],
				history
			)
		).not.toThrow();

		expect(from.slotSeq(2 + delta)).toBe('');
		expect(fromComp.slotSeq(2 + delta)).toBe('');
		// The crossover survived the move: both sides still land on the same bp.
		expect(from.threePrime.index).toBe(bp + delta);
		expect(to.fivePrime.index).toBe(bp + delta);
		expect(from.threePrime.isConstrained).toBe(true);
	});
});
