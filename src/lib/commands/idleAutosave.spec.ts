import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import { StorageManager } from '$lib/services/storage/StorageManager';
import type { StorageProvider } from '$lib/services/storage/StorageProvider';
import { addLatticeVh } from '$lib/model/test/testHelpers';
import { HistoryStack } from './history.svelte';
import { paintOligoCmd } from './strands';

class CountingStorageProvider implements StorageProvider {
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
		return { name: 'Counting', type: 'memory' as const, description: 'Counts saves' };
	}
	async isAvailable(): Promise<boolean> {
		return true;
	}
}

const IDLE_MS = 2000;

function setup(isBusy?: () => boolean) {
	const doc = new FoldnanoDocument('doc-idle', 'Idle autosave');
	const part = doc.addNewPart('HONEYCOMB');
	const oligo = part.createOligo(addLatticeVh(part, 0, 0), 0, 10, '#000000');
	const provider = new CountingStorageProvider();
	const storage = new StorageManager('memory');
	storage.registerProvider('memory', provider);
	const history = new HistoryStack(doc, storage, undefined, undefined, undefined, isBusy);
	history.setAutoSaveConfig({
		editCountThreshold: 1000,
		timeIntervalMs: 3_600_000,
		idleDelayMs: IDLE_MS,
	});
	let n = 0;
	const paint = () => paintOligoCmd({ oligo, color: `#${String(++n).padStart(6, '0')}` }, history);
	return { history, provider, paint };
}

describe('idle autosave', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('saves once after the edits stop, not per edit', async () => {
		const { history, provider, paint } = setup();
		paint();
		await vi.advanceTimersByTimeAsync(1000);
		paint();
		await vi.advanceTimersByTimeAsync(1500);
		expect(provider.saveCalls).toBe(0);

		await vi.advanceTimersByTimeAsync(1000);
		expect(provider.saveCalls).toBe(1);
		expect(history.autoSaveStatus.hasUnsavedChanges).toBe(false);

		await vi.advanceTimersByTimeAsync(10_000);
		expect(provider.saveCalls).toBe(1);
		history.destroy();
	});

	it('waits while input keeps arriving', async () => {
		const { history, provider, paint } = setup();
		paint();
		for (let t = 0; t < 5; t++) {
			await vi.advanceTimersByTimeAsync(1000);
			history.noteActivity();
		}
		expect(provider.saveCalls).toBe(0);
		await vi.advanceTimersByTimeAsync(IDLE_MS + 100);
		expect(provider.saveCalls).toBe(1);
		history.destroy();
	});

	it('waits while the editor reports itself busy', async () => {
		let busy = true;
		const { history, provider, paint } = setup(() => busy);
		paint();
		await vi.advanceTimersByTimeAsync(IDLE_MS * 3);
		expect(provider.saveCalls).toBe(0);

		busy = false;
		await vi.advanceTimersByTimeAsync(IDLE_MS + 100);
		expect(provider.saveCalls).toBe(1);
		history.destroy();
	});

	it('does nothing when off, after markSaved, or after destroy', async () => {
		const off = setup();
		off.history.setAutoSaveConfig({ idleDelayMs: 0 });
		off.paint();
		await vi.advanceTimersByTimeAsync(IDLE_MS * 2);
		expect(off.provider.saveCalls).toBe(0);
		off.history.destroy();

		const marked = setup();
		marked.paint();
		marked.history.markSaved();
		await vi.advanceTimersByTimeAsync(IDLE_MS * 2);
		expect(marked.provider.saveCalls).toBe(0);
		marked.history.destroy();

		const destroyed = setup();
		destroyed.paint();
		destroyed.history.destroy();
		await vi.advanceTimersByTimeAsync(IDLE_MS * 2);
		expect(destroyed.provider.saveCalls).toBe(0);
	});
});
