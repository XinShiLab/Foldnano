import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

function findSite(part: Part, vhIndex: number, minBp: number): number {
	const site = part.potentialXoverSites(vhIndex)[0].find((candidate) => candidate.bpIdx > minBp);
	if (!site) throw new Error('Expected a usable crossover site');
	return site.bpIdx;
}

describe('undoing a translate does not corrupt unrelated crossover-connected VirtualHelices', () => {
	it('keeps an untouched, multi-VH-spanning oligo and its VH intact after undo', () => {
		const doc = new FoldnanoDocument();
		const part = doc.addNewPart('HONEYCOMB');
		const vh0 = addLatticeVh(part, 0, 0);
		const vh1 = addLatticeVh(part, 1, 0);

		// `crossVh0`/`crossVh1`: an oligo crossover-connected between VH0 and VH1. Never selected or
		// dragged directly; only reachable via `mover`'s skip needing a complementary mirror on
		// `crossVh0` (same VH, opposite strand). This is exactly the shape that exposes the
		// scope-capture bug: the oligo gets pulled into the undo/redo scope via one segment, but the
		// *other* segment's VH (VH1) was never part of the original seed.
		const bp = findSite(part, vh0.index, 10);
		const crossVh0 = segmentOf(part.createOligo(vh0, 0, bp).segments); // VH0 strand0
		const crossVh1 = segmentOf(part.createOligo(vh1, bp, bp - 1).segments); // VH1 strand1
		// `connectTwoOligos` (not a raw `connectTo`) merges the two into a single oligo with both
		// segments — matching the real repro, where the crossover oligo genuinely spans both VHs.
		part.connectTwoOligos(crossVh0.oligo!, crossVh1.oligo!);
		expect(crossVh0.threePrime.isConstrained).toBe(true);
		expect(crossVh0.oligo).toBe(crossVh1.oligo);
		const crossOligoId = crossVh0.oligo!.id;

		// `mover`: a plain, unconnected oligo on VH0 strand1 — crossVh0's complementary strand —
		// with a skip. This is what gets dragged.
		const mover = segmentOf(part.createOligo(vh0, 20, 0).segments);

		const history = historyFor(doc);
		addSkipOrInsertionCmd({ segment: mover, atIndex: 5, count: -1 }, history);
		expect(mover.slotSeq(5)).toBe('');
		expect(crossVh0.slotSeq(5)).toBe('');

		const before = doc.toJSON();

		// Slide `mover` — both ends, uniform delta — which mirrors its skip onto crossVh0 (old +
		// new position), pulling crossVh0's oligo into the move's undo/redo scope.
		moveOligoEndCmd(
			[
				{ part, end: mover.fivePrime, toIdx: mover.fivePrime.index + 3 },
				{ part, end: mover.threePrime, toIdx: mover.threePrime.index + 3 },
			],
			history
		);
		expect(mover.slotSeq(8)).toBe('');
		expect(crossVh0.slotSeq(8)).toBe('');

		history.undoOnce();

		expect(part.virtualHelices.length).toBe(2);
		expect(part.getVhByIndex(vh1.index)).not.toBeNull();
		const restoredCrossOligo = part.getOligoById(crossOligoId);
		expect(restoredCrossOligo).not.toBeNull();
		expect(restoredCrossOligo!.segments.size).toBe(2);
		expect(doc.toJSON()).toEqual(before);

		history.redoOnce();
		const redoneMover = part.getSegmentById(mover.id)!;
		expect(redoneMover.slotSeq(8)).toBe('');
		expect(part.virtualHelices.length).toBe(2);
		expect(part.getOligoById(crossOligoId)!.segments.size).toBe(2);
	});
});

describe('undo_after_move_bug.fn.json regression', () => {
	it('does not corrupt the design after moving the VH0 strand0 segment and undoing', () => {
		const raw = JSON.parse(
			readFileSync(join(process.cwd(), 'test_files/fn_designs/undo_after_move_bug.fn.json'), 'utf8')
		);
		const doc = FoldnanoDocument.fromJSON(raw);
		const part = doc.parts[0];
		const history = historyFor(doc);

		const mover = part.getSegmentById('4fda0bb5-889f-4491-950b-abfd42e3081c')!;
		const before = doc.toJSON();

		moveOligoEndCmd(
			[
				{ part, end: mover.fivePrime, toIdx: mover.fivePrime.index + 1 },
				{ part, end: mover.threePrime, toIdx: mover.threePrime.index + 1 },
			],
			history
		);

		expect(() => history.undoOnce()).not.toThrow();

		expect(part.virtualHelices.length).toBe(2);
		expect(part.oligos.size).toBe(4);
		// Round-trip, modulo `strandSets[].segmentIds` order — that's a SvelteSet serialized to an
		// array, so its iteration order isn't semantically meaningful and can legitimately shift
		// after a destroy/recreate cycle. Whatever pre-existing state the fixture had (including any
		// legacy dangling IDs from before this fix existed) is otherwise neither fixed nor made
		// worse — nothing new broke.
		expect(normalizeSegmentIdOrder(doc.toJSON())).toEqual(normalizeSegmentIdOrder(before));
	});
});

function normalizeSegmentIdOrder(snapshot: ReturnType<FoldnanoDocument['toJSON']>) {
	const clone = JSON.parse(JSON.stringify(snapshot));
	for (const part of clone.parts) {
		for (const vh of part.virtualHelices) {
			for (const strandSet of vh.strandSets) {
				strandSet.segmentIds = [...strandSet.segmentIds].sort();
			}
		}
	}
	return clone;
}
