import { createContext } from 'svelte';

import FoldnanoDocument, { type DocSnapshot } from '$lib/model/document.svelte';
import { DocumentFormatError, migrateDocumentJson } from '$lib/model/documentFormat';
import { repairDocumentJson } from '$lib/model/documentRepair';
import { HistoryStack } from '$lib/commands/history.svelte';
import {
	StorageManager,
	IndexedDbStorageProvider,
	githubMetadataStore,
	type DocumentMetadata,
	type BackupGitHubSource,
	type GitHubFileMetadata,
	type GitHubRepoContext,
	type OverwriteBackupReason,
} from '$lib/services/storage';
import { githubStorageProvider } from '$lib/services/storage/providers/GitHubStorageProvider';
import {
	GitHubConflictError,
	GitHubNetworkError,
	createBranch,
	deleteFileContent,
	getFileContent,
	listBranches,
	listCommits,
	putFileContent,
} from '$lib/services/github/api';
import {
	loadLocalFolderPaths,
	loadLocalOnlyEntries,
	saveLocalOnlyEntries,
} from '../GitHubExplorer/localPersistence';
import { isTabSyncSupported, TabSync } from '$lib/services/tabSync.svelte';
import { reportError } from '$lib/errorReporting';
import {
	describeLoadFailure,
	notifyDocumentRepairs,
	toBackupEntries,
	type BackupEntry,
	type DocumentLoadFailure,
	type RestoreBackupResult,
} from './documentRecovery';
import {
	checkStoragePersistence,
	requestStoragePersistence,
	type StoragePersistence,
} from '$lib/services/storage/persistentStorage';
import { toast } from 'svelte-sonner';
import type { Part } from '$lib/model/Part';

export interface EditorDocumentSessionHooks {
	resetEphemeralEditorState: () => void;
	clearStaleSelectionsAfterReplay: () => void;
	repairActiveRegion: () => void;
	loadPersistedContext: () => Promise<boolean>;
	savePersistedContext: () => Promise<boolean>;
}

interface PersistResult {
	snapshot: DocSnapshot;
	persistedAt: number;
}

interface AdoptDocumentOptions {
	fileMetadata?: GitHubFileMetadata | null;
	lastLocalPersistAt?: number | null;
	lastGitHubSyncAt?: number | null;
	restoreLastSaveTime?: number | null;
	loadPersistedContext?: boolean;
}

export interface GitHubBindingSnapshot {
	repoContext: GitHubRepoContext | null;
	fileMetadata: GitHubFileMetadata | null;
	lastGitHubSyncAt: number | null;
	remoteAheadOfLocal: boolean;
}

export type RenameDocumentResult =
	| { kind: 'unchanged' }
	| { kind: 'doc-only-renamed' }
	| { kind: 'local-only-file-renamed'; oldPath: string; newPath: string; filename: string }
	| { kind: 'repo-file-renamed'; oldPath: string; newPath: string; filename: string };

export class EditorDocumentSession {
	#currentDoc: FoldnanoDocument = $state(new FoldnanoDocument());
	#storageManager: StorageManager;
	#historyStack: HistoryStack;
	#lastLocalPersistAt: number | null = $state(null);
	#lastGitHubSyncAt: number | null = $state(null);
	#currentFileMetadata: GitHubFileMetadata | null = $state(null);
	#currentRepoContext: GitHubRepoContext | null = $state(githubMetadataStore.getRepoContext());
	#remoteAheadOfLocal: boolean = $state(false);
	/** The last check for newer GitHub changes failed, so `remoteAheadOfLocal` may be stale. */
	#remoteCheckFailed: boolean = $state(false);
	#tabSync: TabSync | null = $state(null);
	#isLoading: boolean = $state(false);
	#storagePersistence = $state<StoragePersistence | 'unknown'>('unknown');
	#loadFailure = $state<DocumentLoadFailure | null>(null);
	#pendingUrlSave: boolean = $state(false);
	#sourceUrl: string | null = $state(null);

	constructor(private readonly hooks: EditorDocumentSessionHooks) {
		this.#storageManager = new StorageManager('indexedDB');
		this.#storageManager.registerProvider('indexedDB', new IndexedDbStorageProvider());
		this.#historyStack = $state(this.#makeHistoryStack());
		void checkStoragePersistence().then((state) => (this.#storagePersistence = state));
	}

	/** Whether the browser may evict this origin's IndexedDB under storage pressure. */
	get storagePersistence(): StoragePersistence | 'unknown' {
		return this.#storagePersistence;
	}

	#afterSave(): void {
		// Track the real stored save time, including autosaves, for GitHub dirty detection.
		const docId = this.#currentDoc.id;
		void this.#storedSaveTime(docId).then((savedAt) => {
			if (this.#currentDoc.id === docId) this.#lastLocalPersistAt = savedAt;
		});
		if (this.#storagePersistence !== 'best-effort') return;
		void requestStoragePersistence().then((state) => (this.#storagePersistence = state));
	}

	/** `documents.lastModified` of the stored snapshot, the stamp GitHub dirty checks compare. */
	async #storedSaveTime(docId: string): Promise<number> {
		return (await this.#storageManager.getLastModified(docId)) ?? Date.now();
	}

	get currentDoc(): FoldnanoDocument {
		return this.#currentDoc;
	}

	get storageManager(): StorageManager {
		return this.#storageManager;
	}

	get historyStack(): HistoryStack {
		return this.#historyStack;
	}

	get lastLocalPersistAt(): number | null {
		return this.#lastLocalPersistAt;
	}

	get lastGitHubSyncAt(): number | null {
		return this.#lastGitHubSyncAt;
	}

	get currentFileMetadata(): GitHubFileMetadata | null {
		return this.#currentFileMetadata;
	}

	get currentRepoContext(): GitHubRepoContext | null {
		return this.#currentRepoContext;
	}

	get remoteAheadOfLocal(): boolean {
		return this.#remoteAheadOfLocal;
	}

	get remoteCheckFailed(): boolean {
		return this.#remoteCheckFailed;
	}

	/** Re-run the check for newer GitHub changes (status-bar retry, back online, tab shown). */
	recheckRemote(): void {
		if (this.#currentFileMetadata) this.#checkRemoteAheadInBackground(this.#currentDoc.id);
	}

	/** The browser went offline: whatever we knew about GitHub is now unconfirmed. */
	markRemoteUnchecked(): void {
		if (this.#currentFileMetadata) this.#remoteCheckFailed = true;
	}

	get isLoading(): boolean {
		return this.#isLoading;
	}

	get pendingUrlSave(): boolean {
		return this.#pendingUrlSave;
	}

	get sourceUrl(): string | null {
		return this.#sourceUrl;
	}

	get isTabOwner(): boolean {
		return this.#tabSync?.isOwner ?? true;
	}

	get isSaved(): boolean {
		return !this.#historyStack.autoSaveStatus.hasUnsavedChanges;
	}

	get lastSavedTime(): number | null {
		return this.#historyStack.autoSaveStatus.lastSavedTime;
	}

	get editsSinceLastSave(): number {
		return this.#historyStack.autoSaveStatus.editsSinceLastSave;
	}

	get autoSaveError(): string | undefined {
		return this.#historyStack.autoSaveStatus.error;
	}

	get hasUnsavedLocalChanges(): boolean {
		return this.#historyStack.autoSaveStatus.hasUnsavedChanges;
	}

	get hasUncommittedGitHubChanges(): boolean {
		if (!this.#currentFileMetadata) return false;
		if (this.hasUnsavedLocalChanges) return true;
		return (
			this.#lastLocalPersistAt !== null && this.#lastLocalPersistAt > (this.#lastGitHubSyncAt ?? 0)
		);
	}

	#makeHistoryStack(): HistoryStack {
		return new HistoryStack(
			this.#currentDoc,
			this.#storageManager,
			() => {
				this.hooks.clearStaleSelectionsAfterReplay();
				this.hooks.repairActiveRegion();
			},
			() => this.isTabOwner,
			() => this.#afterSave()
		);
	}

	async #adoptDocument(doc: FoldnanoDocument, options: AdoptDocumentOptions = {}): Promise<void> {
		this.hooks.resetEphemeralEditorState();
		this.#historyStack.destroy();
		this.#currentDoc = doc;
		this.#historyStack = this.#makeHistoryStack();
		this.hooks.repairActiveRegion();

		this.#currentFileMetadata = options.fileMetadata ?? null;
		this.#lastLocalPersistAt = options.lastLocalPersistAt ?? null;
		this.#lastGitHubSyncAt = options.lastGitHubSyncAt ?? null;
		this.#remoteAheadOfLocal = false;
		this.#remoteCheckFailed = false;

		if (options.restoreLastSaveTime !== null && options.restoreLastSaveTime !== undefined) {
			this.#historyStack.restoreLastSaveTime(options.restoreLastSaveTime);
		}

		this.#initTabSync(doc.id);
		if (options.loadPersistedContext) {
			await this.hooks.loadPersistedContext();
		}
	}

	/** Writes a load-time repair back so it sticks, keeping the replaced stored copy as a backup. */
	async #persistRepair(repairs: string[], options: { backup: boolean }): Promise<void> {
		if (repairs.length === 0) return;
		notifyDocumentRepairs(repairs);
		if (!this.isTabOwner) return;
		const docId = this.#currentDoc.id;
		const ok = await this.#storageManager.saveDocument(
			docId,
			$state.snapshot(this.#currentDoc),
			options.backup ? { backup: { reason: 'before_repair' } } : undefined
		);
		if (!ok) return;
		const persistedAt = await this.#storedSaveTime(docId);
		this.#lastLocalPersistAt = persistedAt;
		this.#historyStack.markSaved(persistedAt);
	}

	#checkRemoteAheadInBackground(docId: string): void {
		void githubStorageProvider.checkRemoteState(docId).then((state) => {
			if (this.#currentDoc.id !== docId) return;
			// "unknown" is shown as such, never as "up to date".
			this.#remoteCheckFailed = state === 'unknown';
			if (state !== 'unknown') this.#remoteAheadOfLocal = state === 'changed';
		});
	}

	#backfillCommitShaInBackground(docId: string, fileMeta: GitHubFileMetadata): void {
		if (fileMeta.commitSha) return;
		void Promise.resolve()
			.then(() =>
				listCommits(fileMeta.owner, fileMeta.repo, {
					sha: fileMeta.branch,
					path: fileMeta.path,
					perPage: 1,
				})
			)
			.then((commits = []) => {
				if (commits[0]?.sha) {
					githubMetadataStore.stampCommitSha(docId, commits[0].sha);
					this.#currentFileMetadata = githubMetadataStore.getFileMetadata(docId);
				}
			})
			.catch(() => {
				/* network error — stay silent */
			});
	}

	refreshGitHubStateFromStore(): void {
		this.#currentRepoContext = githubMetadataStore.getRepoContext();
		const docId = this.#currentDoc.id;
		this.#currentFileMetadata = githubMetadataStore.getFileMetadata(docId);
		this.#lastGitHubSyncAt = this.#currentFileMetadata?.lastSyncAt ?? null;
		this.#remoteAheadOfLocal = false;
		this.#remoteCheckFailed = false;
	}

	captureGitHubBindingSnapshot(): GitHubBindingSnapshot {
		return {
			repoContext: this.#currentRepoContext ? { ...this.#currentRepoContext } : null,
			fileMetadata: this.#currentFileMetadata ? { ...this.#currentFileMetadata } : null,
			lastGitHubSyncAt: this.#lastGitHubSyncAt,
			remoteAheadOfLocal: this.#remoteAheadOfLocal,
		};
	}

	restoreGitHubBindingSnapshot(snapshot: GitHubBindingSnapshot): void {
		if (snapshot.repoContext) {
			githubMetadataStore.setRepoContext(snapshot.repoContext);
		} else {
			githubMetadataStore.clearRepoContext();
		}
		if (snapshot.fileMetadata) {
			githubMetadataStore.setFileMetadata(this.#currentDoc.id, snapshot.fileMetadata);
		} else {
			githubMetadataStore.clearFileMetadata(this.#currentDoc.id);
		}
		this.#currentRepoContext = snapshot.repoContext;
		this.#currentFileMetadata = snapshot.fileMetadata;
		this.#lastGitHubSyncAt = snapshot.lastGitHubSyncAt;
		this.#remoteAheadOfLocal = snapshot.remoteAheadOfLocal;
	}

	setCurrentFileSha(sha: string): void {
		if (!this.#currentFileMetadata) return;
		const updated = { ...this.#currentFileMetadata, sha };
		githubMetadataStore.setFileMetadata(this.#currentDoc.id, updated);
		this.#currentFileMetadata = updated;
	}

	bindCurrentDocumentToGitHubFile(meta: GitHubFileMetadata): void {
		const repoCtx = { owner: meta.owner, repo: meta.repo, branch: meta.branch };
		githubMetadataStore.setRepoContext(repoCtx);
		this.#currentRepoContext = repoCtx;
		githubMetadataStore.setFileMetadata(this.#currentDoc.id, meta);
		this.#currentFileMetadata = meta;
		this.#lastGitHubSyncAt = meta.lastSyncAt ?? this.#lastGitHubSyncAt;
		this.#remoteAheadOfLocal = false;
		this.#remoteCheckFailed = false;
	}

	clearCurrentFileBinding(): void {
		githubMetadataStore.clearFileMetadata(this.#currentDoc.id);
		this.#currentFileMetadata = null;
		this.#lastGitHubSyncAt = null;
		this.#remoteAheadOfLocal = false;
		this.#remoteCheckFailed = false;
	}

	applyExternalCurrentFileRename(
		oldPath: string,
		newPath: string,
		options?: { clearSha?: boolean }
	): void {
		if (this.#currentFileMetadata?.path !== oldPath) return;
		const updated = {
			...this.#currentFileMetadata,
			path: newPath,
			...(options?.clearSha ? { sha: '' } : {}),
		};
		githubMetadataStore.setFileMetadata(this.#currentDoc.id, updated);
		this.#currentFileMetadata = updated;
		this.#currentDoc.name = basenameWithoutExt(newPath);
	}

	/** Local-only files have no GitHub metadata to derive the name from, so the explorer pushes it here. */
	async syncCurrentDocName(name: string): Promise<void> {
		if (this.#currentDoc.name === name) return;
		this.#currentDoc.name = name;
		await this.saveDocumentToLocalStorage({ force: true });
	}

	private isPristineUnsavedBlankDocument(): boolean {
		return (
			this.#currentFileMetadata === null &&
			this.#lastLocalPersistAt === null &&
			!this.hasUnsavedLocalChanges &&
			this.#currentDoc.name === 'Untitled Document' &&
			this.#currentDoc.parts.length === 0
		);
	}

	/** Set when the last local load found a snapshot it could not open; drives the recovery screen. */
	get loadFailure(): DocumentLoadFailure | null {
		return this.#loadFailure;
	}

	async loadDocumentFromLocalStorage(docId: string): Promise<boolean> {
		this.#isLoading = true;
		this.#loadFailure = null;
		try {
			const docData = await this.#storageManager.loadDocument(docId);
			if (!docData) return false;

			let restoredDoc: FoldnanoDocument;
			let repairs: string[];
			try {
				const repaired = repairDocumentJson(migrateDocumentJson(docData));
				repairs = repaired.repairs;
				restoredDoc = FoldnanoDocument.fromJSON(repaired.snapshot);
			} catch (e) {
				reportError(e, 'document-load', { notify: false });
				this.#loadFailure = describeLoadFailure(docId, docData, e);
				return false;
			}
			const fileMeta = githubMetadataStore.getFileMetadata(restoredDoc.id);

			if (fileMeta?.path) syncNameWithPath(restoredDoc, fileMeta.path);

			const docList = await this.#storageManager.getDocumentList();
			const docMeta = docList.find((d) => d.id === restoredDoc.id);
			const lastModified = docMeta?.lastModified ?? null;

			await this.#adoptDocument(restoredDoc, {
				fileMetadata: fileMeta,
				lastLocalPersistAt: lastModified,
				lastGitHubSyncAt: fileMeta?.lastSyncAt ?? null,
				restoreLastSaveTime: lastModified,
				loadPersistedContext: true,
			});
			await this.#persistRepair(repairs, { backup: true });

			if (fileMeta) {
				this.#checkRemoteAheadInBackground(restoredDoc.id);
				this.#backfillCommitShaInBackground(restoredDoc.id, fileMeta);
			}

			return true;
		} catch (e) {
			console.error('[EditorDocumentSession] Failed to load document:', e);
			toast.error('Failed to load document from local storage');
			return false;
		} finally {
			this.#isLoading = false;
		}
	}

	async getDocumentList(): Promise<DocumentMetadata[]> {
		return await this.#storageManager.getDocumentList();
	}

	async deleteDocumentFromLocalStorage(docId: string): Promise<boolean> {
		return await this.#storageManager.deleteDocument(docId);
	}

	async saveDocumentToLocalStorage(options?: {
		skipPristineBlank?: boolean;
		force?: boolean;
	}): Promise<boolean> {
		if (!this.isTabOwner) return false;
		try {
			if (options?.skipPristineBlank && this.isPristineUnsavedBlankDocument()) {
				return true;
			}
			await this.persistCurrentDocumentSnapshot('manual-save', { force: options?.force });
			return await this.hooks.savePersistedContext();
		} catch (e) {
			console.error('[EditorDocumentSession] Failed to save document:', e);
			return false;
		}
	}

	async renameDocument(newName: string): Promise<RenameDocumentResult> {
		const trimmed = newName.trim();
		if (!trimmed || trimmed === this.#currentDoc.name) return { kind: 'unchanged' };

		const repoCtx = this.#currentRepoContext;
		const meta = this.#currentFileMetadata;

		if (!repoCtx) {
			this.#currentDoc.name = trimmed;
			await this.saveDocumentToLocalStorage({ force: true });
			return { kind: 'doc-only-renamed' };
		}

		const localEntries = loadLocalOnlyEntries(repoCtx);
		const localOnlyEntry = localEntries.find((entry) => entry.docId === this.#currentDoc.id);

		if (localOnlyEntry) {
			const newPath = deriveNewPath(localOnlyEntry.path, trimmed);
			const updated = localEntries.map((e) =>
				e.docId === this.#currentDoc.id
					? { ...e, path: newPath, name: newPath.split('/').pop()! }
					: e
			);
			saveLocalOnlyEntries(repoCtx, updated);
			this.#currentDoc.name = trimmed;
			if (meta?.path === localOnlyEntry.path) {
				this.applyExternalCurrentFileRename(localOnlyEntry.path, newPath);
			}
			await this.saveDocumentToLocalStorage({ force: true });
			return {
				kind: 'local-only-file-renamed',
				oldPath: localOnlyEntry.path,
				newPath,
				filename: newPath.split('/').pop() ?? newPath,
			};
		}

		if (meta?.sha) {
			const newPath = deriveNewPath(meta.path, trimmed);
			const oldName = this.#currentDoc.name;
			const oldMeta = meta;

			this.#currentDoc.name = trimmed;
			this.applyExternalCurrentFileRename(meta.path, newPath, { clearSha: true });

			try {
				const snapshot = await this.#storageManager.loadDocument(this.#currentDoc.id);
				const raw = snapshot ? JSON.stringify(snapshot, null, 2) : '{}';
				const bytes = new TextEncoder().encode(raw);
				let binary = '';
				for (const b of bytes) binary += String.fromCharCode(b);
				const contentBase64 = btoa(binary);

				const commitMessage = `Rename: ${meta.path.split('/').pop()} → ${newPath.split('/').pop()}`;
				await putFileContent(repoCtx.owner, repoCtx.repo, newPath, {
					message: commitMessage,
					content: contentBase64,
					branch: repoCtx.branch,
				});
				await deleteFileContent(repoCtx.owner, repoCtx.repo, meta.path, {
					message: commitMessage,
					sha: meta.sha,
					branch: repoCtx.branch,
				});

				this.#lastGitHubSyncAt = Date.now();
				await this.saveDocumentToLocalStorage({ force: true });
			} catch (e) {
				this.#currentDoc.name = oldName;
				githubMetadataStore.setFileMetadata(this.#currentDoc.id, oldMeta);
				this.#currentFileMetadata = oldMeta;
				throw e;
			}
			return {
				kind: 'repo-file-renamed',
				oldPath: meta.path,
				newPath,
				filename: newPath.split('/').pop() ?? newPath,
			};
		}

		this.#currentDoc.name = trimmed;
		await this.saveDocumentToLocalStorage({ force: true });
		return { kind: 'doc-only-renamed' };
	}

	async openImportedDocument(imported: FoldnanoDocument): Promise<void> {
		this.#isLoading = true;
		try {
			await this.#adoptDocument(imported, {
				fileMetadata: null,
				lastLocalPersistAt: null,
				lastGitHubSyncAt: null,
				loadPersistedContext: false,
			});
			await this.saveDocumentToLocalStorage({ force: true });
		} finally {
			this.#isLoading = false;
		}
	}

	async loadDocumentFromGitHub(
		owner: string,
		repo: string,
		path: string,
		branch: string,
		backup?: { reason: OverwriteBackupReason; github?: BackupGitHubSource }
	): Promise<boolean> {
		this.#isLoading = true;
		try {
			const file = await getFileContent(owner, repo, path, branch);
			const rawContent = atob(file.content.replace(/\s/g, ''));
			// Validate before anything is written locally, so a file from a newer app is refused intact.
			let snapshot = migrateDocumentJson(JSON.parse(rawContent));

			const existingMeta = githubMetadataStore.getFileMetadata(snapshot.id);
			const isDifferentFile =
				existingMeta &&
				(existingMeta.path !== path || existingMeta.owner !== owner || existingMeta.repo !== repo);
			if (isDifferentFile) {
				const openAsCopy = window.confirm(
					`This file shares a document ID with "${existingMeta.path}" already saved locally.\n\nOpen as a new independent copy? (Cancel to abort)`
				);
				if (!openAsCopy) return false;
				snapshot = { ...snapshot, id: crypto.randomUUID() };
			}

			const { snapshot: repairedSnapshot, repairs } = repairDocumentJson(snapshot);
			const doc = FoldnanoDocument.fromJSON(repairedSnapshot);
			syncNameWithPath(doc, path);
			const saved = await this.#storageManager.saveDocument(doc.id, snapshot, { backup });
			if (!saved) throw new Error('Failed to save the GitHub file in this browser');

			// The stored save time of what was just written, so later saves always read as newer.
			const now = await this.#storedSaveTime(doc.id);
			const tipCommits = await listCommits(owner, repo, { sha: branch, path, perPage: 1 }).catch(
				() => []
			);
			const fileMeta: GitHubFileMetadata = {
				path,
				sha: file.sha,
				owner,
				repo,
				branch,
				lastSyncAt: now,
				commitSha: tipCommits[0]?.sha,
			};
			await githubMetadataStore.setFileMetadata(doc.id, fileMeta);

			await this.#adoptDocument(doc, {
				fileMetadata: fileMeta,
				lastLocalPersistAt: now,
				lastGitHubSyncAt: now,
				restoreLastSaveTime: now,
				loadPersistedContext: true,
			});
			// GitHub keeps the unrepaired version; saving after the sync stamp marks the repair as
			// a local change to commit.
			await this.#persistRepair(repairs, { backup: false });

			return true;
		} catch (e) {
			console.error('[EditorDocumentSession] Failed to load document from GitHub:', e);
			if (e instanceof DocumentFormatError) toast.error(e.message);
			return false;
		} finally {
			this.#isLoading = false;
		}
	}

	async commitCurrentDocToGitHub(message: string): Promise<string> {
		if (!this.isTabOwner) throw new Error('This tab does not own the document — save blocked.');
		const { snapshot, persistedAt } = await this.#prepareForGitOperation('commit');
		let commitSha: string;
		try {
			commitSha = await githubStorageProvider.commitDocument(
				this.#currentDoc.id,
				message,
				snapshot
			);
		} catch (e) {
			// GitHub refused a stale SHA: surface the diverged state so the conflict flow can take over.
			if (e instanceof GitHubConflictError) {
				this.#remoteAheadOfLocal = true;
				this.#remoteCheckFailed = false;
			}
			if (e instanceof GitHubNetworkError) this.#remoteCheckFailed = true;
			throw e;
		}
		// Synced as of the snapshot that was uploaded, not "now": an autosave during the upload
		// has a later save time and keeps the design marked as not committed.
		this.#lastLocalPersistAt = this.#lastLocalPersistAt ?? persistedAt;
		this.#lastGitHubSyncAt = persistedAt;
		this.#remoteAheadOfLocal = false;
		this.#remoteCheckFailed = false;
		await githubMetadataStore.stampSyncTime(this.#currentDoc.id, persistedAt);
		await githubMetadataStore.stampCommitSha(this.#currentDoc.id, commitSha);
		this.#currentFileMetadata = githubMetadataStore.getFileMetadata(this.#currentDoc.id);
		return commitSha;
	}

	/**
	 * Keep local / Force overwrite: commits the local version over a GitHub file that changed
	 * since the last sync. The GitHub version stays in the repository's history.
	 */
	async overwriteGitHubWithLocal(message: string): Promise<string> {
		const meta = this.#currentFileMetadata;
		if (!meta) throw new Error('This design is not linked to a GitHub file');
		const remote = await getFileContent(meta.owner, meta.repo, meta.path, meta.branch);
		// The PUT is accepted only against the SHA GitHub has now.
		this.setCurrentFileSha(remote.sha);
		return this.commitCurrentDocToGitHub(message);
	}

	async pullCurrentDocFromGitHub(
		reason: Extract<
			OverwriteBackupReason,
			'before_pull' | 'before_accept_remote' | 'before_discard'
		> = 'before_pull'
	): Promise<boolean> {
		this.#isLoading = true;
		try {
			await this.#prepareForGitOperation('overwrite');
			const pulled = await githubStorageProvider.pullDocument(this.#currentDoc.id, reason);
			const { snapshot, repairs } = repairDocumentJson(pulled);
			const doc = FoldnanoDocument.fromJSON(snapshot);
			const now = await this.#storedSaveTime(doc.id);

			await githubMetadataStore.stampSyncTime(doc.id, now);
			const fileMeta = githubMetadataStore.getFileMetadata(doc.id);
			if (fileMeta) {
				syncNameWithPath(doc, fileMeta.path);
				const tipCommits = await listCommits(fileMeta.owner, fileMeta.repo, {
					sha: fileMeta.branch,
					path: fileMeta.path,
					perPage: 1,
				}).catch(() => []);
				if (tipCommits[0]?.sha) {
					await githubMetadataStore.stampCommitSha(doc.id, tipCommits[0].sha);
				}
			}

			await this.#adoptDocument(doc, {
				fileMetadata: githubMetadataStore.getFileMetadata(doc.id),
				lastLocalPersistAt: now,
				lastGitHubSyncAt: now,
				restoreLastSaveTime: now,
				loadPersistedContext: true,
			});
			await this.#persistRepair(repairs, { backup: false });

			return true;
		} catch (e) {
			console.error('[EditorDocumentSession] Failed to pull from GitHub:', e);
			if (e instanceof GitHubNetworkError) this.#remoteCheckFailed = true;
			if (e instanceof Error) toast.error(e.message);
			return false;
		} finally {
			this.#isLoading = false;
		}
	}

	async createNewLocalDocument(name: string, folderPath: string): Promise<string> {
		await this.saveDocumentToLocalStorage({ skipPristineBlank: true });

		const newDoc = new FoldnanoDocument();
		newDoc.name = name;

		await this.#adoptDocument(newDoc, {
			fileMetadata: null,
			lastLocalPersistAt: null,
			lastGitHubSyncAt: null,
			loadPersistedContext: false,
		});

		const { persistedAt } = await this.persistCurrentDocumentSnapshot('new-document', {
			force: true,
		});
		this.#lastLocalPersistAt = persistedAt;

		return folderPath ? `${folderPath}/${name}.fn.json` : `${name}.fn.json`;
	}

	async createDocumentFromImportedPart(
		part: Part,
		name: string,
		folderPath = ''
	): Promise<{ docId: string; path: string }> {
		this.#isLoading = true;
		try {
			await this.saveDocumentToLocalStorage({ skipPristineBlank: true });

			const newDoc = new FoldnanoDocument();
			newDoc.name = name;
			newDoc.parts.push(part);

			await this.#adoptDocument(newDoc, {
				fileMetadata: null,
				lastLocalPersistAt: null,
				lastGitHubSyncAt: null,
				loadPersistedContext: false,
			});

			const { persistedAt } = await this.persistCurrentDocumentSnapshot('cadnano-import', {
				force: true,
			});
			this.#lastLocalPersistAt = persistedAt;

			const path = folderPath ? `${folderPath}/${name}.fn.json` : `${name}.fn.json`;
			return { docId: newDoc.id, path };
		} finally {
			this.#isLoading = false;
		}
	}

	async createNewStandaloneDocument(name = 'Untitled Document'): Promise<string> {
		await this.saveDocumentToLocalStorage({ skipPristineBlank: true });

		const newDoc = new FoldnanoDocument();
		newDoc.name = name;

		await this.#adoptDocument(newDoc, {
			fileMetadata: null,
			lastLocalPersistAt: null,
			lastGitHubSyncAt: null,
			loadPersistedContext: false,
		});

		const { persistedAt } = await this.persistCurrentDocumentSnapshot('new-standalone-document', {
			force: true,
		});
		this.#lastLocalPersistAt = persistedAt;
		return newDoc.id;
	}

	/** The stored snapshot exactly as saved, for downloading a document that won't open. */
	async loadRawDocument(docId: string): Promise<object | null> {
		return this.#storageManager.loadDocument(docId);
	}

	async listBackups(docId: string): Promise<BackupEntry[]> {
		return toBackupEntries(await this.#storageManager.getLocalBackups(docId));
	}

	/**
	 * Replaces a document's stored copy with a backup and opens it. The replaced copy, including
	 * unsaved edits when the document is open, is kept as a backup first.
	 */
	async restoreBackup(docId: string, backup: BackupEntry): Promise<RestoreBackupResult> {
		if (!this.isTabOwner || !backup.readable) return 'not-allowed';
		if (docId === this.#currentDoc.id) {
			try {
				await this.persistCurrentDocumentSnapshot('before-restore');
			} catch {
				return 'save-failed';
			}
		}
		// IndexedDB can't store proxies; callers may hand in a reactive copy.
		const snapshot = $state.snapshot(backup.snapshot) as object;
		const ok = await this.#storageManager.saveDocument(docId, snapshot, {
			backup: { reason: 'before_restore', github: this.#githubSourceOf(docId) },
		});
		if (!ok) return 'save-failed';
		return (await this.loadDocumentFromLocalStorage(docId)) ? 'restored' : 'still-unreadable';
	}

	/**
	 * Applies a hand-resolved conflict (JSON edited in the diff dialog) and opens it, keeping
	 * the replaced copy as a backup.
	 */
	async applyResolvedConflict(docId: string, resolved: object): Promise<boolean> {
		if (!this.isTabOwner) return false;
		if (docId === this.#currentDoc.id) {
			try {
				await this.persistCurrentDocumentSnapshot('before-conflict-resolve');
			} catch {
				return false;
			}
		}
		const ok = await this.#storageManager.saveDocument(docId, resolved, {
			backup: { reason: 'before_conflict_resolve', github: this.#githubSourceOf(docId) },
		});
		if (!ok) return false;
		return this.loadDocumentFromLocalStorage(docId);
	}

	async loadTransientDocument(doc: FoldnanoDocument, sourceUrl: string): Promise<void> {
		this.#isLoading = true;
		try {
			await this.#adoptDocument(doc, {
				fileMetadata: null,
				lastLocalPersistAt: null,
				lastGitHubSyncAt: null,
				loadPersistedContext: false,
			});
			this.#historyStack.restoreLastSaveTime(Date.now());
			this.#pendingUrlSave = true;
			this.#sourceUrl = sourceUrl;
		} finally {
			this.#isLoading = false;
		}
	}

	async confirmAndSaveFromUrl(): Promise<void> {
		this.#pendingUrlSave = false;
		this.#sourceUrl = null;
		await this.saveDocumentToLocalStorage({ force: true });
	}

	async persistCurrentDocumentSnapshot(
		_reason: string,
		options?: { force?: boolean }
	): Promise<PersistResult> {
		const snapshot = $state.snapshot(this.#currentDoc);
		if (this.#pendingUrlSave && !options?.force) {
			return { snapshot, persistedAt: 0 };
		}
		if (!options?.force && !this.hasUnsavedLocalChanges && this.#lastLocalPersistAt !== null) {
			// Nothing new to write; report the stored save time (autosave may have moved it).
			const persistedAt = await this.#storedSaveTime(this.#currentDoc.id);
			this.#lastLocalPersistAt = persistedAt;
			return { snapshot, persistedAt };
		}

		const ok = await this.#storageManager.saveDocument(this.#currentDoc.id, snapshot);
		if (!ok) {
			const message = 'Failed to persist the current document locally';
			this.#historyStack.markSaveFailed(message);
			throw new Error(message);
		}

		const persistedAt = await this.#storedSaveTime(this.#currentDoc.id);
		this.#lastLocalPersistAt = persistedAt;
		this.#historyStack.markSaved(persistedAt);
		return { snapshot, persistedAt };
	}

	async createAndSwitchBranch(branchName: string): Promise<void> {
		const repoCtx = this.#currentRepoContext;
		if (!repoCtx) throw new Error('No GitHub repository is connected');
		const trimmed = branchName.trim();
		if (!trimmed) throw new Error('Branch name is required');

		const branches = await listBranches(repoCtx.owner, repoCtx.repo);
		const current = branches.find((branch) => branch.name === repoCtx.branch);
		if (!current) throw new Error(`Branch "${repoCtx.branch}" not found`);

		await createBranch(repoCtx.owner, repoCtx.repo, trimmed, current.commit.sha);

		const updatedCtx = { ...repoCtx, branch: trimmed };
		githubMetadataStore.setRepoContext(updatedCtx);
		githubMetadataStore.updateBranchForRepo(repoCtx.owner, repoCtx.repo, trimmed);
		this.#currentRepoContext = updatedCtx;
		this.#currentFileMetadata = githubMetadataStore.getFileMetadata(this.#currentDoc.id);
	}

	async switchToBranch(targetBranch: string): Promise<{ reloaded: boolean; fileMissing: boolean }> {
		const repoCtx = this.#currentRepoContext;
		if (!repoCtx || targetBranch === repoCtx.branch) {
			return { reloaded: false, fileMissing: false };
		}

		const otherDirtyPaths = await githubMetadataStore.getUncommittedPaths(
			repoCtx.owner,
			repoCtx.repo
		);
		const localOnlyEntries = loadLocalOnlyEntries(repoCtx);
		const localFolderPaths = loadLocalFolderPaths(repoCtx);
		if (
			this.hasUncommittedGitHubChanges ||
			otherDirtyPaths.size > 0 ||
			localOnlyEntries.length > 0 ||
			localFolderPaths.length > 0
		) {
			// eslint-disable-next-line svelte/prefer-svelte-reactivity
			const names = new Set<string>();
			if (this.hasUncommittedGitHubChanges && this.#currentFileMetadata) {
				names.add(this.#currentFileMetadata.path);
			}
			for (const path of otherDirtyPaths) names.add(path);
			for (const entry of localOnlyEntries) names.add(entry.path);
			for (const path of localFolderPaths) names.add(path);
			throw new Error(
				`Commit, publish, or discard changes first:\n${[...names]
					.map((path) => `• ${path}`)
					.join('\n')}`
			);
		}

		const updatedCtx = { ...repoCtx, branch: targetBranch };
		githubMetadataStore.setRepoContext(updatedCtx);
		githubMetadataStore.updateBranchForRepo(repoCtx.owner, repoCtx.repo, targetBranch);
		this.#currentRepoContext = updatedCtx;
		this.#currentFileMetadata = githubMetadataStore.getFileMetadata(this.#currentDoc.id);

		const currentFileMeta = this.#currentFileMetadata;
		if (!currentFileMeta) {
			return { reloaded: false, fileMissing: false };
		}

		await this.#prepareForGitOperation('overwrite');

		const ok = await this.loadDocumentFromGitHub(
			currentFileMeta.owner,
			currentFileMeta.repo,
			currentFileMeta.path,
			targetBranch,
			{
				reason: 'before_branch_reload',
				github: {
					owner: currentFileMeta.owner,
					repo: currentFileMeta.repo,
					branch: repoCtx.branch,
					path: currentFileMeta.path,
				},
			}
		);
		if (ok) {
			return { reloaded: true, fileMissing: false };
		}

		this.clearCurrentFileBinding();
		return { reloaded: false, fileMissing: true };
	}

	disconnectGitHub(): void {
		githubMetadataStore.clearRepoContext();
		this.#currentRepoContext = null;
		this.clearCurrentFileBinding();
	}

	resetToBlankDocument(): void {
		this.hooks.resetEphemeralEditorState();
		this.#historyStack.destroy();
		this.#currentDoc = new FoldnanoDocument();
		this.#historyStack = this.#makeHistoryStack();
		this.#currentFileMetadata = null;
		this.#lastLocalPersistAt = null;
		this.#lastGitHubSyncAt = null;
		this.#remoteAheadOfLocal = false;
		this.#remoteCheckFailed = false;
		this.#initTabSync(this.#currentDoc.id);
		this.hooks.repairActiveRegion();
	}

	replaceStorageManagerForTesting(storageManager: StorageManager): void {
		this.#storageManager = storageManager;
		this.#historyStack.destroy();
		this.#historyStack = this.#makeHistoryStack();
	}

	replaceCurrentDocumentForTesting(doc: FoldnanoDocument): void {
		this.hooks.resetEphemeralEditorState();
		this.#historyStack.destroy();
		this.#currentDoc = doc;
		this.#historyStack = this.#makeHistoryStack();
		this.#currentFileMetadata = githubMetadataStore.getFileMetadata(doc.id);
		this.#lastGitHubSyncAt = this.#currentFileMetadata?.lastSyncAt ?? null;
		this.hooks.repairActiveRegion();
	}

	/** Persists in-memory edits first, so a commit sends them and an overwrite backs them up. */
	#prepareForGitOperation(kind: 'commit' | 'overwrite'): Promise<PersistResult> {
		return this.persistCurrentDocumentSnapshot(
			kind === 'commit' ? 'before-commit' : 'before-overwrite'
		);
	}

	#githubSourceOf(docId: string): BackupGitHubSource | undefined {
		const meta = githubMetadataStore.getFileMetadata(docId);
		return meta
			? { owner: meta.owner, repo: meta.repo, branch: meta.branch, path: meta.path }
			: undefined;
	}

	#initTabSync(docId: string): void {
		if (!isTabSyncSupported()) return;
		this.#tabSync?.destroy();
		this.#tabSync = new TabSync(docId, {
			// The other tab may have saved newer work while this one was read-only; reloading also
			// replaces this TabSync with one that holds the lock.
			onRegained: () =>
				this.#currentDoc.id === docId
					? this.loadDocumentFromLocalStorage(docId)
					: Promise.resolve(false),
		});
	}

	async claimTabOwnership(): Promise<void> {
		await this.loadDocumentFromLocalStorage(this.#currentDoc.id);
	}

	destroy(): void {
		this.#historyStack.destroy();
		this.#tabSync?.destroy();
		this.#tabSync = null;
	}
}

function deriveNewPath(oldPath: string, newName: string): string {
	const lastSlash = oldPath.lastIndexOf('/');
	const dir = lastSlash >= 0 ? oldPath.substring(0, lastSlash + 1) : '';
	const filename = lastSlash >= 0 ? oldPath.substring(lastSlash + 1) : oldPath;
	const dotIdx = filename.indexOf('.');
	const ext = dotIdx >= 0 ? filename.substring(dotIdx) : '';
	return dir + newName + ext;
}

/** A GitHub-backed document is named after its file; the name stored inside the JSON goes stale when the file is renamed. */
function syncNameWithPath(doc: FoldnanoDocument, path: string): void {
	const pathName = basenameWithoutExt(path);
	if (pathName && pathName !== doc.name) doc.name = pathName;
}

function basenameWithoutExt(path: string): string {
	const filename = path.split('/').pop() ?? path;
	const dotIdx = filename.indexOf('.');
	return dotIdx >= 0 ? filename.substring(0, dotIdx) : filename;
}

export const [getEditorDocumentSession, setEditorDocumentSession] =
	createContext<EditorDocumentSession>();
