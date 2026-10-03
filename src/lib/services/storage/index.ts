/**
 * Storage System - Public API
 *
 * Unified storage interface supporting multiple backends:
 * - IndexedDB (primary, large documents, async)
 * - GitHub (version control, cloud sync)
 * - Custom cloud backends
 */

// Core abstractions
export { StorageManager } from './StorageManager';
export type { StorageProvider } from './StorageProvider';

// Types
export type {
	DocumentMetadata,
	DocumentListMetadata,
	BackupGitHubSource,
	BackupReason,
	LocalBackup,
	OverwriteBackupReason,
	SaveDocumentOptions,
	StorageInfo,
	ProviderInfo,
	StorageProviderType,
} from './types';

// Concrete providers
export { GitHubStorageProvider, githubStorageProvider } from './providers/GitHubStorageProvider';
export { IndexedDbStorageProvider } from './providers/IndexedDbStorageProvider';
export { foldnanoIndexedDb } from './indexeddb/FoldnanoIndexedDb';
export { githubMetadataStore } from './stores/GitHubMetadataStore';
export { githubExplorerStateStore } from './stores/GitHubExplorerStateStore';
export type { GitHubLocalOnlyEntry } from './stores/GitHubExplorerStateStore';
export type { GitHubRepoContext, GitHubFileMetadata } from './githubTypes';
export type {
	IndexedDbDocumentRecord,
	IndexedDbDocumentSnapshotRecord,
	IndexedDbDocumentContextRecord,
	IndexedDbGitHubRepoContextRecord,
	IndexedDbGitHubFileRecord,
	IndexedDbLocalOnlyEntryRecord,
	IndexedDbLocalFolderEntryRecord,
	IndexedDbMigrationRecord,
} from './indexedDbTypes';
