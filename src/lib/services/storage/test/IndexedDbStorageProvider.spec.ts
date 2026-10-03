import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IndexedDbStorageProvider } from '../providers/IndexedDbStorageProvider';
import type { IndexedDbPersistenceBackend } from '../indexeddb/FoldnanoIndexedDb';
import type { DocumentMetadata } from '../types';
import type { ErrorLogRecord, IndexedDbPluginFilesRecord } from '../indexedDbTypes';

class FakeIndexedDbBackend implements IndexedDbPersistenceBackend {
	documents = new Map<string, object>();
	contexts = new Map<string, object>();
	metadata = new Map<string, DocumentMetadata>();
	migrations = new Map<string, { key: string; version: number; completedAt: number }>();

	async saveDocument(docId: string, snapshot: object): Promise<DocumentMetadata> {
		const now = Date.now();
		const metadata = {
			id: docId,
			name: (snapshot as { name?: string }).name ?? 'Untitled Document',
			lastModified: now,
			lastAutoSaved: now,
		};
		this.documents.set(docId, snapshot);
		this.metadata.set(docId, metadata);
		return metadata;
	}

	async loadDocument(docId: string): Promise<object | null> {
		return this.documents.get(docId) ?? null;
	}

	async getLocalBackups(): Promise<[]> {
		return [];
	}

	async getLastModified(docId: string): Promise<number | null> {
		return this.metadata.get(docId)?.lastModified ?? null;
	}

	async deleteDocument(docId: string): Promise<void> {
		this.documents.delete(docId);
		this.contexts.delete(docId);
		this.metadata.delete(docId);
	}

	async saveContext(docId: string, context: object): Promise<void> {
		this.contexts.set(docId, context);
	}

	async loadContext(docId: string): Promise<object | null> {
		return this.contexts.get(docId) ?? null;
	}

	async getDocumentList(): Promise<DocumentMetadata[]> {
		return [...this.metadata.values()];
	}

	async importLegacyPayload(): Promise<void> {}

	async getMigrationRecord(key: string) {
		return this.migrations.get(key) ?? null;
	}

	async setMigrationRecord(record: {
		key: string;
		version: number;
		completedAt: number;
	}): Promise<void> {
		this.migrations.set(record.key, record);
	}

	plugins = new Map<
		string,
		{ id: string; manifest?: object; sidePanelCode?: string; enabled?: boolean }
	>();

	async savePlugin(record: {
		id: string;
		manifest?: object;
		sidePanelCode?: string;
	}): Promise<void> {
		this.plugins.set(record.id, record);
	}

	async deletePlugin(id: string): Promise<void> {
		this.plugins.delete(id);
	}

	async loadAllPlugins(): Promise<{ id: string; manifest?: object; sidePanelCode?: string }[]> {
		return [...this.plugins.values()];
	}

	async savePluginEditorState(pluginId: string, code: string): Promise<void> {
		const existing = this.plugins.get(pluginId);
		if (existing) {
			this.plugins.set(pluginId, { ...existing, sidePanelCode: code });
		} else {
			this.plugins.set(pluginId, { id: pluginId, sidePanelCode: code });
		}
	}

	async savePluginEnabled(pluginId: string, enabled: boolean): Promise<void> {
		const existing = this.plugins.get(pluginId);
		if (existing) {
			this.plugins.set(pluginId, { ...existing, enabled });
		} else {
			this.plugins.set(pluginId, { id: pluginId, enabled });
		}
	}

	pluginFiles = new Map<string, IndexedDbPluginFilesRecord>();

	async savePluginFiles(record: IndexedDbPluginFilesRecord): Promise<void> {
		this.pluginFiles.set(record.id, record);
	}

	async loadPluginFiles(id: string): Promise<IndexedDbPluginFilesRecord | null> {
		return this.pluginFiles.get(id) ?? null;
	}

	async deletePluginFiles(id: string): Promise<void> {
		this.pluginFiles.delete(id);
	}

	errorLogs = new Map<string, ErrorLogRecord>();

	async addErrorLog(record: ErrorLogRecord): Promise<void> {
		this.errorLogs.set(record.id, record);
	}

	async getRecentErrorLogs(limit = 50): Promise<ErrorLogRecord[]> {
		return [...this.errorLogs.values()].sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
	}

	async clearErrorLogs(): Promise<void> {
		this.errorLogs.clear();
	}
}

describe('IndexedDbStorageProvider', () => {
	let backend: FakeIndexedDbBackend;
	let provider: IndexedDbStorageProvider;

	beforeEach(() => {
		backend = new FakeIndexedDbBackend();
		provider = new IndexedDbStorageProvider(backend);
	});

	it('saves and loads document snapshots through the backend', async () => {
		const snapshot = { id: 'doc-1', name: 'Indexed Design', parts: [] };
		await expect(provider.saveDocument('doc-1', snapshot)).resolves.toBe(true);
		await expect(provider.loadDocument('doc-1')).resolves.toEqual(snapshot);
	});

	it('saves and loads context through the backend', async () => {
		const context = { sequenceContext: { mode: 'RANDOM' } };
		await expect(provider.saveContext('doc-1', context)).resolves.toBe(true);
		await expect(provider.loadContext('doc-1')).resolves.toEqual(context);
	});

	it('returns document list metadata from the backend', async () => {
		await backend.saveDocument('doc-1', { id: 'doc-1', name: 'Indexed Design' });
		await expect(provider.getDocumentList()).resolves.toEqual([
			expect.objectContaining({ id: 'doc-1', name: 'Indexed Design' }),
		]);
	});

	it('returns indexedDB provider info', () => {
		expect(provider.getProviderInfo()).toEqual({
			name: 'IndexedDB',
			type: 'indexedDB',
			description: 'Async browser storage for larger local working copies',
		});
	});

	it('reports unavailable when indexedDB is missing', async () => {
		const original = globalThis.indexedDB;
		vi.stubGlobal('indexedDB', undefined);
		await expect(provider.isAvailable()).resolves.toBe(false);
		vi.stubGlobal('indexedDB', original);
	});
});
