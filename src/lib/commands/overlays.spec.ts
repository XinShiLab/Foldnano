import { describe, expect, it } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import { StorageManager } from '$lib/services/storage/StorageManager';
import type { StorageProvider } from '$lib/services/storage/StorageProvider';
import type { OverlayPlacement } from '$lib/model/Part/Part.svelte';
import { HistoryStack } from './history.svelte';
import { clearOverlayPlacementCmd, setOverlayPlacementCmd } from './overlays';

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

const T = (x: number): OverlayPlacement['transform'] => ({
	position: { x, y: 0, z: 0 },
	quaternion: [0, 0, 0, 1],
});

function setup() {
	const doc = new FoldnanoDocument('d', 'overlay cmd test');
	const part = doc.addNewPart('HONEYCOMB');
	return { part, history: createHistory(doc) };
}

describe('overlay placement commands', () => {
	it('add → undo removes, redo re-adds', () => {
		const { part, history } = setup();
		setOverlayPlacementCmd(history, part, 'i1', '6J6J', T(1), 'Add overlay');
		expect(part.getOverlayPlacement('i1')?.transform.position.x).toBe(1);

		history.undoOnce();
		expect(part.getOverlayPlacement('i1')).toBeUndefined();
		history.redoOnce();
		expect(part.getOverlayPlacement('i1')?.sourceKey).toBe('6J6J');
	});

	it('move (update) → undo restores the prior transform', () => {
		const { part, history } = setup();
		setOverlayPlacementCmd(history, part, 'i1', '6J6J', T(1), 'Add overlay');
		setOverlayPlacementCmd(history, part, 'i1', '6J6J', T(5), 'Move overlay');
		expect(part.getOverlayPlacement('i1')?.transform.position.x).toBe(5);

		history.undoOnce();
		expect(part.getOverlayPlacement('i1')?.transform.position.x).toBe(1);
		history.redoOnce();
		expect(part.getOverlayPlacement('i1')?.transform.position.x).toBe(5);
	});

	it('remove → undo restores the placement', () => {
		const { part, history } = setup();
		setOverlayPlacementCmd(history, part, 'i1', '6J6J', T(1), 'Add overlay');
		clearOverlayPlacementCmd(history, part, 'i1', 'Remove overlay');
		expect(part.getOverlayPlacement('i1')).toBeUndefined();

		history.undoOnce();
		expect(part.getOverlayPlacement('i1')?.transform.position.x).toBe(1);
		history.redoOnce();
		expect(part.getOverlayPlacement('i1')).toBeUndefined();
	});

	it('is a targeted patch — undo leaves unrelated document changes intact', () => {
		const { part, history } = setup();
		setOverlayPlacementCmd(history, part, 'i1', '6J6J', T(1), 'Add overlay');
		// An edit made after the command but outside history.
		part.name = 'renamed-after';

		history.undoOnce(); // undo the overlay add
		expect(part.getOverlayPlacement('i1')).toBeUndefined();
		// A full-document-snapshot undo would have reverted this; a targeted patch must not.
		expect(part.name).toBe('renamed-after');
	});
});
