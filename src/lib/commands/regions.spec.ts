import { describe, expect, it } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import { addLatticeVh } from '$lib/model/test/testHelpers';
import { StorageManager } from '$lib/services/storage/StorageManager';
import type { StorageProvider } from '$lib/services/storage/StorageProvider';
import { HistoryStack } from './history.svelte';
import { changeRegionLengthCmd } from './regions';

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

function createHistory(doc: FoldnanoDocument) {
	const storage = new StorageManager('memory');
	storage.registerProvider('memory', new MockStorageProvider());
	return new HistoryStack(doc, storage);
}

describe('changeRegionLengthCmd', () => {
	it('extends and restores region length through undo/redo', () => {
		const doc = new FoldnanoDocument('doc-1', 'Region length command test');
		const part = doc.addNewPart('HONEYCOMB');
		const initialRegion = part.getDefaultRegion();
		const vh = addLatticeVh(part, 0, 0);
		const history = createHistory(doc);
		const vhIndex = vh.index;

		const initialLength = initialRegion.maxBase;
		changeRegionLengthCmd(history, initialRegion, initialRegion.step, 'Extend region length');

		expect(doc.parts[0]?.getDefaultRegion().maxBase).toBe(initialLength + initialRegion.step);
		expect(vh.length).toBe(initialLength + initialRegion.step);

		history.undoOnce();
		expect(doc.parts[0]?.getDefaultRegion().maxBase).toBe(initialLength);
		expect(doc.parts[0]?.getVhByIndex(vhIndex)?.length).toBe(initialLength);

		history.redoOnce();
		expect(doc.parts[0]?.getDefaultRegion().maxBase).toBe(initialLength + initialRegion.step);
		expect(doc.parts[0]?.getVhByIndex(vhIndex)?.length).toBe(initialLength + initialRegion.step);
	});
});
