import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/services/storage/indexeddb/FoldnanoIndexedDb', async (importOriginal) => {
	const actual =
		await importOriginal<typeof import('$lib/services/storage/indexeddb/FoldnanoIndexedDb')>();
	return {
		...actual,
		foldnanoIndexedDb: {
			loadAllPlugins: vi.fn().mockResolvedValue([]),
			saveInstalledPlugin: vi.fn().mockResolvedValue(undefined),
		},
	};
});

import { EditorViewContext } from './EditorViewContext.svelte';
import { StorageManager } from '$lib/services/storage/StorageManager';
import type { StorageProvider } from '$lib/services/storage/StorageProvider';
import FoldnanoDocument from '$lib/model/document.svelte';
import { addLatticeVh } from '$lib/model/test/testHelpers';
import type { PluginManifest } from '$lib/plugin/types';

class MockStorageProvider implements StorageProvider {
	private contexts = new Map<string, object>();

	async saveDocument(): Promise<boolean> {
		return true;
	}

	async loadDocument(): Promise<object | null> {
		return null;
	}

	async deleteDocument(): Promise<boolean> {
		return true;
	}

	async saveContext(docId: string, context: object): Promise<boolean> {
		this.contexts.set(docId, context);
		return true;
	}

	async loadContext(docId: string): Promise<object | null> {
		return this.contexts.get(docId) ?? null;
	}

	async getDocumentList() {
		return [];
	}

	getProviderInfo() {
		return { name: 'Mock', type: 'memory' as const, description: 'Mock storage provider' };
	}

	async isAvailable(): Promise<boolean> {
		return true;
	}
}

describe('EditorViewContext', () => {
	it('keeps the UI facade aligned with the document session after document replacement and reset', () => {
		const editorViewContext = new EditorViewContext();
		const replacement = new FoldnanoDocument('doc-shared-session', 'Shared Session');

		editorViewContext.session.replaceCurrentDocumentForTesting(replacement);

		expect(editorViewContext.currentDoc).toBe(editorViewContext.session.currentDoc);
		expect(editorViewContext.currentDoc.id).toBe('doc-shared-session');

		editorViewContext.session.resetToBlankDocument();

		expect(editorViewContext.currentDoc).toBe(editorViewContext.session.currentDoc);
		expect(editorViewContext.currentDoc.id).not.toBe('doc-shared-session');
		expect(editorViewContext.currentDoc.parts).toHaveLength(0);
	});

	it('persists collapsed region ids in editor context storage', async () => {
		const mockProvider = new MockStorageProvider();
		const storage = new StorageManager('memory');
		storage.registerProvider('memory', mockProvider);

		const editorViewContext = new EditorViewContext();
		editorViewContext.session.replaceStorageManagerForTesting(storage);
		editorViewContext.session.replaceCurrentDocumentForTesting(
			new FoldnanoDocument('doc-collapse-test', 'Collapse Test')
		);
		editorViewContext.strandViewContext.collapsedRegionIds = ['region-a', 'region-b'];

		await editorViewContext.saveContextToLocalStorage();

		editorViewContext.strandViewContext.collapsedRegionIds = [];
		await editorViewContext.loadContextFromLocalStorage();

		expect(editorViewContext.strandViewContext.collapsedRegionIds).toEqual([
			'region-a',
			'region-b',
		]);
	});

	it('persists active cross-section region in editor context storage', async () => {
		const mockProvider = new MockStorageProvider();
		const storage = new StorageManager('memory');
		storage.registerProvider('memory', mockProvider);

		const editorViewContext = new EditorViewContext();
		editorViewContext.session.replaceStorageManagerForTesting(storage);
		editorViewContext.session.replaceCurrentDocumentForTesting(
			new FoldnanoDocument('doc-cs-region-test', 'CS Region Test')
		);
		editorViewContext.strandViewContext.activeCsRegionId = 'region-a';
		editorViewContext.strandViewContext.csCursorIdx = 17;

		await editorViewContext.saveContextToLocalStorage();

		editorViewContext.strandViewContext.activeCsRegionId = null;
		editorViewContext.strandViewContext.csCursorIdx = 0;
		await editorViewContext.loadContextFromLocalStorage();

		expect(editorViewContext.strandViewContext.activeCsRegionId).toBe('region-a');
		expect(editorViewContext.strandViewContext.csCursorIdx).toBe(17);
	});

	it('clears plane-viewer selections when the active region changes', () => {
		const editorViewContext = new EditorViewContext();
		const doc = new FoldnanoDocument('doc-region-selection', 'Region Selection');
		const part = doc.addNewPart('HONEYCOMB');
		const vh = addLatticeVh(part, 0, 0);
		const oligo = part.createOligo(vh, 0, 10, '#ff0000');
		const segment = Array.from(oligo.segments)[0];

		editorViewContext.session.replaceCurrentDocumentForTesting(doc);

		editorViewContext.strandViewContext.selected.add([segment.fivePrime, segment.threePrime]);
		editorViewContext.setSelectedFreeformVhs([1, 2]);
		editorViewContext.setSelectedLatticeVhs([3, 4]);
		editorViewContext.setActiveRegion('region-a');

		expect([...editorViewContext.strandViewContext.selected.ends]).toEqual([]);
		expect([...editorViewContext.selectedFreeformVhIndices]).toEqual([]);
		expect([...editorViewContext.selectedLatticeVhIndices]).toEqual([]);

		editorViewContext.strandViewContext.selected.add([segment.fivePrime, segment.threePrime]);
		editorViewContext.setSelectedFreeformVhs([5]);
		editorViewContext.setSelectedLatticeVhs([6]);
		editorViewContext.setActiveRegion('region-a');

		expect([...editorViewContext.strandViewContext.selected.ends]).toEqual([
			segment.fivePrime,
			segment.threePrime,
		]);
		expect([...editorViewContext.selectedFreeformVhIndices]).toEqual([5]);
		expect([...editorViewContext.selectedLatticeVhIndices]).toEqual([6]);

		editorViewContext.setActiveRegion('region-b');

		expect([...editorViewContext.strandViewContext.selected.ends]).toEqual([]);
		expect([...editorViewContext.selectedFreeformVhIndices]).toEqual([]);
		expect([...editorViewContext.selectedLatticeVhIndices]).toEqual([]);
	});

	it('wires the plugin registry busy check to the real plugin coordinator', async () => {
		const editorViewContext = new EditorViewContext();
		await editorViewContext.pluginRegistry.ready;

		const manifest: PluginManifest = {
			schemaVersion: 1,
			id: 'wiring-test-plugin',
			name: 'Wiring Test Plugin',
			version: '1.0.0',
			format: 'cadnano_json',
			applyStrategy: 'previewOnly',
			entrypoint: 'def run(ctx): pass',
		};
		await editorViewContext.pluginRegistry.registerNew(manifest, null);
		editorViewContext.pluginCoordinator.updatePlugin('wiring-test-plugin', { status: 'running' });

		await expect(
			editorViewContext.pluginRegistry.replaceConfirmed({ ...manifest, version: '2.0.0' }, null)
		).rejects.toThrow(/currently running/);
	});

	it('wires the plugin install gate to the real plugin registry', async () => {
		const editorViewContext = new EditorViewContext();
		await editorViewContext.pluginRegistry.ready;

		const manifest: PluginManifest = {
			schemaVersion: 1,
			id: 'install-gate-wiring-test',
			name: 'Install Gate Wiring Test',
			version: '1.0.0',
			format: 'cadnano_json',
			applyStrategy: 'previewOnly',
			entrypoint: 'def run(ctx): pass',
		};

		const outcome = await editorViewContext.pluginInstallGate.requestInstall(async () => ({
			status: 'ready',
			manifest,
			files: null,
		}));

		expect(outcome).toEqual({ status: 'installed', manifest });
		expect(editorViewContext.pluginRegistry.get('install-gate-wiring-test')?.manifest.version).toBe(
			'1.0.0'
		);
	});

	describe('owned plugin editors', () => {
		const owned = (id: string): PluginManifest => ({
			schemaVersion: 2,
			id,
			name: id,
			version: '1.0.0',
			format: 'foldnano_mini',
			applyStrategy: 'replayMutationLog',
		});

		it('keeps several editors open at once', () => {
			const editorViewContext = new EditorViewContext();
			editorViewContext.openPluginEditor('local.aaaaaaaa');
			editorViewContext.openPluginEditor('local.bbbbbbbb');

			expect([...editorViewContext.pluginEditorIds]).toEqual(['local.aaaaaaaa', 'local.bbbbbbbb']);
			expect(editorViewContext.sidePanelTab).toBe('plugin:local.bbbbbbbb');

			editorViewContext.poppedOutPluginPanels.add('local.bbbbbbbb');
			editorViewContext.closePluginEditor('local.bbbbbbbb');
			expect([...editorViewContext.pluginEditorIds]).toEqual(['local.aaaaaaaa']);
			expect(editorViewContext.poppedOutPluginPanels.has('local.bbbbbbbb')).toBe(false);
			expect(editorViewContext.sidePanelTab).toBe('PLUGIN');
		});

		it('reopens the editor of every owned plugin with a draft after a reload', async () => {
			const { foldnanoIndexedDb } =
				await import('$lib/services/storage/indexeddb/FoldnanoIndexedDb');
			const authoring = { source: 'scriptLab' as const };
			vi.mocked(foldnanoIndexedDb.loadAllPlugins).mockResolvedValueOnce([
				{ id: 'local.aaaaaaaa', manifest: owned('local.aaaaaaaa'), authoring, draftCode: 'a' },
				{ id: 'local.bbbbbbbb', manifest: owned('local.bbbbbbbb'), authoring },
				{ id: 'local.cccccccc', manifest: owned('local.cccccccc'), authoring, draftCode: 'c' },
			]);
			const editorViewContext = new EditorViewContext();
			await editorViewContext.pluginRegistry.ready;
			await Promise.resolve();

			expect([...editorViewContext.pluginEditorIds]).toEqual(['local.aaaaaaaa', 'local.cccccccc']);
		});
	});
});
