import { describe, expect, it, vi } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import type OligoSegment from '$lib/model/Oligo/OligoSegment.svelte';
import type { SegmentEnd } from '$lib/model/Oligo';
import type { Part } from '$lib/model/Part';
import type { ViewContext } from '$lib/canvasEditor/core/views';
import { addLatticeVh } from '$lib/model/test/testHelpers';
import { StorageManager } from '$lib/services/storage/StorageManager';
import type { StorageProvider } from '$lib/services/storage/StorageProvider';
import { HistoryStack } from '$lib/commands/history.svelte';
import { canBatchMoveByDelta, commitMovingEnds, type MoveEndState } from './movingEndsOps';

const { toastWarning } = vi.hoisted(() => ({ toastWarning: vi.fn() }));
vi.mock('svelte-sonner', () => ({ toast: { warning: toastWarning } }));

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

function makeMockCtx(part: Part, history: HistoryStack): ViewContext {
	return {
		part,
		history,
		strandCtx: { tempParts: [{ type: 'MoveEndBox', props: {} }] },
	} as unknown as ViewContext;
}

function makeMoveState(endsToBeMoved: { end: SegmentEnd; toIdx: number }[]): MoveEndState {
	return {
		isMoving: true,
		endsToBeMoved,
		fromRefIdx: 0,
		toRefIdx: 0,
		tempById: new Map(),
	};
}

/** Builds a crossover-connected segment whose partner is *not* co-moving, with a plain assigned
 * base at a bp that stays inside the segment's new range after a +5 slide — the exact scenario
 * that must be rejected (see strands.ts `segmentHasContentUnsafeForResize`). */
function makeUnsafeCrossoverScenario() {
	const doc = new FoldnanoDocument();
	const part = doc.addNewPart('HONEYCOMB');
	const vh = addLatticeVh(part, 0, 0);
	const toVh = addLatticeVh(part, 1, 0);
	const bp = findSite(part, vh.index, 20);
	const from = segmentOf(part.createOligo(vh, 0, bp).segments);
	part.createOligo(vh, bp, 0);
	const to = segmentOf(part.createOligo(toVh, bp, bp - 1).segments);
	from.threePrime.connectTo(to.fivePrime);
	from.slotForBp(10)!.seq = 'A';
	return { doc, part, from };
}

describe('canBatchMoveByDelta', () => {
	it('rejects a delta that would strand assigned sequence on a crossover-connected segment', () => {
		const { from } = makeUnsafeCrossoverScenario();
		expect(canBatchMoveByDelta([from.fivePrime, from.threePrime], 5)).toBe(false);
	});

	it('rejects a single-end drag that would shrink a segment to 1 bp, on either strand', () => {
		const doc = new FoldnanoDocument();
		const part = doc.addNewPart('HONEYCOMB');
		const vh = addLatticeVh(part, 0, 0);
		const up = segmentOf(part.createOligo(vh, 5, 7).segments);
		const down = segmentOf(part.createOligo(vh, 17, 15).segments);

		expect(canBatchMoveByDelta([up.threePrime], -1)).toBe(true);
		expect(canBatchMoveByDelta([up.threePrime], -2)).toBe(false);
		expect(canBatchMoveByDelta([down.threePrime], 1)).toBe(true);
		expect(canBatchMoveByDelta([down.threePrime], 2)).toBe(false);
	});
});

describe('commitMovingEnds', () => {
	it('resets drag state even when the move is rejected', () => {
		const { doc, part, from } = makeUnsafeCrossoverScenario();
		const history = historyFor(doc);
		const ctx = makeMockCtx(part, history);
		const movingEnds = makeMoveState([
			{ end: from.fivePrime, toIdx: from.fivePrime.index + 5 },
			{ end: from.threePrime, toIdx: from.threePrime.index + 5 },
		]);

		expect(() => commitMovingEnds(ctx, movingEnds)).toThrow(/crossover/);

		expect(movingEnds.isMoving).toBe(false);
		expect(movingEnds.endsToBeMoved).toEqual([]);
		expect(ctx.strandCtx.tempParts).toEqual([]);
		expect(toastWarning).not.toHaveBeenCalled();
	});

	it('resets drag state and shows a mismatch toast after a successful move that strands sequence', () => {
		toastWarning.mockClear();
		const doc = new FoldnanoDocument();
		const part = doc.addNewPart('HONEYCOMB');
		const vh = addLatticeVh(part, 0, 0);
		const seg = segmentOf(part.createOligo(vh, 0, 10).segments);
		const compSeg = segmentOf(part.createOligo(vh, 10, 0).segments);
		seg.slotForBp(2)!.seq = 'A';
		compSeg.slotForBp(5)!.seq = 'A'; // not 'T' — mismatched once seg's base lands here

		const history = historyFor(doc);
		const ctx = makeMockCtx(part, history);
		const movingEnds = makeMoveState([
			{ end: seg.fivePrime, toIdx: seg.fivePrime.index + 3 },
			{ end: seg.threePrime, toIdx: seg.threePrime.index + 3 },
		]);

		expect(() => commitMovingEnds(ctx, movingEnds)).not.toThrow();

		expect(movingEnds.isMoving).toBe(false);
		expect(movingEnds.endsToBeMoved).toEqual([]);
		expect(seg.slotSeq(5)).toBe('A');
		expect(toastWarning).toHaveBeenCalledTimes(1);
	});
});
