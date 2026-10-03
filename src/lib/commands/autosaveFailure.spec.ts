import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/errorReporting', () => ({ reportError: vi.fn() }));

import { reportError } from '$lib/errorReporting';
import FoldnanoDocument from '$lib/model/document.svelte';
import { StorageManager } from '$lib/services/storage/StorageManager';
import type { StorageProvider } from '$lib/services/storage/StorageProvider';
import { addLatticeVh } from '$lib/model/test/testHelpers';
import { AUTOSAVE_RETRY_DELAY_MS, HistoryStack } from './history.svelte';
import { paintOligoCmd } from './strands';

class FlakyStorageProvider implements StorageProvider {
	saveCalls = 0;
	failing = true;

	async saveDocument(): Promise<boolean> {
		this.saveCalls++;
		return !this.failing;
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
		return { name: 'Flaky', type: 'memory' as const, description: 'Fails until told otherwise' };
	}
	async isAvailable(): Promise<boolean> {
		return true;
	}
}

function setup() {
	const doc = new FoldnanoDocument('doc-1', 'Autosave failure');
	const part = doc.addNewPart('HONEYCOMB');
	const oligo = part.createOligo(addLatticeVh(part, 0, 0), 0, 10, '#111111');
	const provider = new FlakyStorageProvider();
	const storage = new StorageManager('memory');
	storage.registerProvider('memory', provider);
	const onSaved = vi.fn();
	const history = new HistoryStack(doc, storage, undefined, undefined, onSaved);
	paintOligoCmd({ oligo, color: '#abcdef' }, history);
	return { history, provider, onSaved };
}

describe('autosave failure handling', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.mocked(reportError).mockClear();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('shows the failure, notifies once, and retries once shortly after', async () => {
		const { history, provider, onSaved } = setup();

		await history.saveNow();

		expect(history.autoSaveStatus.error).toBeDefined();
		expect(vi.mocked(reportError)).toHaveBeenCalledWith(expect.anything(), 'autosave', {
			notify: true,
		});

		provider.failing = false;
		await vi.advanceTimersByTimeAsync(AUTOSAVE_RETRY_DELAY_MS);

		expect(provider.saveCalls).toBe(2);
		expect(history.autoSaveStatus.error).toBeUndefined();
		expect(history.autoSaveStatus.hasUnsavedChanges).toBe(false);
		expect(onSaved).toHaveBeenCalledOnce();
		history.destroy();
	});

	it('retries only once per failure streak and does not repeat the toast', async () => {
		const { history, provider } = setup();

		await history.saveNow();
		await vi.advanceTimersByTimeAsync(AUTOSAVE_RETRY_DELAY_MS * 5);

		expect(provider.saveCalls).toBe(2);
		expect(history.autoSaveStatus.error).toBeDefined();
		expect(vi.mocked(reportError).mock.calls.map((call) => call[2])).toEqual([
			{ notify: true },
			{ notify: false },
		]);
		history.destroy();
	});

	it('does not retry after destroy', async () => {
		const { history, provider } = setup();

		await history.saveNow();
		history.destroy();
		await vi.advanceTimersByTimeAsync(AUTOSAVE_RETRY_DELAY_MS * 2);

		expect(provider.saveCalls).toBe(1);
	});

	it('records failures from other save paths and clears them on markSaved', () => {
		const { history, onSaved } = setup();

		history.markSaveFailed('Failed to persist the current document locally');
		expect(history.autoSaveStatus.error).toBe('Failed to persist the current document locally');

		history.markSaved();
		expect(history.autoSaveStatus.error).toBeUndefined();
		expect(onSaved).toHaveBeenCalledOnce();
		history.destroy();
	});
});
