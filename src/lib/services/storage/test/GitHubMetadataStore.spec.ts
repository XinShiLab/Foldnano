import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubMetadataStore } from '../stores/GitHubMetadataStore';
import { foldnanoIndexedDb } from '../indexeddb/FoldnanoIndexedDb';

describe('GitHubMetadataStore', () => {
	let store: GitHubMetadataStore;

	beforeEach(() => {
		vi.stubGlobal('indexedDB', {});
		vi.restoreAllMocks();
		vi.spyOn(foldnanoIndexedDb, 'isAvailable').mockReturnValue(true);
		store = new GitHubMetadataStore();
	});

	it('hydrates repo context, file metadata, and backups from IndexedDB', async () => {
		vi.spyOn(foldnanoIndexedDb.githubRepoContexts, 'toArray').mockResolvedValue([
			{ owner: 'alice', repo: 'designs', branch: 'main', repoKey: 'alice/designs' },
		]);
		vi.spyOn(foldnanoIndexedDb.githubFiles, 'toArray').mockResolvedValue([
			{
				docId: 'doc-1',
				path: 'designs/doc-1.json',
				sha: 'sha-1',
				owner: 'alice',
				repo: 'designs',
				branch: 'main',
				lastSyncAt: 123,
				repoKey: 'alice/designs',
			},
		]);
		await store.hydrate();

		expect(store.getRepoContext()).toEqual({
			owner: 'alice',
			repo: 'designs',
			branch: 'main',
		});
		expect(store.getFileMetadata('doc-1')).toEqual({
			path: 'designs/doc-1.json',
			sha: 'sha-1',
			owner: 'alice',
			repo: 'designs',
			branch: 'main',
			lastSyncAt: 123,
		});
	});

	it('computes uncommitted paths from IndexedDB document metadata', async () => {
		vi.spyOn(foldnanoIndexedDb.githubFiles, 'put').mockResolvedValue('doc-clean');
		store.setFileMetadata('doc-dirty', {
			path: 'dirty.json',
			sha: 'sha-dirty',
			owner: 'alice',
			repo: 'designs',
			branch: 'main',
			lastSyncAt: 100,
		});
		store.setFileMetadata('doc-clean', {
			path: 'clean.json',
			sha: 'sha-clean',
			owner: 'alice',
			repo: 'designs',
			branch: 'main',
			lastSyncAt: 300,
		});

		vi.spyOn(foldnanoIndexedDb.documents, 'bulkGet').mockResolvedValue([
			{
				id: 'doc-dirty',
				name: 'Dirty',
				lastModified: 200,
				lastAutoSaved: 200,
				documentUpdatedAt: 200,
				lastLocalPersistAt: 200,
			},
			{
				id: 'doc-clean',
				name: 'Clean',
				lastModified: 250,
				lastAutoSaved: 250,
				documentUpdatedAt: 250,
				lastLocalPersistAt: 250,
			},
		]);

		await expect(store.getUncommittedPaths('alice', 'designs')).resolves.toEqual(
			new Set(['dirty.json'])
		);
	});

	it('finds a doc by path from the in-memory metadata cache', () => {
		vi.spyOn(foldnanoIndexedDb.githubFiles, 'put').mockResolvedValue('doc-42');
		store.setFileMetadata('doc-42', {
			path: 'nested/doc.json',
			sha: 'sha-42',
			owner: 'alice',
			repo: 'designs',
			branch: 'main',
			lastSyncAt: 500,
		});
		expect(store.findDocIdByPath('alice', 'designs', 'nested/doc.json')).toBe('doc-42');
	});
});
