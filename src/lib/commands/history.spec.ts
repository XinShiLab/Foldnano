import { addLatticeVh } from '$lib/model/test/testHelpers';
import { describe, expect, it } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import { HistoryStack } from './history.svelte';
import {
	addSkipOrInsertionCmd,
	breakOligoCmd,
	createCrossoverCmd,
	drawStrandCmd,
	fillSequenceToOligoCmd,
	makeCrossoverCmd,
	paintOligoCmd,
	removeCustomModificationCmd,
	removeOligoCmd,
	setCustomModificationsCmd,
	setModificationCmd,
	toggleOligoAsScaffoldCmd,
	moveOligoEndCmd,
} from './strands';
import { reorderVirtualHelixCmd } from './virtualHelices';
import { StorageManager } from '$lib/services/storage/StorageManager';
import type { StorageProvider } from '$lib/services/storage/StorageProvider';
import { applyEndAlignment } from '$lib/canvasEditor/tools/select/handlers/endAlignmentOps';

class MockStorageProvider implements StorageProvider {
	saveCalls = 0;

	async saveDocument(): Promise<boolean> {
		this.saveCalls++;
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

const createHistory = (
	doc: FoldnanoDocument,
	options?: { canPersistSnapshot?: () => boolean; provider?: MockStorageProvider }
) => {
	const storage = new StorageManager('memory');
	const provider = options?.provider ?? new MockStorageProvider();
	storage.registerProvider('memory', provider);
	return new HistoryStack(doc, storage, undefined, options?.canPersistSnapshot);
};

const createDocWithPartAndVh = () => {
	const doc = new FoldnanoDocument('doc-1', 'History Test');
	const part = doc.addNewPart('HONEYCOMB');
	const vh = addLatticeVh(part, 0, 0);
	return { doc, part, vh };
};

describe('granular command history', () => {
	it('undoes and redoes scalar field commands', () => {
		const { doc, part, vh } = createDocWithPartAndVh();
		const history = createHistory(doc);
		const oligo = part.createOligo(vh, 0, 10, '#111111');
		const segment = Array.from(oligo.segments)[0];

		const before = doc.toJSON();
		paintOligoCmd({ oligo, color: '#abcdef' }, history);
		toggleOligoAsScaffoldCmd({ oligo }, history);
		setModificationCmd({ end: segment.fivePrime, modification: 'biotin' }, history);
		const after = doc.toJSON();

		expect(history.numberOfUndos).toBe(3);

		history.undoOnce();
		history.undoOnce();
		history.undoOnce();
		expect(doc.toJSON()).toEqual(before);

		history.redoOnce();
		history.redoOnce();
		history.redoOnce();
		expect(doc.toJSON()).toEqual(after);
	});

	it('drops a modification when a crossover connects a modified free end, and undo restores it', () => {
		const { doc, part, vh: vh1 } = createDocWithPartAndVh();
		const vh2 = addLatticeVh(part, 1, 0);
		const history = createHistory(doc);

		const fromOligo = part.createOligo(vh1, 0, 20, '#111111');
		const toOligo = part.createOligo(vh2, 20, 0, '#222222');
		const toSegment = Array.from(toOligo.segments)[0];

		setModificationCmd({ end: fromOligo.threePrime!, modification: 'Cy3' }, history);
		setModificationCmd({ end: toOligo.fivePrime!, modification: 'Cy5' }, history);

		const before = doc.toJSON();

		// atIndexTarget === toOligo.fivePrime.index: a direct connect (no split), so both
		// captured termini are the ones that actually become connected.
		const result = createCrossoverCmd(
			{ part, fromOligo, toOligo, toSegment, atIndexTarget: 20 },
			history
		);

		expect(result.droppedModifications.sort()).toEqual(['Cy3', 'Cy5']);

		history.undoOnce();
		expect(doc.toJSON()).toEqual(before);
	});

	it('removing a custom modification clears it from every end that carries it, and undo restores both', () => {
		const { doc, part, vh } = createDocWithPartAndVh();
		const history = createHistory(doc);
		const oligoA = part.createOligo(vh, 0, 10, '#111111');
		const oligoB = part.createOligo(vh, 20, 30, '#222222');
		const segmentA = Array.from(oligoA.segments)[0];
		const segmentB = Array.from(oligoB.segments)[0];

		setCustomModificationsCmd(part, [{ name: 'Azide', color: '#22c55e' }], history);
		setModificationCmd({ end: segmentA.fivePrime, modification: 'Azide' }, history);
		setModificationCmd({ end: segmentB.fivePrime, modification: 'Azide' }, history);

		expect(part.getEndsWithModification('Azide')).toHaveLength(2);

		const before = doc.toJSON();
		removeCustomModificationCmd(part, 'Azide', history);

		expect(part.customModifications).toHaveLength(0);
		expect(part.getEndsWithModification('Azide')).toHaveLength(0);
		expect(segmentA.fivePrime.modification).toBeNull();
		expect(segmentB.fivePrime.modification).toBeNull();

		history.undoOnce();
		expect(doc.toJSON()).toEqual(before);
		expect(segmentA.fivePrime.modification).toBe('Azide');
		expect(segmentB.fivePrime.modification).toBe('Azide');
	});

	it('undoes and redoes slot commands without whole-document fallback', () => {
		const { doc, part, vh } = createDocWithPartAndVh();
		const history = createHistory(doc);
		const oligo = part.createOligo(vh, 0, 10, '#111111');
		part.createOligo(vh, 10, 0, '#222222');
		const segment = Array.from(oligo.segments)[0];

		const before = doc.toJSON();
		addSkipOrInsertionCmd({ segment, atIndex: 5, count: 2 }, history);
		const after = doc.toJSON();

		expect(segment.slotForBp(5)?.seq).toBe('NNN');
		history.undoOnce();
		expect(doc.toJSON()).toEqual(before);
		expect(segment.slotForBp(5)?.seq).toBe('N');

		history.redoOnce();
		expect(doc.toJSON()).toEqual(after);
		expect(segment.slotForBp(5)?.seq).toBe('NNN');
	});

	it('restores sequence lock state after slot history side effects', () => {
		const { doc, part, vh } = createDocWithPartAndVh();
		const history = createHistory(doc);
		const oligo = part.createOligo(vh, 0, 10, '#111111');

		fillSequenceToOligoCmd({ oligo, sequence: 'ACGTACGTACG', lockSequence: true }, history);
		expect(oligo.isSequenceLocked).toBe(true);

		history.undoOnce();
		const restoredOligo = Array.from(part.oligos)[0];
		expect(restoredOligo.isSequenceLocked).toBe(false);

		history.redoOnce();
		expect(restoredOligo.isSequenceLocked).toBe(true);
	});

	it('undoes and redoes drawn strands with localized part mementos', () => {
		const { doc, part, vh } = createDocWithPartAndVh();
		const history = createHistory(doc);

		const before = doc.toJSON();
		drawStrandCmd({ part, vhIdx: vh.index, startIdx: 0, endIdx: 10, color: '#123456' }, history);
		const after = doc.toJSON();

		expect(part.oligos.size).toBe(1);
		history.undoOnce();
		expect(doc.toJSON()).toEqual(before);
		expect(part.getEntitiesAt(vh.listRow, 0, 5).segment).toBeNull();

		history.redoOnce();
		expect(doc.toJSON()).toEqual(after);
		expect(part.getEntitiesAt(vh.listRow, 0, 5).segment).not.toBeNull();
	});

	it('drawing a strand does not remove existing oligos on the same VH when undone', () => {
		const { doc, part, vh } = createDocWithPartAndVh();
		const history = createHistory(doc);
		const existingOligo = part.createOligo(vh, 0, 10, '#111111');

		const before = doc.toJSON();
		drawStrandCmd({ part, vhIdx: vh.index, startIdx: 15, endIdx: 20, color: '#123456' }, history);
		const after = doc.toJSON();

		expect(part.oligos.size).toBe(2);
		history.undoOnce();
		expect(doc.toJSON()).toEqual(before);
		expect(part.getOligoById(existingOligo.id)).not.toBeNull();
		expect(part.oligos.size).toBe(1);

		history.redoOnce();
		expect(doc.toJSON()).toEqual(after);
		expect(part.getOligoById(existingOligo.id)).not.toBeNull();
		expect(part.oligos.size).toBe(2);
	});

	it('undoes and redoes break and remove topology commands', () => {
		const { doc, part, vh } = createDocWithPartAndVh();
		const history = createHistory(doc);
		const oligo = part.createOligo(vh, 0, 20, '#111111');
		const segment = Array.from(oligo.segments)[0];

		const beforeBreak = doc.toJSON();
		breakOligoCmd({ part, oligo, segment, atIndex: 10 }, history);
		const afterBreak = doc.toJSON();
		expect(part.oligos.size).toBe(2);

		history.undoOnce();
		expect(doc.toJSON()).toEqual(beforeBreak);
		expect(part.getEntitiesAt(vh.listRow, 0, 15).segment).not.toBeNull();

		history.redoOnce();
		expect(doc.toJSON()).toEqual(afterBreak);

		const oligoToRemove = Array.from(part.oligos)[0];
		const beforeRemove = doc.toJSON();
		removeOligoCmd({ part, oligo: oligoToRemove }, history);
		const afterRemove = doc.toJSON();

		history.undoOnce();
		expect(doc.toJSON()).toEqual(beforeRemove);

		history.redoOnce();
		expect(doc.toJSON()).toEqual(afterRemove);
	});

	it('moving one end does not remove unrelated oligos on undo', () => {
		const { doc, part, vh } = createDocWithPartAndVh();
		const history = createHistory(doc);
		const movedOligo = part.createOligo(vh, 0, 10, '#111111');
		const untouchedOligo = part.createOligo(vh, 15, 20, '#222222');
		const otherVh = addLatticeVh(part, 0, 1);
		const otherVhOligo = part.createOligo(otherVh, 0, 10, '#333333');
		const movedSegment = Array.from(movedOligo.segments)[0];

		const before = doc.toJSON();
		moveOligoEndCmd({ part, end: movedSegment.threePrime, toIdx: 12 }, history);
		const after = doc.toJSON();

		expect(part.oligos.size).toBe(3);
		history.undoOnce();
		expect(doc.toJSON()).toEqual(before);
		expect(part.getOligoById(untouchedOligo.id)).not.toBeNull();
		expect(part.getOligoById(otherVhOligo.id)).not.toBeNull();
		expect(part.oligos.size).toBe(3);

		history.redoOnce();
		expect(doc.toJSON()).toEqual(after);
		expect(part.getOligoById(untouchedOligo.id)).not.toBeNull();
		expect(part.getOligoById(otherVhOligo.id)).not.toBeNull();
		expect(part.oligos.size).toBe(3);
	});

	it('undoes and redoes aligned end batches as one edit', () => {
		const { doc, part, vh } = createDocWithPartAndVh();
		const history = createHistory(doc);
		const otherVh = addLatticeVh(part, 0, 1);
		const left = Array.from(part.createOligo(vh, 5, 10, '#111111').segments)[0];
		const right = Array.from(part.createOligo(otherVh, 15, 20, '#222222').segments)[0];

		const before = doc.toJSON();
		const applied = applyEndAlignment(history, 'left', [left.fivePrime, right.fivePrime]);
		const after = doc.toJSON();

		expect(applied).toBe(true);
		expect(history.numberOfUndos).toBe(1);
		expect(right.fivePrime.index).toBe(5);

		history.undoOnce();
		expect(doc.toJSON()).toEqual(before);

		history.redoOnce();
		expect(doc.toJSON()).toEqual(after);
	});

	it('rejects an end move that would leave a 1-bp segment, without committing history', () => {
		const { doc, part, vh } = createDocWithPartAndVh();
		const history = createHistory(doc);
		const segment = Array.from(part.createOligo(vh, 5, 7).segments)[0];
		const before = doc.toJSON();

		expect(() => moveOligoEndCmd({ part, end: segment.threePrime, toIdx: 5 }, history)).toThrow();

		expect(history.numberOfUndos).toBe(0);
		expect(doc.toJSON()).toEqual(before);
	});

	it('does not commit history when an aligned end batch is invalid', () => {
		const { doc, part, vh } = createDocWithPartAndVh();
		const history = createHistory(doc);
		const left = Array.from(part.createOligo(vh, 0, 10, '#111111').segments)[0];
		const right = Array.from(part.createOligo(vh, 12, 20, '#222222').segments)[0];
		const before = doc.toJSON();

		const applied = applyEndAlignment(history, 'right', [left.threePrime, right.threePrime]);

		expect(applied).toBe(false);
		expect(history.numberOfUndos).toBe(0);
		expect(doc.toJSON()).toEqual(before);
	});

	it('clears redo after a new granular edit', () => {
		const { doc, part, vh } = createDocWithPartAndVh();
		const history = createHistory(doc);
		const oligo = part.createOligo(vh, 0, 10, '#111111');

		paintOligoCmd({ oligo, color: '#222222' }, history);
		history.undoOnce();
		expect(history.numberOfRedos).toBe(1);

		paintOligoCmd({ oligo, color: '#333333' }, history);
		expect(history.numberOfRedos).toBe(0);
	});

	it('does not commit history or leave partial state behind when a targeted tx throws', () => {
		const { doc, part } = createDocWithPartAndVh();
		const history = createHistory(doc);
		const plane = part.getDefaultPlane();
		const region = part.getDefaultRegion();
		const before = doc.toJSON();

		expect(() =>
			history.tx('Remove region', (rec) => {
				rec.regionRemove(part, region);
				rec.planeRemove(part, plane);
				part.removeRegion(region.id);
				part.removePlane(plane.id);
			})
		).toThrow(/still has virtual helices/);

		expect(history.numberOfUndos).toBe(0);
		expect(doc.toJSON()).toEqual(before);
		const restoredPart = doc.parts[0];
		expect(restoredPart.getRegionById(region.id)).not.toBeNull();
		expect(restoredPart.getPlaneById(plane.id)).not.toBeNull();
	});

	it('does not commit history or leave partial state behind when a snapshotTx throws mid-mutation', () => {
		// snapshotTx (used by plugin Apply) has its own rollback path, separate from tx's above.
		const { doc, part, vh } = createDocWithPartAndVh();
		const history = createHistory(doc);
		const before = doc.toJSON();

		expect(() =>
			history.snapshotTx('Plugin: test', () => {
				part.createOligo(vh, 0, 10, '#111111');
				throw new Error('boom');
			})
		).toThrow('boom');

		expect(history.numberOfUndos).toBe(0);
		expect(history.numberOfRedos).toBe(0);
		expect(doc.toJSON()).toEqual(before);
	});

	it('blocks saveNow when persistence is disallowed and keeps dirty state', async () => {
		const { doc, part, vh } = createDocWithPartAndVh();
		const provider = new MockStorageProvider();
		const history = createHistory(doc, {
			provider,
			canPersistSnapshot: () => false,
		});
		const oligo = part.createOligo(vh, 0, 10, '#111111');

		paintOligoCmd({ oligo, color: '#abcdef' }, history);
		expect(history.autoSaveStatus.hasUnsavedChanges).toBe(true);

		const result = await history.saveNow();

		expect(result).toEqual({ success: false, savedAt: null });
		expect(provider.saveCalls).toBe(0);
		expect(history.autoSaveStatus.hasUnsavedChanges).toBe(true);
		expect(history.autoSaveStatus.editsSinceLastSave).toBe(1);
	});

	it('persists region-local VH reorder through the history transaction', () => {
		const { doc, part } = createDocWithPartAndVh();
		const history = createHistory(doc);
		const vh0 = part.virtualHelices[0];
		const vh1 = addLatticeVh(part, 0, 1);
		const vh2 = addLatticeVh(part, 0, 2);
		const ctx = { part, history } as unknown as Parameters<typeof reorderVirtualHelixCmd>[0];

		expect(part.getDefaultRegion().vhOrder).toEqual([vh0.id, vh1.id, vh2.id]);

		reorderVirtualHelixCmd(ctx, vh2.index, 0);

		expect(part.getDefaultRegion().vhOrder).toEqual([vh2.id, vh0.id, vh1.id]);
		expect(vh2.listRow).toBe(0);

		history.undoOnce();
		expect(part.getDefaultRegion().vhOrder).toEqual([vh0.id, vh1.id, vh2.id]);

		history.redoOnce();
		expect(part.getDefaultRegion().vhOrder).toEqual([vh2.id, vh0.id, vh1.id]);
	});

	it('makes crossover sites against VH identities after row reorder', () => {
		const { doc, part, vh: vh0 } = createDocWithPartAndVh();
		const history = createHistory(doc);
		const vh1 = addLatticeVh(part, 1, 0);

		const sitesByStrand = part.potentialXoverSites(vh0.index);
		const sourceStrandIdx = ([0, 1] as const).find((strandIdx) =>
			sitesByStrand[strandIdx].some((site) => site.toVhIdx === vh1.index && site.bpIdx > 1)
		);
		expect(sourceStrandIdx).toBeDefined();

		const xoverSite = sitesByStrand[sourceStrandIdx!].find(
			(site) => site.toVhIdx === vh1.index && site.bpIdx > 1
		)!;
		const sourceStrand = sourceStrandIdx as 0 | 1;
		const targetStrand = (1 - sourceStrand) as 0 | 1;
		const sourceEnd = Math.max(xoverSite.bpIdx + 8, 12);
		const targetEnd = Math.max(xoverSite.bpIdx + 8, 12);

		part.createOligo(
			vh0,
			sourceStrand === 0 ? 0 : sourceEnd,
			sourceStrand === 0 ? sourceEnd : 0,
			'#111111'
		);
		part.createOligo(
			vh1,
			targetStrand === 0 ? 0 : targetEnd,
			targetStrand === 0 ? targetEnd : 0,
			'#222222'
		);

		const ctx = { part, history } as unknown as Parameters<typeof reorderVirtualHelixCmd>[0];
		reorderVirtualHelixCmd(ctx, vh1.index, 0);

		makeCrossoverCmd(
			{
				part,
				fromVhIdx: vh0.index,
				strandIdx: sourceStrand,
				bpIdx: xoverSite.bpIdx,
				toVhIdx: vh1.index,
				right: xoverSite.right,
			},
			history
		);

		const hasConnectionToTarget = [...part.oligos].some((oligo) =>
			[...oligo.segments].some(
				(segment) =>
					(segment.inVirtualHelix.id === vh0.id &&
						(segment.fivePrime.connectedSegment?.inVirtualHelix.id === vh1.id ||
							segment.threePrime.connectedSegment?.inVirtualHelix.id === vh1.id)) ||
					(segment.inVirtualHelix.id === vh1.id &&
						(segment.fivePrime.connectedSegment?.inVirtualHelix.id === vh0.id ||
							segment.threePrime.connectedSegment?.inVirtualHelix.id === vh0.id))
			)
		);
		expect(hasConnectionToTarget).toBe(true);
	});
});

describe('history limits', () => {
	const paintNTimes = (n: number) => {
		const { doc, part, vh } = createDocWithPartAndVh();
		const history = createHistory(doc);
		const oligo = part.createOligo(vh, 0, 10, '#000000');
		return {
			history,
			oligo,
			paint: () => {
				for (let i = 1; i <= n; i++) paintOligoCmd({ oligo, color: `#00000${i}` }, history);
			},
		};
	};

	it('drops the oldest entries beyond maxEntries, and the kept ones still undo', () => {
		const { history, oligo, paint } = paintNTimes(5);
		history.setHistoryLimits({ maxEntries: 3 });
		paint();

		expect(history.numberOfUndos).toBe(3);
		expect(history.droppedEntryCount).toBe(2);
		history.undoOnce();
		history.undoOnce();
		history.undoOnce();
		expect(oligo.color).toBe('#000002');
		expect(history.numberOfUndos).toBe(0);
	});

	it('keeps only the newest entry when the byte budget is exceeded', () => {
		const { history, paint } = paintNTimes(4);
		history.setHistoryLimits({ maxBytes: 1 });
		paint();

		expect(history.numberOfUndos).toBe(1);
		expect(history.droppedEntryCount).toBe(3);
	});

	it('trims existing entries when the limits are lowered', () => {
		const { history, paint } = paintNTimes(4);
		paint();
		history.setHistoryLimits({ maxEntries: 2 });

		expect(history.numberOfUndos).toBe(2);
		expect(history.droppedEntryCount).toBe(2);
	});
});

describe('history revision', () => {
	it('bumps on every commit, undo and redo, so views can recompute once per edit', () => {
		const { doc, part, vh } = createDocWithPartAndVh();
		const history = createHistory(doc);
		const oligo = part.createOligo(vh, 0, 10, '#111111');
		const start = history.revision;

		paintOligoCmd({ oligo, color: '#abcdef' }, history);
		expect(history.revision).toBe(start + 1);
		history.undoOnce();
		expect(history.revision).toBe(start + 2);
		history.redoOnce();
		expect(history.revision).toBe(start + 3);
	});
});
