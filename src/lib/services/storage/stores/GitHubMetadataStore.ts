import { foldnanoIndexedDb } from '../indexeddb/FoldnanoIndexedDb';
import { toRepoKey } from '../indexedDbTypes';
import type { GitHubFileMetadata, GitHubRepoContext } from '../githubTypes';
import type { DocumentMetadata } from '../types';

export class GitHubMetadataStore {
	// True only after hydrate() has finished loading from IndexedDB.
	// Write methods must NOT set this flag — they use hasLocalWrites instead.
	// This prevents write-before-hydrate from permanently skipping the IndexedDB load.
	private hydrated = false;
	private repoContext: GitHubRepoContext | null = null;
	private fileMetadataByDocId = new Map<string, GitHubFileMetadata>();

	private canUseIndexedDb(): boolean {
		return foldnanoIndexedDb.isAvailable();
	}

	async hydrate(): Promise<void> {
		if (this.hydrated) return;

		this.repoContext = null;
		this.fileMetadataByDocId = new Map();

		if (this.canUseIndexedDb()) {
			try {
				const [repoContexts, fileMetadata] = await Promise.all([
					foldnanoIndexedDb.githubRepoContexts.toArray(),
					foldnanoIndexedDb.githubFiles.toArray(),
				]);

				this.repoContext = repoContexts[0]
					? {
							owner: repoContexts[0].owner,
							repo: repoContexts[0].repo,
							branch: repoContexts[0].branch,
						}
					: null;
				this.fileMetadataByDocId = new Map(
					fileMetadata.map((meta) => [
						meta.docId,
						{
							path: meta.path,
							sha: meta.sha,
							owner: meta.owner,
							repo: meta.repo,
							branch: meta.branch,
							lastSyncAt: meta.lastSyncAt,
						},
					])
				);
				this.hydrated = true;
				return;
			} catch (e) {
				console.error('[GitHubMetadataStore] IndexedDB hydrate failed:', e);
			}
		}
		this.hydrated = true;
	}

	getRepoContext(): GitHubRepoContext | null {
		return this.repoContext;
	}

	setRepoContext(ctx: GitHubRepoContext): void {
		this.repoContext = ctx;
		if (this.canUseIndexedDb()) {
			void foldnanoIndexedDb.githubRepoContexts
				.put({
					...ctx,
					repoKey: toRepoKey(ctx.owner, ctx.repo),
				})
				.catch((e) => {
					console.error('[GitHubMetadataStore] Failed to persist repo context to IndexedDB:', e);
				});
		}
	}

	clearRepoContext(): void {
		this.repoContext = null;
		if (this.canUseIndexedDb()) {
			void foldnanoIndexedDb.githubRepoContexts.clear().catch((e) => {
				console.error('[GitHubMetadataStore] Failed to clear repo context in IndexedDB:', e);
			});
		}
	}

	getFileMetadata(docId: string): GitHubFileMetadata | null {
		return this.fileMetadataByDocId.get(docId) ?? null;
	}

	/**
	 * Updates memory immediately. The returned promise settles when IndexedDB has the write:
	 * commit/pull flows await it (the SHA and lastSyncAt must not be silently lost); other
	 * callers may ignore it, failures are logged either way.
	 */
	setFileMetadata(docId: string, meta: GitHubFileMetadata): Promise<void> {
		this.fileMetadataByDocId.set(docId, meta);
		if (!this.canUseIndexedDb()) return Promise.resolve();
		const write = foldnanoIndexedDb.githubFiles
			.put({ docId, ...meta, repoKey: toRepoKey(meta.owner, meta.repo) })
			.then(
				() => undefined,
				(e: unknown) => {
					const detail = e instanceof Error ? e.message : String(e);
					throw new Error(`Couldn't save the GitHub sync state in this browser: ${detail}`);
				}
			);
		// Marks the promise handled so callers that don't await it cause no unhandled rejection.
		write.catch((e) => console.error('[GitHubMetadataStore] Failed to persist file metadata:', e));
		return write;
	}

	clearFileMetadata(docId: string): void {
		this.fileMetadataByDocId.delete(docId);
		if (this.canUseIndexedDb()) {
			void foldnanoIndexedDb.githubFiles.delete(docId).catch((e) => {
				console.error('[GitHubMetadataStore] Failed to clear file metadata in IndexedDB:', e);
			});
		}
	}

	async getUncommittedPaths(owner: string, repo: string): Promise<Set<string>> {
		const uncommitted = new Set<string>();
		const repoFiles = [...this.fileMetadataByDocId.entries()].filter(
			([, meta]) => meta.owner === owner && meta.repo === repo && meta.lastSyncAt
		);

		let documents: DocumentMetadata[] = [];
		if (this.canUseIndexedDb()) {
			try {
				const documentRecords = await foldnanoIndexedDb.documents.bulkGet(
					repoFiles.map(([docId]) => docId)
				);
				documents = documentRecords
					.filter(
						(record): record is NonNullable<(typeof documentRecords)[number]> =>
							record !== undefined
					)
					.map(({ id, name, lastModified, lastAutoSaved }) => ({
						id,
						name,
						lastModified,
						lastAutoSaved,
					}));
			} catch (e) {
				console.error(
					'[GitHubMetadataStore] Failed to read IndexedDB documents for dirty-path check:',
					e
				);
			}
		}
		const docMap = new Map(documents.map((doc) => [doc.id, doc]));

		for (const [docId, meta] of repoFiles) {
			const docMeta = docMap.get(docId);
			if (docMeta?.lastModified && meta.lastSyncAt && docMeta.lastModified > meta.lastSyncAt) {
				uncommitted.add(meta.path);
			}
		}

		return uncommitted;
	}

	/**
	 * Update the branch field for all file metadata entries belonging to the given repo.
	 * Call this after a branch switch so every tracked file commits to the new branch.
	 */
	updateBranchForRepo(owner: string, repo: string, newBranch: string): void {
		for (const [docId, meta] of this.fileMetadataByDocId) {
			if (meta.owner === owner && meta.repo === repo) {
				this.setFileMetadata(docId, { ...meta, branch: newBranch });
			}
		}
	}

	findDocIdByPath(owner: string, repo: string, path: string): string | null {
		for (const [docId, meta] of this.fileMetadataByDocId) {
			if (meta.owner === owner && meta.repo === repo && meta.path === path) {
				return docId;
			}
		}
		return null;
	}

	/** Returns the set of file paths that have a local copy for the given repo. */
	getLocalCachedPaths(owner: string, repo: string): Set<string> {
		const paths = new Set<string>();
		for (const meta of this.fileMetadataByDocId.values()) {
			if (meta.owner === owner && meta.repo === repo) {
				paths.add(meta.path);
			}
		}
		return paths;
	}

	stampSyncTime(docId: string, syncAt: number): Promise<void> {
		const meta = this.getFileMetadata(docId);
		return meta ? this.setFileMetadata(docId, { ...meta, lastSyncAt: syncAt }) : Promise.resolve();
	}

	stampCommitSha(docId: string, commitSha: string): Promise<void> {
		const meta = this.getFileMetadata(docId);
		return meta ? this.setFileMetadata(docId, { ...meta, commitSha }) : Promise.resolve();
	}
}

export const githubMetadataStore = new GitHubMetadataStore();
