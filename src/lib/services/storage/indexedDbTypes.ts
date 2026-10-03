import type { DocumentMetadata, LocalBackup } from './types';
import type { GitHubFileMetadata, GitHubRepoContext } from './githubTypes';
import type { GitHubLocalOnlyEntry } from './stores/GitHubExplorerStateStore';

export const FOLDNANO_INDEXED_DB_NAME = 'foldnano-db';
export const FOLDNANO_INDEXED_DB_VERSION = 7;

export const FOLDNANO_INDEXED_DB_STORES = {
	documents: 'documents',
	documentSnapshots: 'documentSnapshots',
	documentContexts: 'documentContexts',
	githubRepoContexts: 'githubRepoContexts',
	githubFiles: 'githubFiles',
	localOnlyEntries: 'localOnlyEntries',
	localFolderEntries: 'localFolderEntries',
	migrations: 'migrations',
	errorLogs: 'errorLogs',
	localBackups: 'localBackups',
} as const;

/** A periodic backup is taken on save once the newest backup is at least this old. */
export const LOCAL_BACKUP_INTERVAL_MS = 10 * 60 * 1000;
/** One timeline per document across all backup reasons. Meant to become a user setting. */
export const MAX_LOCAL_BACKUPS_PER_DOC = 5;

export interface IndexedDbDocumentRecord extends DocumentMetadata {
	documentUpdatedAt: number;
	lastLocalPersistAt: number;
	githubPath?: string;
	repoKey?: string;
}

export interface IndexedDbDocumentSnapshotRecord {
	docId: string;
	snapshot: object;
	lastLocalPersistAt: number;
}

export type IndexedDbLocalBackupRecord = LocalBackup;

export interface IndexedDbDocumentContextRecord {
	docId: string;
	context: object;
	updatedAt: number;
}

export interface IndexedDbGitHubRepoContextRecord extends GitHubRepoContext {
	repoKey: string;
}

export interface IndexedDbGitHubFileRecord extends GitHubFileMetadata {
	docId: string;
	repoKey: string;
}

export interface IndexedDbLocalOnlyEntryRecord extends GitHubLocalOnlyEntry {
	repoKey: string;
}

export interface IndexedDbLocalFolderEntryRecord {
	repoKey: string;
	path: string;
}

export interface IndexedDbMigrationRecord {
	key: string;
	version: number;
	completedAt: number;
}

/**
 * Diagnostic error-log entry. Metadata only — never populate with design/document
 * data (see reportError() in errorReporting.ts).
 */
export interface ErrorLogRecord {
	id: string;
	timestamp: number;
	context: string;
	message: string;
	stack?: string;
	severity: 'warning' | 'error';
	appVersion: string;
	commitHash: string;
}

export interface IndexedDbPluginRecord {
	/** Plugin ID — primary key */
	id: string;
	/** Absent for builtin editor-state-only records */
	manifest?: object;
	sidePanelCode?: string;
	/** Persisted enable/disable toggle for builtin plugins */
	enabled?: boolean;
}

/**
 * Cached plugin file assets (entrypoint code/zip, pre-fetched wheels).
 * Keyed by plugin ID; invalidated when manifest.version changes.
 * Local plugins (installed via zip drop) use this table as the sole file source.
 */
export interface IndexedDbPluginFilesRecord {
	/** Plugin ID — primary key */
	id: string;
	/** Cached for the manifest version at time of storage. Any change invalidates the cache. */
	manifestVersion: string;
	/** Text content of a .py entrypoint (mutually exclusive with entrypointZipData) */
	entrypointCode?: string;
	/** Raw bytes of a .zip bundle (mutually exclusive with entrypointCode) */
	entrypointZipData?: Uint8Array;
	/** Pre-fetched .whl files. For remote plugins the url is the absolute fetch URL;
	 *  for local plugins it is the bare filename from the zip. */
	wheels: Array<{ url: string; data: Uint8Array }>;
	cachedAt: number;
}

export function toRepoKey(owner: string, repo: string): string {
	return `${owner}/${repo}`;
}
