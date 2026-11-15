import { describe, expect, it } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import { StorageManager } from '$lib/services/storage/StorageManager';
import type { StorageProvider } from '$lib/services/storage/StorageProvider';
import { addLatticeVh } from '$lib/model/test/testHelpers';
import { HistoryStack } from './history.svelte';
import { canonicalSnapshot, firstDifference } from './historyVerification';
import { oligoRef } from './historyChanges';
import { fillSequenceToOligoCmd, paintOligoCmd } from './strands';
import { createTestHistory } from './test/undoRoundTrip';

function scene() {
	const doc = new FoldnanoDocument('doc', 'rollback');
	const part = doc.addNewPart('HONEYCOMB');
	const vh0 = addLatticeVh(part, 0, 0);
	const vh1 = addLatticeVh(part, 1, 0);
	const a = part.createOligo(vh0, 0, 20, '#111111');
	const b = part.createOligo(vh1, 0, 20, '#222222');
	return { doc, part, vh0, vh1, a, b, history: createTestHistory(doc) };
}

/** `tx()` itself throws a "Rollback … left the document changed" error in tests when the
 * recorder-based rollback misses something, so these also assert the original error survives. */
function expectRolledBack(doc: FoldnanoDocument, history: HistoryStack, run: () => void): void {
	const before = canonicalSnapshot(doc.snapshot());
	expect(run).toThrow('boom');
	expect(firstDifference(canonicalSnapshot(doc.snapshot()), before)).toBeNull();
	expect(history.numberOfUndos).toBe(0);
}

describe('tx() rollback without a document snapshot', () => {
	it('restores a scope that was still open when the command threw', () => {
		const { doc, part, vh0, a, history } = scene();
		expectRolledBack(doc, history, () =>
			history.tx('Remove then fail', (rec) => {
				rec.capturePartScope(part, { oligoIds: [a.id], vhIndices: [vh0.index] });
				part.removeOligo(a);
				throw new Error('boom');
			})
		);
		expect(part.oligos.size).toBe(2);
	});

	it('restores scopes committed before a later step threw', () => {
		const { doc, part, vh0, vh1, a, b, history } = scene();
		expectRolledBack(doc, history, () =>
			history.tx('Two removals, second fails', (rec) => {
				const first = rec.capturePartScope(part, { oligoIds: [a.id], vhIndices: [vh0.index] });
				part.removeOligo(a);
				first.commit();
				rec.capturePartScope(part, { oligoIds: [b.id], vhIndices: [vh1.index] });
				part.removeOligo(b);
				throw new Error('boom');
			})
		);
	});

	it('restores recorded fields', () => {
		const { doc, a, history } = scene();
		expectRolledBack(doc, history, () =>
			history.tx('Paint then fail', (rec) => {
				rec.field(oligoRef(a), 'color', a.color, '#abcdef');
				a.color = '#abcdef';
				throw new Error('boom');
			})
		);
		expect(a.color).toBe('#111111');
	});

	it('restores slots and oligo fields captured before a mutation that throws midway', () => {
		const { doc, a, history } = scene();
		const fill = a.fillSequence.bind(a);
		a.fillSequence = (...args: Parameters<typeof fill>) => {
			fill(...args);
			throw new Error('boom');
		};
		expectRolledBack(doc, history, () =>
			fillSequenceToOligoCmd({ oligo: a, sequence: 'ACGT'.repeat(6) }, history)
		);
	});

	it('still records and undoes a normal targeted edit', () => {
		const { a, history } = scene();
		paintOligoCmd({ oligo: a, color: '#abcdef' }, history);
		expect(history.numberOfUndos).toBe(1);
		history.undoOnce();
		expect(a.color).toBe('#111111');
	});
});

class SlowStorageProvider implements StorageProvider {
	saveCalls = 0;
	#release: ((ok: boolean) => void)[] = [];

	saveDocument(): Promise<boolean> {
		this.saveCalls++;
		return new Promise((resolve) => this.#release.push(resolve));
	}
	finishNext(): void {
		this.#release.shift()?.(true);
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
		return { name: 'Slow', type: 'memory' as const, description: 'Resolves when told to' };
	}
	async isAvailable(): Promise<boolean> {
		return true;
	}
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('autosave while a save is pending', () => {
	function setup() {
		const doc = new FoldnanoDocument('doc-1', 'Autosave guard');
		const part = doc.addNewPart('HONEYCOMB');
		const oligo = part.createOligo(addLatticeVh(part, 0, 0), 0, 10, '#000000');
		const provider = new SlowStorageProvider();
		const storage = new StorageManager('memory');
		storage.registerProvider('memory', provider);
		const history = new HistoryStack(doc, storage);
		history.setAutoSaveConfig({ editCountThreshold: 3, timeIntervalMs: 3_600_000 });
		const paint = (n: number) =>
			paintOligoCmd({ oligo, color: `#${String(n).padStart(6, '0')}` }, history);
		return { history, provider, paint };
	}

	it('starts one write, not one per edit, and keeps later edits counted as unsaved', async () => {
		const { history, provider, paint } = setup();
		for (let n = 1; n <= 5; n++) paint(n);
		expect(provider.saveCalls).toBe(1);

		provider.finishNext();
		await settle();
		// Edits 4 and 5 were made after the snapshot was taken.
		expect(history.autoSaveStatus.editsSinceLastSave).toBe(2);
		expect(provider.saveCalls).toBe(1);

		paint(6);
		expect(provider.saveCalls).toBe(2);
		provider.finishNext();
		await settle();
		expect(history.autoSaveStatus.hasUnsavedChanges).toBe(false);
		history.destroy();
	});

	it('runs a manual save after the pending one so it holds the latest edits', async () => {
		const { history, provider, paint } = setup();
		for (let n = 1; n <= 4; n++) paint(n);
		const manual = history.saveNow();
		expect(provider.saveCalls).toBe(1);

		provider.finishNext();
		await settle();
		expect(provider.saveCalls).toBe(2);
		provider.finishNext();
		expect((await manual).success).toBe(true);
		expect(history.autoSaveStatus.hasUnsavedChanges).toBe(false);
		history.destroy();
	});
});
