import type { StorageProvider } from './StorageProvider';
import type {
	DocumentMetadata,
	LocalBackup,
	SaveDocumentOptions,
	StorageProviderType,
	StorageInfo,
} from './types';
import { reportError } from '$lib/errorReporting';

/**
 * StorageManager - Facade for managing multiple storage providers
 *
 * Provides a unified interface for saving/loading documents across different
 * storage backends (IndexedDB, GitHub, cloud, etc.).
 *
 * Features:
 * - Switch between providers at runtime
 * - Save to multiple providers simultaneously (backup strategy)
 * - Sync documents between providers
 *
 * Usage:
 * ```typescript
 * const manager = new StorageManager('indexedDB');
 * manager.registerProvider('indexedDB', new IndexedDbStorageProvider());
 * await manager.saveDocument(docId, snapshot);
 * ```
 */
export class StorageManager {
	private providers: Map<StorageProviderType, StorageProvider>;
	private primaryProvider: StorageProviderType;

	constructor(primaryProvider: StorageProviderType = 'indexedDB') {
		this.providers = new Map();
		this.primaryProvider = primaryProvider;
	}

	/**
	 * Register a storage provider
	 */
	registerProvider(type: StorageProviderType, provider: StorageProvider): void {
		this.providers.set(type, provider);
	}

	/**
	 * Set which provider to use as primary
	 */
	setPrimaryProvider(type: StorageProviderType): void {
		if (!this.providers.has(type)) {
			throw new Error(`Provider ${type} not registered`);
		}
		this.primaryProvider = type;
	}

	/**
	 * Get the current primary provider
	 */
	getPrimaryProvider(): StorageProviderType {
		return this.primaryProvider;
	}

	/**
	 * Get a specific provider instance
	 */
	getProvider(type: StorageProviderType): StorageProvider | undefined {
		return this.providers.get(type);
	}

	/**
	 * Get all registered provider types
	 */
	getRegisteredProviders(): StorageProviderType[] {
		return Array.from(this.providers.keys());
	}

	/**
	 * Save document using primary provider
	 */
	async saveDocument(
		docId: string,
		snapshot: object,
		options?: SaveDocumentOptions
	): Promise<boolean> {
		const provider = this.providers.get(this.primaryProvider);
		if (!provider) {
			reportError(new Error(`Primary provider ${this.primaryProvider} not found`), 'storage:save', {
				notify: false,
			});
			return false;
		}
		try {
			return await provider.saveDocument(docId, snapshot, options);
		} catch (e) {
			reportError(e, 'storage:save', { notify: false });
			return false;
		}
	}

	/**
	 * The stored save time of a document's snapshot; null when unknown or unsupported
	 */
	async getLastModified(docId: string): Promise<number | null> {
		const provider = this.providers.get(this.primaryProvider);
		if (!provider?.getLastModified) return null;
		try {
			return await provider.getLastModified(docId);
		} catch (e) {
			reportError(e, 'storage:last-modified', { notify: false });
			return null;
		}
	}

	/**
	 * Earlier generations of a document from the primary provider, newest first
	 */
	async getLocalBackups(docId: string): Promise<LocalBackup[]> {
		const provider = this.providers.get(this.primaryProvider);
		if (!provider?.getLocalBackups) return [];
		try {
			return await provider.getLocalBackups(docId);
		} catch (e) {
			reportError(e, 'storage:load-backups', { notify: false });
			return [];
		}
	}

	/**
	 * Load document from primary provider
	 */
	async loadDocument(docId: string): Promise<object | null> {
		const provider = this.providers.get(this.primaryProvider);
		if (!provider) {
			reportError(new Error(`Primary provider ${this.primaryProvider} not found`), 'storage:load', {
				notify: false,
			});
			return null;
		}
		try {
			return await provider.loadDocument(docId);
		} catch (e) {
			reportError(e, 'storage:load', { notify: false });
			return null;
		}
	}

	/**
	 * Delete document from primary provider
	 */
	async deleteDocument(docId: string): Promise<boolean> {
		const provider = this.providers.get(this.primaryProvider);
		if (!provider) return false;
		try {
			return await provider.deleteDocument(docId);
		} catch (e) {
			reportError(e, 'storage:delete', { notify: false });
			return false;
		}
	}

	/**
	 * Save context using primary provider
	 */
	async saveContext(docId: string, context: object): Promise<boolean> {
		const provider = this.providers.get(this.primaryProvider);
		if (!provider) return false;
		try {
			return await provider.saveContext(docId, context);
		} catch (e) {
			reportError(e, 'storage:save-context', { notify: false });
			return false;
		}
	}

	/**
	 * Load context from primary provider
	 */
	async loadContext(docId: string): Promise<object | null> {
		const provider = this.providers.get(this.primaryProvider);
		if (!provider) return null;
		try {
			return await provider.loadContext(docId);
		} catch (e) {
			reportError(e, 'storage:load-context', { notify: false });
			return null;
		}
	}

	/**
	 * Get document list from primary provider
	 */
	async getDocumentList(): Promise<DocumentMetadata[]> {
		const provider = this.providers.get(this.primaryProvider);
		if (!provider) return [];
		try {
			return await provider.getDocumentList();
		} catch (e) {
			reportError(e, 'storage:get-document-list', { notify: false });
			return [];
		}
	}

	/**
	 * Get storage info from primary provider
	 */
	async getStorageInfo(): Promise<StorageInfo> {
		const provider = this.providers.get(this.primaryProvider);
		if (!provider || !provider.getStorageInfo) {
			return { used: 0, available: 0, percentage: 0 };
		}
		try {
			return await provider.getStorageInfo();
		} catch (e) {
			reportError(e, 'storage:get-storage-info', { notify: false });
			return { used: 0, available: 0, percentage: 0 };
		}
	}

	/**
	 * Sync document from primary provider to another provider
	 */
	async syncToProvider(docId: string, targetProvider: StorageProviderType): Promise<boolean> {
		const source = this.providers.get(this.primaryProvider);
		const target = this.providers.get(targetProvider);

		if (!source || !target) {
			reportError(new Error('Source or target provider not found'), 'storage:sync', {
				notify: false,
			});
			return false;
		}

		try {
			const doc = await source.loadDocument(docId);
			const context = await source.loadContext(docId);

			if (doc) {
				await target.saveDocument(docId, doc);
				if (context) await target.saveContext(docId, context);
				return true;
			}
			return false;
		} catch (e) {
			reportError(e, 'storage:sync', { notify: false });
			return false;
		}
	}

	/**
	 * Save document to multiple providers simultaneously (backup strategy)
	 */
	async saveToMultiple(
		docId: string,
		snapshot: object,
		providerTypes: StorageProviderType[]
	): Promise<Map<StorageProviderType, boolean>> {
		const results = new Map<StorageProviderType, boolean>();

		const savePromises = providerTypes.map(async (type) => {
			const provider = this.providers.get(type);
			if (provider) {
				try {
					const success = await provider.saveDocument(docId, snapshot);
					results.set(type, success);
				} catch (e) {
					reportError(e, `storage:save-to-${type}`, { notify: false });
					results.set(type, false);
				}
			} else {
				results.set(type, false);
			}
		});

		await Promise.all(savePromises);
		return results;
	}

	/**
	 * Check if primary provider is available
	 */
	async isAvailable(): Promise<boolean> {
		const provider = this.providers.get(this.primaryProvider);
		if (!provider) return false;
		return provider.isAvailable();
	}

	/**
	 * Clear all data from primary provider
	 */
	async clearAll(): Promise<boolean> {
		const provider = this.providers.get(this.primaryProvider);
		if (!provider || !provider.clearAll) return false;
		return provider.clearAll();
	}
}
