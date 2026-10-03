import type {
	DocumentMetadata,
	LocalBackup,
	SaveDocumentOptions,
	StorageInfo,
	ProviderInfo,
} from './types';

/**
 * Abstract interface for storage providers
 *
 * All storage providers (localStorage, IndexedDB, GitHub, cloud, etc.)
 * must implement this interface to be used with the StorageManager.
 *
 * Methods are async to support both sync (localStorage) and async (cloud) providers.
 */
export interface StorageProvider {
	/**
	 * Save document snapshot to storage
	 */
	saveDocument(docId: string, snapshot: object, options?: SaveDocumentOptions): Promise<boolean>;

	/**
	 * Load document snapshot from storage
	 */
	loadDocument(docId: string): Promise<object | null>;

	/**
	 * Delete document and its associated data
	 */
	deleteDocument(docId: string): Promise<boolean>;

	/**
	 * Save editor context for a specific document
	 */
	saveContext(docId: string, context: object): Promise<boolean>;

	/**
	 * Load editor context for a specific document
	 */
	loadContext(docId: string): Promise<object | null>;

	/**
	 * Get list of all saved documents with metadata
	 */
	getDocumentList(): Promise<DocumentMetadata[]>;

	/**
	 * Get information about this provider
	 */
	getProviderInfo(): ProviderInfo;

	/**
	 * Check if this provider is available/functional
	 */
	isAvailable(): Promise<boolean>;

	/**
	 * When the stored snapshot was saved, exactly as recorded (optional)
	 */
	getLastModified?(docId: string): Promise<number | null>;

	/**
	 * Earlier generations of a document, newest first (optional)
	 */
	getLocalBackups?(docId: string): Promise<LocalBackup[]>;

	/**
	 * Get storage usage information (optional, may not apply to all providers)
	 */
	getStorageInfo?(): Promise<StorageInfo>;

	/**
	 * Clear all data managed by this provider (optional)
	 */
	clearAll?(): Promise<boolean>;
}
