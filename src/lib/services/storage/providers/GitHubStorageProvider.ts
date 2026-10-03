/**
 * GitHub-backed storage provider.
 *
 * Standard StorageProvider operations delegate to IndexedDB (working copy).
 * Additional methods: commitDocument(), pullDocument() for GitHub sync.
 */
import type { DocSnapshot } from '$lib/model/document.svelte';
import { migrateDocumentJson } from '$lib/model/documentFormat';
import type { StorageProvider } from '../StorageProvider';
import type {
	DocumentMetadata,
	OverwriteBackupReason,
	ProviderInfo,
	SaveDocumentOptions,
	StorageInfo,
} from '../types';
import {
	GitHubConflictError,
	getFileContent,
	isShaConflict,
	putFileContent,
} from '$lib/services/github/api';
import { foldnanoIndexedDb } from '../indexeddb/FoldnanoIndexedDb';
import { githubMetadataStore } from '../stores/GitHubMetadataStore';
import type { GitHubFileMetadata, GitHubRepoContext } from '../githubTypes';

export type RemoteFileState = 'clean' | 'changed' | 'unknown';

export class GitHubStorageProvider implements StorageProvider {
	private canUseIndexedDb(): boolean {
		return foldnanoIndexedDb.isAvailable();
	}

	private async persistWorkingCopy(
		docId: string,
		snapshot: object,
		options?: SaveDocumentOptions
	): Promise<void> {
		if (!this.canUseIndexedDb()) throw new Error('IndexedDB is not available');
		await foldnanoIndexedDb.saveDocument(docId, snapshot, options);
	}

	// --- Repo context ---

	getRepoContext(): GitHubRepoContext | null {
		return githubMetadataStore.getRepoContext();
	}

	setRepoContext(ctx: GitHubRepoContext): void {
		githubMetadataStore.setRepoContext(ctx);
	}

	clearRepoContext(): void {
		githubMetadataStore.clearRepoContext();
	}

	// --- Per-file SHA/path metadata ---

	getFileMetadata(docId: string): GitHubFileMetadata | null {
		return githubMetadataStore.getFileMetadata(docId);
	}

	setFileMetadata(docId: string, meta: GitHubFileMetadata): Promise<void> {
		return githubMetadataStore.setFileMetadata(docId, meta);
	}

	clearFileMetadata(docId: string): void {
		githubMetadataStore.clearFileMetadata(docId);
	}

	/**
	 * Return the set of GitHub file paths (for a given repo) whose local working copy is
	 * newer than the last GitHub sync — i.e. they have uncommitted local changes.
	 */
	getUncommittedPaths(owner: string, repo: string): Promise<Set<string>> {
		return githubMetadataStore.getUncommittedPaths(owner, repo);
	}

	/**
	 * Find a previously-loaded doc whose GitHub path/owner/repo matches.
	 * Returns the docId, or null if not found.
	 */
	findDocIdByPath(owner: string, repo: string, path: string): string | null {
		return githubMetadataStore.findDocIdByPath(owner, repo, path);
	}

	/** Stamp the stored metadata with a sync timestamp. No-op if no metadata exists. */
	stampSyncTime(docId: string, syncAt: number): Promise<void> {
		return githubMetadataStore.stampSyncTime(docId, syncAt);
	}

	// --- StorageProvider interface ---

	async saveDocument(docId: string, snapshot: object): Promise<boolean> {
		try {
			// Persist the plain snapshot object locally in IndexedDB.
			await this.persistWorkingCopy(docId, snapshot);
			return true;
		} catch (e) {
			console.error('[GitHubStorageProvider] Failed to save document:', e);
			return false;
		}
	}

	/**
	 * Load from the persisted IndexedDB working copy first; if missing, fetch from GitHub.
	 */
	async loadDocument(docId: string): Promise<object | null> {
		if (this.canUseIndexedDb()) {
			try {
				const indexedSnapshot = await foldnanoIndexedDb.loadDocument(docId);
				if (indexedSnapshot) {
					return indexedSnapshot;
				}
			} catch (e) {
				console.error('[GitHubStorageProvider] IndexedDB read error:', e);
			}
		}

		// Fallback: fetch from GitHub
		const meta = this.getFileMetadata(docId);
		if (!meta) return null;

		try {
			const file = await getFileContent(meta.owner, meta.repo, meta.path, meta.branch);
			const content = atob(file.content.replace(/\s/g, ''));
			const snapshot = JSON.parse(content) as object;
			// Cache locally
			await this.persistWorkingCopy(docId, snapshot);
			this.setFileMetadata(docId, { ...meta, sha: file.sha });
			return snapshot;
		} catch (e) {
			console.error('[GitHubStorageProvider] Failed to fetch from GitHub:', e);
			return null;
		}
	}

	async deleteDocument(docId: string): Promise<boolean> {
		try {
			if (this.canUseIndexedDb()) {
				await foldnanoIndexedDb.deleteDocument(docId);
			}
			this.clearFileMetadata(docId);
			return true;
		} catch (e) {
			console.error('[GitHubStorageProvider] Failed to delete document:', e);
			return false;
		}
	}

	async saveContext(docId: string, context: object): Promise<boolean> {
		try {
			if (!this.canUseIndexedDb()) throw new Error('IndexedDB is not available');
			await foldnanoIndexedDb.saveContext(docId, JSON.parse(JSON.stringify(context)) as object);
			return true;
		} catch (e) {
			console.error('[GitHubStorageProvider] Failed to save context:', e);
			return false;
		}
	}

	async loadContext(docId: string): Promise<object | null> {
		if (this.canUseIndexedDb()) {
			try {
				return await foldnanoIndexedDb.loadContext(docId);
			} catch (e) {
				console.error('[GitHubStorageProvider] Failed to load context from IndexedDB:', e);
			}
		}
		return null;
	}

	async getDocumentList(): Promise<DocumentMetadata[]> {
		try {
			return this.canUseIndexedDb() ? await foldnanoIndexedDb.getDocumentList() : [];
		} catch (e) {
			console.error('[GitHubStorageProvider] Failed to load document list:', e);
			return [];
		}
	}

	getProviderInfo(): ProviderInfo {
		return {
			name: 'GitHub',
			type: 'github',
			description: 'Store and version design files in a GitHub repository',
		};
	}

	async isAvailable(): Promise<boolean> {
		return this.getRepoContext() !== null;
	}

	async getStorageInfo(): Promise<StorageInfo> {
		return { used: 0, available: 0, percentage: 0 };
	}

	// --- GitHub-specific methods ---

	/**
	 * Commit the current persisted working copy to GitHub.
	 * Returns the commit SHA on success.
	 */
	async commitDocument(docId: string, message: string, snapshot?: DocSnapshot): Promise<string> {
		const meta = this.getFileMetadata(docId);
		if (!meta) throw new Error('No GitHub file metadata found for this document');

		const indexedSnapshot =
			!snapshot && this.canUseIndexedDb() ? await foldnanoIndexedDb.loadDocument(docId) : null;
		const prettyData = snapshot
			? JSON.stringify(snapshot, null, 2)
			: indexedSnapshot
				? JSON.stringify(indexedSnapshot, null, 2)
				: null;
		if (!prettyData) throw new Error('Document not found in IndexedDB');

		// Encode JSON string as base64 (handles unicode)
		const bytes = new TextEncoder().encode(prettyData);
		let binaryString = '';
		for (const byte of bytes) binaryString += String.fromCharCode(byte);
		const content = btoa(binaryString);

		let response;
		try {
			response = await putFileContent(meta.owner, meta.repo, meta.path, {
				message,
				content,
				// Omit sha for new files (local-only); include it for updates so GitHub can verify no conflict.
				...(meta.sha ? { sha: meta.sha } : {}),
				branch: meta.branch,
			});
		} catch (e) {
			if (isShaConflict(e)) throw new GitHubConflictError();
			throw e;
		}

		// The next commit is checked against this SHA, so it must be stored before reporting success.
		await this.setFileMetadata(docId, { ...meta, sha: response.content.sha });
		return response.commit.sha;
	}

	/**
	 * Whether the GitHub file still matches the tracked SHA. `unknown` (network error, expired
	 * session, ...) must not be read as clean; a commit is still protected by GitHub's own SHA
	 * check, which raises GitHubConflictError.
	 */
	async checkRemoteState(docId: string): Promise<RemoteFileState> {
		const meta = this.getFileMetadata(docId);
		if (!meta) return 'clean';
		try {
			const file = await getFileContent(meta.owner, meta.repo, meta.path, meta.branch);
			return file.sha === meta.sha ? 'clean' : 'changed';
		} catch (e) {
			console.warn('[GitHubStorageProvider] Could not check the GitHub file:', e);
			return 'unknown';
		}
	}

	/**
	 * Fetch the latest version from GitHub and overwrite the IndexedDB working copy. The
	 * replaced copy is kept as a backup labelled `reason`, in the same transaction.
	 */
	async pullDocument(
		docId: string,
		reason: OverwriteBackupReason = 'before_pull'
	): Promise<DocSnapshot> {
		const meta = this.getFileMetadata(docId);
		if (!meta) throw new Error('No GitHub file metadata found for this document');

		const file = await getFileContent(meta.owner, meta.repo, meta.path, meta.branch);
		const content = atob(file.content.replace(/\s/g, ''));
		// Validate before overwriting the working copy, so a file from a newer app is refused intact.
		const snapshot = migrateDocumentJson(JSON.parse(content));

		await this.persistWorkingCopy(docId, snapshot, {
			backup: {
				reason,
				github: { owner: meta.owner, repo: meta.repo, branch: meta.branch, path: meta.path },
			},
		});
		await this.setFileMetadata(docId, { ...meta, sha: file.sha });
		return snapshot;
	}
}

/** Singleton — import this to access GitHub storage from any component. */
export const githubStorageProvider = new GitHubStorageProvider();
