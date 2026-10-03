import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/services/github/api', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/services/github/api')>()),
	getFileContent: vi.fn(),
	putFileContent: vi.fn(),
}));

import * as githubApi from '$lib/services/github/api';
import { GitHubApiError, GitHubConflictError } from '$lib/services/github/api';
import {
	CURRENT_FORMAT_VERSION,
	DocumentFormatError,
	FOLDNANO_FORMAT,
} from '$lib/model/documentFormat';
import { foldnanoIndexedDb } from '../indexeddb/FoldnanoIndexedDb';
import { GitHubStorageProvider } from '../providers/GitHubStorageProvider';
import { githubMetadataStore } from '../stores/GitHubMetadataStore';

const mockGetFileContent = vi.mocked(githubApi.getFileContent);
const mockPutFileContent = vi.mocked(githubApi.putFileContent);

const SAMPLE_SNAPSHOT = { id: 'doc-123', name: 'Test Design', parts: [] };
const SAMPLE_META = {
	path: 'designs/test.fn.json',
	sha: 'abc123',
	owner: 'alice',
	repo: 'designs',
	branch: 'main',
};

describe('GitHubStorageProvider', () => {
	let provider: GitHubStorageProvider;

	beforeEach(() => {
		vi.stubGlobal('localStorage', {
			getItem: vi.fn(),
			setItem: vi.fn(),
			removeItem: vi.fn(),
			clear: vi.fn(),
			key: vi.fn(),
			length: 0,
		});
		vi.stubGlobal('indexedDB', {});
		vi.restoreAllMocks();
		provider = new GitHubStorageProvider();

		vi.spyOn(foldnanoIndexedDb, 'isAvailable').mockReturnValue(true);
		vi.spyOn(foldnanoIndexedDb, 'saveDocument').mockResolvedValue({
			id: 'doc-123',
			name: 'Test Design',
			lastModified: 1,
			lastAutoSaved: 1,
		});
		vi.spyOn(foldnanoIndexedDb, 'loadDocument').mockResolvedValue(null);
		vi.spyOn(foldnanoIndexedDb, 'saveContext').mockResolvedValue();
		vi.spyOn(foldnanoIndexedDb, 'loadContext').mockResolvedValue(null);
		vi.spyOn(foldnanoIndexedDb, 'deleteDocument').mockResolvedValue();
		vi.spyOn(foldnanoIndexedDb, 'getDocumentList').mockResolvedValue([]);

		vi.spyOn(foldnanoIndexedDb.githubRepoContexts, 'put').mockResolvedValue('alice/designs');
		vi.spyOn(foldnanoIndexedDb.githubRepoContexts, 'clear').mockResolvedValue();
		vi.spyOn(foldnanoIndexedDb.githubFiles, 'put').mockResolvedValue('doc-123');
		vi.spyOn(foldnanoIndexedDb.githubFiles, 'delete').mockResolvedValue();

		githubMetadataStore.clearRepoContext();
		githubMetadataStore.clearFileMetadata('doc-123');
		mockGetFileContent.mockReset();
		mockPutFileContent.mockReset();
	});

	it('returns GitHub provider info', () => {
		expect(provider.getProviderInfo()).toEqual({
			name: 'GitHub',
			type: 'github',
			description: 'Store and version design files in a GitHub repository',
		});
	});

	it('saves document snapshots into IndexedDB', async () => {
		await expect(provider.saveDocument('doc-123', SAMPLE_SNAPSHOT)).resolves.toBe(true);
		expect(foldnanoIndexedDb.saveDocument).toHaveBeenCalledWith(
			'doc-123',
			SAMPLE_SNAPSHOT,
			undefined
		);
		expect(mockPutFileContent).not.toHaveBeenCalled();
	});

	it('loads a cached working copy from IndexedDB before falling back to GitHub', async () => {
		vi.mocked(foldnanoIndexedDb.loadDocument).mockResolvedValue(SAMPLE_SNAPSHOT);
		await expect(provider.loadDocument('doc-123')).resolves.toEqual(SAMPLE_SNAPSHOT);
		expect(mockGetFileContent).not.toHaveBeenCalled();
	});

	it('fetches from GitHub and persists to IndexedDB when no cached working copy exists', async () => {
		provider.setFileMetadata('doc-123', SAMPLE_META);
		mockGetFileContent.mockResolvedValue({
			content: btoa(JSON.stringify(SAMPLE_SNAPSHOT)),
			sha: 'new-sha',
			name: 'test.fn.json',
			path: SAMPLE_META.path,
			size: 100,
			type: 'file',
			encoding: 'base64',
			html_url: '',
			download_url: null,
		});

		await expect(provider.loadDocument('doc-123')).resolves.toEqual(SAMPLE_SNAPSHOT);
		expect(foldnanoIndexedDb.saveDocument).toHaveBeenCalledWith(
			'doc-123',
			SAMPLE_SNAPSHOT,
			undefined
		);
		expect(provider.getFileMetadata('doc-123')?.sha).toBe('new-sha');
	});

	it('commits the IndexedDB working copy to GitHub and updates the tracked SHA', async () => {
		vi.mocked(foldnanoIndexedDb.loadDocument).mockResolvedValue(SAMPLE_SNAPSHOT);
		provider.setFileMetadata('doc-123', SAMPLE_META);
		mockPutFileContent.mockResolvedValue({
			content: { name: 'test.fn.json', path: SAMPLE_META.path, sha: 'updated-sha', html_url: '' },
			commit: { sha: 'commit-sha', message: 'save', html_url: '' },
		});

		await expect(provider.commitDocument('doc-123', 'save')).resolves.toBe('commit-sha');
		const [, , , body] = mockPutFileContent.mock.calls[0];
		expect(body.sha).toBe('abc123');
		expect(atob(body.content)).toBe(JSON.stringify(SAMPLE_SNAPSHOT, null, 2));
		expect(provider.getFileMetadata('doc-123')?.sha).toBe('updated-sha');
	});

	it('throws when the working copy is missing from IndexedDB during commit', async () => {
		provider.setFileMetadata('doc-123', SAMPLE_META);
		vi.mocked(foldnanoIndexedDb.loadDocument).mockResolvedValue(null);
		await expect(provider.commitDocument('doc-123', 'save')).rejects.toThrow(
			'Document not found in IndexedDB'
		);
	});

	function mockRemoteFile(snapshot: object): void {
		mockGetFileContent.mockResolvedValue({
			content: btoa(JSON.stringify(snapshot)),
			sha: 'pulled-sha',
			name: 'test.fn.json',
			path: SAMPLE_META.path,
			size: 100,
			type: 'file',
			encoding: 'base64',
			html_url: '',
			download_url: null,
		});
	}

	it('pulls the latest version from GitHub and overwrites the IndexedDB working copy', async () => {
		const pulledSnapshot = { id: 'doc-123', name: 'Pulled Design', parts: [] };
		const upgraded = { ...pulledSnapshot, format: FOLDNANO_FORMAT, formatVersion: 1 };
		provider.setFileMetadata('doc-123', SAMPLE_META);
		mockRemoteFile(pulledSnapshot);

		await expect(provider.pullDocument('doc-123')).resolves.toEqual(upgraded);
		expect(foldnanoIndexedDb.saveDocument).toHaveBeenCalledWith('doc-123', upgraded, {
			backup: {
				reason: 'before_pull',
				github: { owner: 'alice', repo: 'designs', branch: 'main', path: SAMPLE_META.path },
			},
		});
		expect(provider.getFileMetadata('doc-123')?.sha).toBe('pulled-sha');
	});

	it('labels the backup with the reason it was given', async () => {
		provider.setFileMetadata('doc-123', SAMPLE_META);
		mockRemoteFile(SAMPLE_SNAPSHOT);

		await provider.pullDocument('doc-123', 'before_discard');

		expect(vi.mocked(foldnanoIndexedDb.saveDocument).mock.calls[0][2]?.backup?.reason).toBe(
			'before_discard'
		);
	});

	it('fails the pull when the new SHA cannot be stored', async () => {
		provider.setFileMetadata('doc-123', SAMPLE_META);
		mockRemoteFile(SAMPLE_SNAPSHOT);
		vi.mocked(foldnanoIndexedDb.githubFiles.put).mockRejectedValueOnce(new Error('quota'));

		await expect(provider.pullDocument('doc-123')).rejects.toThrow(
			"Couldn't save the GitHub sync state in this browser: quota"
		);
	});

	it('refuses a pulled file from a newer app without touching the working copy', async () => {
		provider.setFileMetadata('doc-123', SAMPLE_META);
		mockRemoteFile({ ...SAMPLE_SNAPSHOT, formatVersion: CURRENT_FORMAT_VERSION + 1 });

		await expect(provider.pullDocument('doc-123')).rejects.toThrow(DocumentFormatError);
		expect(foldnanoIndexedDb.saveDocument).not.toHaveBeenCalled();
		expect(provider.getFileMetadata('doc-123')?.sha).toBe(SAMPLE_META.sha);
	});

	it('saves and loads context from IndexedDB', async () => {
		const context = { sequenceContext: { mode: 'RANDOM' } };
		vi.mocked(foldnanoIndexedDb.loadContext).mockResolvedValue(context);

		await expect(provider.saveContext('doc-123', context)).resolves.toBe(true);
		await expect(provider.loadContext('doc-123')).resolves.toEqual(context);
		expect(foldnanoIndexedDb.saveContext).toHaveBeenCalledWith('doc-123', context);
	});

	it('returns document list from IndexedDB', async () => {
		vi.mocked(foldnanoIndexedDb.getDocumentList).mockResolvedValue([
			{ id: 'doc-123', name: 'Test Design', lastModified: 1, lastAutoSaved: 1 },
		]);
		await expect(provider.getDocumentList()).resolves.toEqual([
			{ id: 'doc-123', name: 'Test Design', lastModified: 1, lastAutoSaved: 1 },
		]);
	});

	it('deletes IndexedDB working copy and clears GitHub metadata', async () => {
		provider.setFileMetadata('doc-123', SAMPLE_META);

		await expect(provider.deleteDocument('doc-123')).resolves.toBe(true);
		expect(foldnanoIndexedDb.deleteDocument).toHaveBeenCalledWith('doc-123');
		expect(provider.getFileMetadata('doc-123')).toBeNull();
	});

	describe('remote state and commit conflicts', () => {
		beforeEach(() => provider.setFileMetadata('doc-123', SAMPLE_META));

		it('reports clean, changed, or unknown instead of guessing clean on errors', async () => {
			mockGetFileContent.mockResolvedValueOnce({ sha: SAMPLE_META.sha } as never);
			await expect(provider.checkRemoteState('doc-123')).resolves.toBe('clean');

			mockGetFileContent.mockResolvedValueOnce({ sha: 'newer' } as never);
			await expect(provider.checkRemoteState('doc-123')).resolves.toBe('changed');

			mockGetFileContent.mockRejectedValueOnce(new Error('offline'));
			vi.spyOn(console, 'warn').mockImplementation(() => {});
			await expect(provider.checkRemoteState('doc-123')).resolves.toBe('unknown');
		});

		it.each([
			[409, 'is at abc but expected def'],
			[422, 'Invalid request. "sha" wasn\'t supplied.'],
		])('turns a %i about the SHA into a conflict', async (status, message) => {
			vi.mocked(foldnanoIndexedDb.loadDocument).mockResolvedValue(SAMPLE_SNAPSHOT);
			mockPutFileContent.mockRejectedValue(new GitHubApiError(message, status));

			await expect(provider.commitDocument('doc-123', 'save')).rejects.toBeInstanceOf(
				GitHubConflictError
			);
		});

		it('keeps other 422 errors as they are', async () => {
			vi.mocked(foldnanoIndexedDb.loadDocument).mockResolvedValue(SAMPLE_SNAPSHOT);
			mockPutFileContent.mockRejectedValue(new GitHubApiError('content is too large', 422));

			await expect(provider.commitDocument('doc-123', 'save')).rejects.toThrow(
				'content is too large'
			);
		});
	});
});
