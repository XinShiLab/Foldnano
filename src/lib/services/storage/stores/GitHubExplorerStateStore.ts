import { foldnanoIndexedDb } from '../indexeddb/FoldnanoIndexedDb';

export interface GitHubLocalOnlyEntry {
	docId: string;
	path: string;
	name: string;
}

function repoKey(owner: string, repo: string): string {
	return `${owner}/${repo}`;
}

export class GitHubExplorerStateStore {
	private hydrated = false;
	private localOnlyByRepoKey = new Map<string, GitHubLocalOnlyEntry[]>();
	private localFoldersByRepoKey = new Map<string, string[]>();

	private canUseIndexedDb(): boolean {
		return foldnanoIndexedDb.isAvailable();
	}

	async hydrate(): Promise<void> {
		if (this.hydrated) return;

		this.localOnlyByRepoKey = new Map();
		this.localFoldersByRepoKey = new Map();

		if (this.canUseIndexedDb()) {
			try {
				const [entries, folders] = await Promise.all([
					foldnanoIndexedDb.localOnlyEntries.toArray(),
					foldnanoIndexedDb.localFolderEntries.toArray(),
				]);
				for (const entry of entries) {
					const list = this.localOnlyByRepoKey.get(entry.repoKey) ?? [];
					list.push({ docId: entry.docId, path: entry.path, name: entry.name });
					this.localOnlyByRepoKey.set(entry.repoKey, list);
				}
				for (const folder of folders) {
					const list = this.localFoldersByRepoKey.get(folder.repoKey) ?? [];
					list.push(folder.path);
					this.localFoldersByRepoKey.set(folder.repoKey, list);
				}
				this.hydrated = true;
				return;
			} catch (e) {
				console.error('[GitHubExplorerStateStore] IndexedDB hydrate failed:', e);
			}
		}
		this.hydrated = true;
	}

	getLocalOnlyEntries(owner: string, repo: string): GitHubLocalOnlyEntry[] {
		const key = repoKey(owner, repo);
		return this.localOnlyByRepoKey.get(key) ?? [];
	}

	saveLocalOnlyEntries(owner: string, repo: string, entries: GitHubLocalOnlyEntry[]): void {
		const key = repoKey(owner, repo);
		this.hydrated = true;
		this.localOnlyByRepoKey.set(key, entries);
		if (this.canUseIndexedDb()) {
			void foldnanoIndexedDb
				.transaction('rw', foldnanoIndexedDb.localOnlyEntries, async () => {
					await foldnanoIndexedDb.localOnlyEntries.where('repoKey').equals(key).delete();
					if (entries.length > 0) {
						await foldnanoIndexedDb.localOnlyEntries.bulkPut(
							entries.map((entry) => ({ ...entry, repoKey: key }))
						);
					}
				})
				.catch((e) => {
					console.error(
						'[GitHubExplorerStateStore] Failed to persist local-only entries to IndexedDB:',
						e
					);
				});
		}
	}

	addLocalOnlyEntry(owner: string, repo: string, entry: GitHubLocalOnlyEntry): void {
		const entries = this.getLocalOnlyEntries(owner, repo);
		if (!entries.find((existing) => existing.docId === entry.docId)) {
			this.saveLocalOnlyEntries(owner, repo, [...entries, entry]);
		}
	}

	removeLocalOnlyEntryByDocId(docId: string): void {
		for (const [repoKey, entries] of this.localOnlyByRepoKey.entries()) {
			const filtered = entries.filter((entry) => entry.docId !== docId);
			if (filtered.length === entries.length) continue;
			const [owner, repo] = repoKey.split('/', 2);
			this.saveLocalOnlyEntries(owner, repo, filtered);
		}
	}

	getLocalFolderPaths(owner: string, repo: string): string[] {
		const key = repoKey(owner, repo);
		return this.localFoldersByRepoKey.get(key) ?? [];
	}

	saveLocalFolderPaths(owner: string, repo: string, paths: string[]): void {
		const key = repoKey(owner, repo);
		this.hydrated = true;
		this.localFoldersByRepoKey.set(key, paths);
		if (this.canUseIndexedDb()) {
			void foldnanoIndexedDb
				.transaction('rw', foldnanoIndexedDb.localFolderEntries, async () => {
					await foldnanoIndexedDb.localFolderEntries.where('repoKey').equals(key).delete();
					if (paths.length > 0) {
						await foldnanoIndexedDb.localFolderEntries.bulkPut(
							paths.map((path) => ({ repoKey: key, path }))
						);
					}
				})
				.catch((e) => {
					console.error(
						'[GitHubExplorerStateStore] Failed to persist local folder paths to IndexedDB:',
						e
					);
				});
		}
	}

	addLocalFolderPath(owner: string, repo: string, path: string): void {
		const paths = this.getLocalFolderPaths(owner, repo);
		if (!paths.includes(path)) {
			this.saveLocalFolderPaths(owner, repo, [...paths, path]);
		}
	}
}

export const githubExplorerStateStore = new GitHubExplorerStateStore();
