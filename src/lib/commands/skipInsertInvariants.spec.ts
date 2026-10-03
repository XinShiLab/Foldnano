import { describe, expect, it } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import type OligoSegment from '$lib/model/Oligo/OligoSegment.svelte';
import type VirtualHelix from '$lib/model/VirtualHelix';
import { addLatticeVh } from '$lib/model/test/testHelpers';
import { StorageManager } from '$lib/services/storage/StorageManager';
import type { StorageProvider } from '$lib/services/storage/StorageProvider';
import { resolveTargetBpIdx } from '$lib/canvasEditor/tools/skipInsertUtils';
import { HistoryStack } from './history.svelte';
import { addSkipOrInsertionCmd, removeSkipOrInsertionCmd } from './strands';

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

function findSite(vh: VirtualHelix): number {
	const site = vh.inPart.potentialXoverSites(vh.index)[0].find((candidate) => candidate.bpIdx > 2);
	if (!site) throw new Error('Expected a usable crossover site');
	return site.bpIdx;
}

function makeConstrainedEnd() {
	const doc = new FoldnanoDocument();
	const part = doc.addNewPart('HONEYCOMB');
	const vh = addLatticeVh(part, 0, 0);
	const toVh = addLatticeVh(part, 1, 0);
	const bp = findSite(vh);
	const from = segmentOf(part.createOligo(vh, 0, bp).segments);
	const to = segmentOf(part.createOligo(toVh, bp, bp - 1).segments);
	from.threePrime.connectTo(to.fivePrime);
	expect(from.threePrime.isConstrained).toBe(true);
	return { doc, part, from, bp };
}

describe('skip/insert invariants', () => {
	it('command-level add/remove mirrors complementary slots', () => {
		const { doc, seg, compSeg } = makeDuplex();
		const history = historyFor(doc);

		addSkipOrInsertionCmd({ segment: seg, atIndex: 5, count: 2 }, history);
		expect(seg.slotSeq(5)).toHaveLength(3);
		expect(compSeg.slotSeq(5)).toHaveLength(3);

		removeSkipOrInsertionCmd({ segment: seg, atIndex: 5 }, history);
		expect(seg.slotSeq(5)).toBe('N');
		expect(compSeg.slotSeq(5)).toBe('N');
	});

	it('rejects conflicting complementary modifications', () => {
		const { doc, seg, compSeg } = makeDuplex();
		const history = historyFor(doc);
		compSeg.skipsAndInserts = [[5, 2]];

		expect(() => addSkipOrInsertionCmd({ segment: seg, atIndex: 5, count: -1 }, history)).toThrow(
			/complementary slot is modified/
		);
	});

	it('rejects constrained crossover sites in model and UI target resolution', () => {
		const { doc, part, from, bp } = makeConstrainedEnd();
		const history = historyFor(doc);

		expect(resolveTargetBpIdx(part, from, bp)).toBeNull();
		expect(() => addSkipOrInsertionCmd({ segment: from, atIndex: bp, count: 1 }, history)).toThrow(
			/constrained crossover site/
		);
	});
});
