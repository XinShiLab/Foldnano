import type { StorageProvider } from '../StorageProvider';
import type {
	DocumentMetadata,
	LocalBackup,
	ProviderInfo,
	SaveDocumentOptions,
	StorageInfo,
} from '../types';
import {
	foldnanoIndexedDb,
	type IndexedDbPersistenceBackend,
} from '../indexeddb/FoldnanoIndexedDb';
import { reportError } from '$lib/errorReporting';

export class IndexedDbStorageProvider implements StorageProvider {
	constructor(private backend: IndexedDbPersistenceBackend = foldnanoIndexedDb) {}

	async saveDocument(
		docId: string,
		snapshot: object,
		options?: SaveDocumentOptions
	): Promise<boolean> {
		try {
			await this.backend.saveDocument(docId, snapshot, options);
			return true;
		} catch (e) {
			reportError(e, 'storage:indexeddb:save-document', { notify: false });
			return false;
		}
	}

	async loadDocument(docId: string): Promise<object | null> {
		try {
			return await this.backend.loadDocument(docId);
		} catch (e) {
			reportError(e, 'storage:indexeddb:load-document', { notify: false });
			return null;
		}
	}

	async getLastModified(docId: string): Promise<number | null> {
		try {
			return await this.backend.getLastModified(docId);
		} catch (e) {
			reportError(e, 'storage:indexeddb:last-modified', { notify: false });
			return null;
		}
	}

	async getLocalBackups(docId: string): Promise<LocalBackup[]> {
		try {
			return await this.backend.getLocalBackups(docId);
		} catch (e) {
			reportError(e, 'storage:indexeddb:load-backups', { notify: false });
			return [];
		}
	}

	async deleteDocument(docId: string): Promise<boolean> {
		try {
			await this.backend.deleteDocument(docId);
			return true;
		} catch (e) {
			reportError(e, 'storage:indexeddb:delete-document', { notify: false });
			return false;
		}
	}

	async saveContext(docId: string, context: object): Promise<boolean> {
		try {
			await this.backend.saveContext(docId, context);
			return true;
		} catch (e) {
			reportError(e, 'storage:indexeddb:save-context', { notify: false });
			return false;
		}
	}

	async loadContext(docId: string): Promise<object | null> {
		try {
			return await this.backend.loadContext(docId);
		} catch (e) {
			reportError(e, 'storage:indexeddb:load-context', { notify: false });
			return null;
		}
	}

	async getDocumentList(): Promise<DocumentMetadata[]> {
		try {
			return await this.backend.getDocumentList();
		} catch (e) {
			reportError(e, 'storage:indexeddb:get-document-list', { notify: false });
			return [];
		}
	}

	getProviderInfo(): ProviderInfo {
		return {
			name: 'IndexedDB',
			type: 'indexedDB',
			description: 'Async browser storage for larger local working copies',
		};
	}

	async isAvailable(): Promise<boolean> {
		return typeof indexedDB !== 'undefined';
	}

	async getStorageInfo(): Promise<StorageInfo> {
		return { used: 0, available: 0, percentage: 0 };
	}
}
