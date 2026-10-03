/**
 * Shared types for the storage system
 */

export interface DocumentMetadata {
	id: string;
	name: string;
	lastModified: number;
	lastAutoSaved: number;
}

/** Why a backup was kept: on a timer while editing, or right before the copy was replaced. */
export type BackupReason =
	| 'periodic'
	| 'before_pull'
	| 'before_accept_remote'
	| 'before_branch_reload'
	| 'before_conflict_resolve'
	| 'before_discard'
	| 'before_restore';

export type OverwriteBackupReason = Exclude<BackupReason, 'periodic'>;

/** The GitHub file a backed-up version belonged to; display only. */
export interface BackupGitHubSource {
	owner: string;
	repo: string;
	branch: string;
	path: string;
}

/**
 * An earlier version of a document. All reasons share one timeline per document, capped at
 * MAX_LOCAL_BACKUPS_PER_DOC.
 */
export interface LocalBackup {
	id: string;
	docId: string;
	/** When the backup was taken, i.e. when this version was replaced. */
	createdAt: number;
	reason: BackupReason;
	github?: BackupGitHubSource;
	snapshot: object;
}

export interface SaveDocumentOptions {
	/**
	 * This write replaces the user's copy (pull, restore, ...): always keep the replaced
	 * version as a backup, in the same transaction, labelled with the reason.
	 */
	backup?: { reason: OverwriteBackupReason; github?: BackupGitHubSource };
}

export interface DocumentListMetadata {
	documents: DocumentMetadata[];
}

export interface StorageInfo {
	used: number;
	available: number;
	percentage: number;
}

export interface ProviderInfo {
	name: string;
	type: StorageProviderType;
	description: string;
}

export type StorageProviderType = 'indexedDB' | 'github' | 'cloud' | 'memory';
