import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import FoldnanoDocument from '$lib/model/document.svelte';
import { StorageManager } from '$lib/services/storage/StorageManager';
import type { StorageProvider } from '$lib/services/storage/StorageProvider';
import { githubExplorerStateStore, githubMetadataStore } from '$lib/services/storage';
import { githubStorageProvider } from '$lib/services/storage/providers/GitHubStorageProvider';
import type { DocumentMetadata, LocalBackup } from '$lib/services/storage/types';
import { CURRENT_FORMAT_VERSION } from '$lib/model/documentFormat';
import { GitHubConflictError, GitHubNetworkError } from '$lib/services/github/api';
import { EditorDocumentSession } from './EditorDocumentSession.svelte';
import { flushLocks, installFakeLocks } from '$lib/services/test/fakeLockManager';
import {
	FoldnanoIndexedDb,
	foldnanoIndexedDb,
} from '$lib/services/storage/indexeddb/FoldnanoIndexedDb';
import { IndexedDbStorageProvider } from '$lib/services/storage/providers/IndexedDbStorageProvider';

const {
	listBranchesMock,
	createBranchMock,
	getFileContentMock,
	listCommitsMock,
	checkRemoteStateMock,
} = vi.hoisted(() => ({
	listBranchesMock: vi.fn(),
	createBranchMock: vi.fn(),
	getFileContentMock: vi.fn(),
	listCommitsMock: vi.fn(),
	checkRemoteStateMock: vi.fn(),
}));

vi.mock('$lib/services/github/api', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/services/github/api')>()),
	listBranches: listBranchesMock,
	createBranch: createBranchMock,
	getFileContent: getFileContentMock,
	listCommits: listCommitsMock,
	putFileContent: vi.fn(),
	deleteFileContent: vi.fn(),
}));

vi.mock('$lib/services/storage/providers/GitHubStorageProvider', () => ({
	githubStorageProvider: {
		commitDocument: vi.fn(),
		pullDocument: vi.fn(),
		checkRemoteState: checkRemoteStateMock,
	},
}));

class MockStorageProvider implements StorageProvider {
	docs = new Map<string, object>();
	contexts = new Map<string, object>();
	docList: DocumentMetadata[] = [];

	async saveDocument(docId: string, snapshot: object): Promise<boolean> {
		this.docs.set(docId, snapshot);
		const parsed = snapshot as { name?: string };
		const existing = this.docList.find((entry) => entry.id === docId);
		const lastModified = Date.now();
		if (existing) {
			existing.name = parsed.name ?? existing.name;
			existing.lastModified = lastModified;
			existing.lastAutoSaved = lastModified;
		} else {
			this.docList.push({
				id: docId,
				name: parsed.name ?? docId,
				lastModified,
				lastAutoSaved: lastModified,
			});
		}
		return true;
	}

	async loadDocument(docId: string): Promise<object | null> {
		return this.docs.get(docId) ?? null;
	}

	async deleteDocument(docId: string): Promise<boolean> {
		this.docs.delete(docId);
		this.docList = this.docList.filter((entry) => entry.id !== docId);
		return true;
	}

	async saveContext(docId: string, context: object): Promise<boolean> {
		this.contexts.set(docId, context);
		return true;
	}

	async loadContext(docId: string): Promise<object | null> {
		return this.contexts.get(docId) ?? null;
	}

	async getDocumentList() {
		return this.docList;
	}

	getProviderInfo() {
		return { name: 'Mock', type: 'memory' as const, description: 'Mock storage provider' };
	}

	async isAvailable(): Promise<boolean> {
		return true;
	}
}

function makeStorage() {
	const provider = new MockStorageProvider();
	const storage = new StorageManager('memory');
	storage.registerProvider('memory', provider);
	return { storage, provider };
}

function makeSession() {
	const hooks = {
		resetEphemeralEditorState: vi.fn(),
		clearStaleSelectionsAfterReplay: vi.fn(),
		repairActiveRegion: vi.fn(),
		loadPersistedContext: vi.fn().mockResolvedValue(true),
		savePersistedContext: vi.fn().mockResolvedValue(true),
	};
	const session = new EditorDocumentSession(hooks);
	return { session, hooks };
}

describe('EditorDocumentSession', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		githubMetadataStore.clearRepoContext();
		githubExplorerStateStore.saveLocalOnlyEntries('alice', 'designs', []);
		githubExplorerStateStore.saveLocalFolderPaths('alice', 'designs', []);
		checkRemoteStateMock.mockResolvedValue('clean');
	});

	it('adopts an imported document and persists it locally', async () => {
		const { session, hooks } = makeSession();
		const { storage, provider } = makeStorage();
		session.replaceStorageManagerForTesting(storage);

		const imported = new FoldnanoDocument('imported-doc', 'Imported');
		await session.openImportedDocument(imported);

		expect(session.currentDoc.id).toBe('imported-doc');
		expect(provider.docs.has('imported-doc')).toBe(true);
		expect(hooks.resetEphemeralEditorState).toHaveBeenCalled();
		expect(hooks.savePersistedContext).toHaveBeenCalled();
	});

	it('blocks history-driven snapshot persistence when the tab is not the owner', async () => {
		const { session } = makeSession();
		const { storage, provider } = makeStorage();
		session.replaceStorageManagerForTesting(storage);
		session.replaceCurrentDocumentForTesting(new FoldnanoDocument('doc-readonly', 'Readonly'));

		session.historyStack.tx(() => {
			session.currentDoc.addNewPart('HONEYCOMB');
		});
		expect(session.historyStack.autoSaveStatus.hasUnsavedChanges).toBe(true);

		vi.spyOn(session, 'isTabOwner', 'get').mockReturnValue(false);

		const result = await session.historyStack.saveNow();

		expect(result).toEqual({ success: false, savedAt: null });
		expect(provider.docs.has('doc-readonly')).toBe(false);
		expect(session.historyStack.autoSaveStatus.hasUnsavedChanges).toBe(true);
	});

	it('loads a local document and restores GitHub metadata and context hooks', async () => {
		const { session, hooks } = makeSession();
		const { storage, provider } = makeStorage();
		session.replaceStorageManagerForTesting(storage);

		const snapshot = new FoldnanoDocument('doc-local', 'Old Name').toJSON();
		provider.docs.set('doc-local', snapshot);
		provider.docList.push({
			id: 'doc-local',
			name: 'Old Name',
			lastModified: 1234,
			lastAutoSaved: 1234,
		});

		githubMetadataStore.setFileMetadata('doc-local', {
			path: 'designs/renamed.fn.json',
			sha: 'sha-local',
			owner: 'alice',
			repo: 'designs',
			branch: 'main',
			lastSyncAt: 999,
		});

		const ok = await session.loadDocumentFromLocalStorage('doc-local');

		expect(ok).toBe(true);
		expect(session.currentDoc.id).toBe('doc-local');
		expect(session.currentDoc.name).toBe('renamed');
		expect(session.currentFileMetadata?.path).toBe('designs/renamed.fn.json');
		expect(hooks.loadPersistedContext).toHaveBeenCalled();
	});

	it('loads a GitHub document and binds repo/file metadata', async () => {
		const { session } = makeSession();
		const { storage } = makeStorage();
		session.replaceStorageManagerForTesting(storage);

		const snapshot = new FoldnanoDocument('doc-github', 'Remote Doc').toJSON();
		getFileContentMock.mockResolvedValue({
			content: btoa(JSON.stringify(snapshot)),
			sha: 'remote-sha',
		});
		listCommitsMock.mockResolvedValue([{ sha: 'commit-sha' }]);

		const ok = await session.loadDocumentFromGitHub('alice', 'designs', 'remote.fn.json', 'main');

		expect(ok).toBe(true);
		expect(session.currentDoc.id).toBe('doc-github');
		expect(session.currentFileMetadata).toMatchObject({
			path: 'remote.fn.json',
			sha: 'remote-sha',
			owner: 'alice',
			repo: 'designs',
			branch: 'main',
			commitSha: 'commit-sha',
		});
	});

	it('names a GitHub document after its file path, not the stale name inside the JSON', async () => {
		const { session } = makeSession();
		const { storage } = makeStorage();
		session.replaceStorageManagerForTesting(storage);

		// An explorer rename copies the file verbatim, so the JSON still holds the old name.
		const snapshot = new FoldnanoDocument('doc-stale-name', 'Old Name').toJSON();
		getFileContentMock.mockResolvedValue({
			content: btoa(JSON.stringify(snapshot)),
			sha: 'remote-sha',
		});
		listCommitsMock.mockResolvedValue([]);

		await session.loadDocumentFromGitHub('alice', 'designs', 'designs/new-name.fn.json', 'main');

		expect(session.currentDoc.name).toBe('new-name');
	});

	it('keeps the path-derived name when pulling the current file from GitHub', async () => {
		const { session } = makeSession();
		const { storage } = makeStorage();
		session.replaceStorageManagerForTesting(storage);
		session.replaceCurrentDocumentForTesting(new FoldnanoDocument('doc-pull-name', 'new-name'));
		session.bindCurrentDocumentToGitHubFile({
			path: 'designs/new-name.fn.json',
			sha: 'sha-1',
			owner: 'alice',
			repo: 'designs',
			branch: 'main',
			lastSyncAt: 1,
		});
		vi.mocked(githubStorageProvider.pullDocument).mockResolvedValue(
			new FoldnanoDocument('doc-pull-name', 'Old Name').toJSON()
		);
		listCommitsMock.mockResolvedValue([]);

		const ok = await session.pullCurrentDocFromGitHub();

		expect(ok).toBe(true);
		expect(session.currentDoc.name).toBe('new-name');
	});

	it('commits local over a changed GitHub file against the SHA GitHub has now', async () => {
		const { session } = makeSession();
		const { storage } = makeStorage();
		session.replaceStorageManagerForTesting(storage);
		session.replaceCurrentDocumentForTesting(new FoldnanoDocument('doc-keep', 'k'));
		session.bindCurrentDocumentToGitHubFile({
			path: 'k.fn.json',
			sha: 'stale-sha',
			owner: 'alice',
			repo: 'designs',
			branch: 'main',
		});
		getFileContentMock.mockResolvedValue({ sha: 'remote-sha', content: '' });
		vi.mocked(githubStorageProvider.commitDocument).mockImplementation(async () => {
			expect(session.currentFileMetadata?.sha).toBe('remote-sha');
			return 'commit-sha';
		});

		await expect(session.overwriteGitHubWithLocal('keep mine')).resolves.toBe('commit-sha');

		expect(githubStorageProvider.commitDocument).toHaveBeenCalledWith(
			'doc-keep',
			'keep mine',
			expect.anything()
		);
	});

	it('keeps the design marked as not committed when a commit fails with an expired session', async () => {
		const { session } = makeSession();
		const { storage } = makeStorage();
		session.replaceStorageManagerForTesting(storage);
		session.replaceCurrentDocumentForTesting(new FoldnanoDocument('doc-401', 'x'));
		session.bindCurrentDocumentToGitHubFile({
			path: 'x.fn.json',
			sha: 'sha-1',
			owner: 'alice',
			repo: 'designs',
			branch: 'main',
			lastSyncAt: 1,
		});
		session.historyStack.tx(() => {
			session.currentDoc.addNewPart('HONEYCOMB');
		});
		vi.mocked(githubStorageProvider.commitDocument).mockRejectedValue(
			Object.assign(new Error('Your GitHub session has expired.'), { status: 401 })
		);

		await expect(session.commitCurrentDocToGitHub('save')).rejects.toThrow('expired');

		expect(session.hasUncommittedGitHubChanges).toBe(true);
		expect(session.currentFileMetadata?.sha).toBe('sha-1');
	});

	function bindGitHubFile(session: EditorDocumentSession, docId: string) {
		session.replaceCurrentDocumentForTesting(new FoldnanoDocument(docId, 'g'));
		session.bindCurrentDocumentToGitHubFile({
			path: 'g.fn.json',
			sha: 'sha-1',
			owner: 'alice',
			repo: 'designs',
			branch: 'main',
			lastSyncAt: 1,
		});
	}

	it('reports a failed GitHub check as unknown instead of up to date', async () => {
		const { session } = makeSession();
		session.replaceStorageManagerForTesting(makeStorage().storage);
		bindGitHubFile(session, 'doc-check');

		checkRemoteStateMock.mockResolvedValueOnce('changed');
		session.recheckRemote();
		await vi.waitFor(() => expect(session.remoteAheadOfLocal).toBe(true));

		checkRemoteStateMock.mockResolvedValueOnce('unknown');
		session.recheckRemote();
		await vi.waitFor(() => expect(session.remoteCheckFailed).toBe(true));
		expect(session.remoteAheadOfLocal).toBe(true);

		checkRemoteStateMock.mockResolvedValueOnce('clean');
		session.recheckRemote();
		await vi.waitFor(() => expect(session.remoteCheckFailed).toBe(false));
		expect(session.remoteAheadOfLocal).toBe(false);
	});

	it('shows GitHub as not checked when going offline or when a commit cannot reach it', async () => {
		const { session } = makeSession();
		session.replaceStorageManagerForTesting(makeStorage().storage);
		session.markRemoteUnchecked();
		expect(session.remoteCheckFailed).toBe(false); // no GitHub file open

		bindGitHubFile(session, 'doc-offline');
		session.markRemoteUnchecked();
		expect(session.remoteCheckFailed).toBe(true);

		checkRemoteStateMock.mockResolvedValueOnce('clean');
		session.recheckRemote();
		await vi.waitFor(() => expect(session.remoteCheckFailed).toBe(false));

		vi.mocked(githubStorageProvider.commitDocument).mockRejectedValue(new GitHubNetworkError());
		await expect(session.commitCurrentDocToGitHub('save')).rejects.toBeInstanceOf(
			GitHubNetworkError
		);
		expect(session.remoteCheckFailed).toBe(true);
	});

	it('marks GitHub as ahead when a commit is refused for a stale SHA', async () => {
		const { session } = makeSession();
		session.replaceStorageManagerForTesting(makeStorage().storage);
		bindGitHubFile(session, 'doc-stale');
		vi.mocked(githubStorageProvider.commitDocument).mockRejectedValue(new GitHubConflictError());

		await expect(session.commitCurrentDocToGitHub('save')).rejects.toBeInstanceOf(
			GitHubConflictError
		);

		expect(session.remoteAheadOfLocal).toBe(true);
	});

	it('passes the backup reason through to the pull (discard labels its backup)', async () => {
		const { session } = makeSession();
		const { storage } = makeStorage();
		session.replaceStorageManagerForTesting(storage);
		session.replaceCurrentDocumentForTesting(new FoldnanoDocument('doc-discard', 'd'));
		session.bindCurrentDocumentToGitHubFile({
			path: 'd.fn.json',
			sha: 'sha-1',
			owner: 'alice',
			repo: 'designs',
			branch: 'main',
			lastSyncAt: 1,
		});
		vi.mocked(githubStorageProvider.pullDocument).mockResolvedValue(
			new FoldnanoDocument('doc-discard', 'd').toJSON()
		);
		listCommitsMock.mockResolvedValue([]);

		await expect(session.pullCurrentDocFromGitHub('before_discard')).resolves.toBe(true);

		expect(githubStorageProvider.pullDocument).toHaveBeenCalledWith(
			'doc-discard',
			'before_discard'
		);
	});

	it('blocks branch switching when there are uncommitted repo changes', async () => {
		const { session } = makeSession();
		const { storage } = makeStorage();
		session.replaceStorageManagerForTesting(storage);

		githubMetadataStore.setRepoContext({ owner: 'alice', repo: 'designs', branch: 'main' });
		session.refreshGitHubStateFromStore();
		vi.spyOn(githubMetadataStore, 'getUncommittedPaths').mockResolvedValue(
			new Set(['designs/current.fn.json'])
		);

		await expect(session.switchToBranch('feature')).rejects.toThrow(
			/Commit, publish, or discard changes first/
		);
	});

	it('blocks branch switching when unpublished local-only files or folders exist', async () => {
		const { session } = makeSession();
		const { storage } = makeStorage();
		session.replaceStorageManagerForTesting(storage);

		githubMetadataStore.setRepoContext({ owner: 'alice', repo: 'designs', branch: 'main' });
		session.refreshGitHubStateFromStore();
		githubExplorerStateStore.saveLocalOnlyEntries('alice', 'designs', [
			{
				docId: 'doc-local-only',
				path: 'drafts/local.fn.json',
				name: 'local.fn.json',
			},
		]);
		githubExplorerStateStore.saveLocalFolderPaths('alice', 'designs', ['drafts/new-folder']);
		vi.spyOn(githubMetadataStore, 'getUncommittedPaths').mockResolvedValue(new Set());

		await expect(session.switchToBranch('feature')).rejects.toThrow(
			/Commit, publish, or discard changes first:\n• drafts\/local\.fn\.json\n• drafts\/new-folder/
		);
	});

	it('clears the current file binding when a branch switch cannot reload the file', async () => {
		const { session } = makeSession();
		const { storage } = makeStorage();
		session.replaceStorageManagerForTesting(storage);

		session.replaceCurrentDocumentForTesting(new FoldnanoDocument('doc-switch', 'Switch'));
		githubMetadataStore.setRepoContext({ owner: 'alice', repo: 'designs', branch: 'main' });
		session.bindCurrentDocumentToGitHubFile({
			path: 'switch.fn.json',
			sha: 'sha-switch',
			owner: 'alice',
			repo: 'designs',
			branch: 'main',
		});

		vi.spyOn(githubMetadataStore, 'getUncommittedPaths').mockResolvedValue(new Set());
		const loadSpy = vi.spyOn(session, 'loadDocumentFromGitHub').mockResolvedValue(false);

		const result = await session.switchToBranch('feature');

		expect(loadSpy).toHaveBeenCalledWith('alice', 'designs', 'switch.fn.json', 'feature', {
			reason: 'before_branch_reload',
			github: { owner: 'alice', repo: 'designs', branch: 'main', path: 'switch.fn.json' },
		});
		expect(result).toEqual({ reloaded: false, fileMissing: true });
		expect(session.currentFileMetadata).toBeNull();
	});

	it('retargets cached GitHub metadata for the repo during branch switch', async () => {
		const { session } = makeSession();
		const { storage } = makeStorage();
		session.replaceStorageManagerForTesting(storage);

		session.replaceCurrentDocumentForTesting(new FoldnanoDocument('doc-current', 'Current'));
		githubMetadataStore.setRepoContext({ owner: 'alice', repo: 'designs', branch: 'main' });
		session.bindCurrentDocumentToGitHubFile({
			path: 'current.fn.json',
			sha: 'sha-current',
			owner: 'alice',
			repo: 'designs',
			branch: 'main',
		});
		githubMetadataStore.setFileMetadata('doc-cached', {
			path: 'cached.fn.json',
			sha: 'sha-cached',
			owner: 'alice',
			repo: 'designs',
			branch: 'main',
			lastSyncAt: 123,
		});

		vi.spyOn(githubMetadataStore, 'getUncommittedPaths').mockResolvedValue(new Set());
		vi.spyOn(session, 'loadDocumentFromGitHub').mockResolvedValue(true);

		const result = await session.switchToBranch('feature');

		expect(result).toEqual({ reloaded: true, fileMissing: false });
		expect(session.currentRepoContext?.branch).toBe('feature');
		expect(session.currentFileMetadata?.branch).toBe('feature');
		expect(githubMetadataStore.getFileMetadata('doc-cached')?.branch).toBe('feature');
	});

	it('updates the current file binding and document name for external renames', () => {
		const { session } = makeSession();
		session.replaceCurrentDocumentForTesting(new FoldnanoDocument('doc-rename', 'Before'));
		session.bindCurrentDocumentToGitHubFile({
			path: 'before.fn.json',
			sha: 'sha-before',
			owner: 'alice',
			repo: 'designs',
			branch: 'main',
		});

		session.applyExternalCurrentFileRename('before.fn.json', 'after.fn.json', { clearSha: true });

		expect(session.currentFileMetadata?.path).toBe('after.fn.json');
		expect(session.currentFileMetadata?.sha).toBe('');
		expect(session.currentDoc.name).toBe('after');
	});

	it('keeps dots in file names when renaming and deriving the document name', () => {
		const { session } = makeSession();
		session.replaceCurrentDocumentForTesting(new FoldnanoDocument('doc-dots', 'Before'));
		session.bindCurrentDocumentToGitHubFile({
			path: 'v1.0/before.fn.json',
			sha: 'sha-before',
			owner: 'alice',
			repo: 'designs',
			branch: 'main',
		});

		session.applyExternalCurrentFileRename('v1.0/before.fn.json', 'v1.0/origami.v2.fn.json');

		expect(session.currentDoc.name).toBe('origami.v2');
	});

	it('names an imported part after its new document', async () => {
		const { session } = makeSession();
		const { storage } = makeStorage();
		session.replaceStorageManagerForTesting(storage);
		const part = new FoldnanoDocument().addNewPart('HONEYCOMB');
		part.name = 'Hilbert_FinalHC.json';

		const { path } = await session.createDocumentFromImportedPart(part, 'Hilbert', 'designs');

		expect(path).toBe('designs/Hilbert.fn.json');
		expect(session.currentDoc.name).toBe('Hilbert');
		expect(session.currentDoc.parts[0].name).toBe('Hilbert');
	});

	it('renames local-only files by doc id and returns a local-only rename result', async () => {
		const { session } = makeSession();
		const { storage } = makeStorage();
		session.replaceStorageManagerForTesting(storage);
		session.replaceCurrentDocumentForTesting(new FoldnanoDocument('doc-local-only', 'Before'));
		githubMetadataStore.setRepoContext({ owner: 'alice', repo: 'designs', branch: 'main' });
		session.refreshGitHubStateFromStore();
		githubExplorerStateStore.saveLocalOnlyEntries('alice', 'designs', [
			{
				docId: 'doc-local-only',
				path: 'folder/before.fn.json',
				name: 'before.fn.json',
			},
		]);

		const result = await session.renameDocument('After');

		expect(result).toEqual({
			kind: 'local-only-file-renamed',
			oldPath: 'folder/before.fn.json',
			newPath: 'folder/After.fn.json',
			filename: 'After.fn.json',
		});
		expect(session.currentDoc.name).toBe('After');
		expect(githubExplorerStateStore.getLocalOnlyEntries('alice', 'designs')).toEqual([
			{
				docId: 'doc-local-only',
				path: 'folder/After.fn.json',
				name: 'After.fn.json',
			},
		]);
	});

	it('disconnects GitHub without discarding the local document', () => {
		const { session } = makeSession();
		session.replaceCurrentDocumentForTesting(new FoldnanoDocument('doc-disconnect', 'Keep Me'));
		githubMetadataStore.setRepoContext({ owner: 'alice', repo: 'designs', branch: 'main' });
		session.bindCurrentDocumentToGitHubFile({
			path: 'keep.fn.json',
			sha: 'sha-keep',
			owner: 'alice',
			repo: 'designs',
			branch: 'main',
		});

		session.disconnectGitHub();

		expect(session.currentDoc.name).toBe('Keep Me');
		expect(session.currentRepoContext).toBeNull();
		expect(session.currentFileMetadata).toBeNull();
	});

	it('creates and switches to a new branch while retargeting current metadata', async () => {
		const { session } = makeSession();
		session.replaceCurrentDocumentForTesting(new FoldnanoDocument('doc-branch', 'Branch Doc'));
		githubMetadataStore.setRepoContext({ owner: 'alice', repo: 'designs', branch: 'main' });
		session.bindCurrentDocumentToGitHubFile({
			path: 'branch.fn.json',
			sha: 'sha-branch',
			owner: 'alice',
			repo: 'designs',
			branch: 'main',
		});

		listBranchesMock.mockResolvedValue([{ name: 'main', commit: { sha: 'base-sha' } }]);
		createBranchMock.mockResolvedValue({});

		await session.createAndSwitchBranch('feature');

		expect(createBranchMock).toHaveBeenCalledWith('alice', 'designs', 'feature', 'base-sha');
		expect(session.currentRepoContext?.branch).toBe('feature');
		expect(session.currentFileMetadata?.branch).toBe('feature');
	});

	it('rebinds tab sync when resetting to a blank document', async () => {
		const { session } = makeSession();
		const { storage } = makeStorage();
		session.replaceStorageManagerForTesting(storage);

		const { locks, uninstall } = installFakeLocks();
		try {
			await session.openImportedDocument(new FoldnanoDocument('doc-tabsync', 'Tabsync'));
			await flushLocks();
			expect(locks.heldNames()).toEqual(['foldnano-editor-doc-tabsync']);

			session.resetToBlankDocument();
			await flushLocks();

			expect(locks.heldNames()).toEqual([`foldnano-editor-${session.currentDoc.id}`]);
			expect(session.currentDoc.id).not.toBe('doc-tabsync');
			expect(session.isTabOwner).toBe(true);
		} finally {
			session.destroy();
			uninstall();
		}
	});

	it('reloads the saved copy when it regains a document another tab edited', async () => {
		const { uninstall } = installFakeLocks();
		const { storage } = makeStorage();
		const tabA = makeSession().session;
		const tabB = makeSession().session;
		tabA.replaceStorageManagerForTesting(storage);
		tabB.replaceStorageManagerForTesting(storage);
		try {
			await tabA.openImportedDocument(new FoldnanoDocument('doc-shared', 'Original'));
			await flushLocks();
			await tabB.loadDocumentFromLocalStorage('doc-shared');
			await flushLocks();
			expect(tabA.isTabOwner).toBe(false);
			expect(tabB.isTabOwner).toBe(true);

			await tabB.renameDocument('Edited in tab B');
			tabB.destroy();
			await flushLocks();

			// Without the reload, tab A's next save would overwrite tab B's work with its stale copy.
			expect(tabA.isTabOwner).toBe(true);
			expect(tabA.currentDoc.name).toBe('Edited in tab B');
		} finally {
			tabA.destroy();
			tabB.destroy();
			uninstall();
		}
	});
});

class BackupMockProvider extends MockStorageProvider {
	backups: LocalBackup[] = [];
	saveOptions: unknown[] = [];

	override async saveDocument(docId: string, snapshot: object, options?: unknown) {
		this.saveOptions.push(options);
		return super.saveDocument(docId, snapshot);
	}

	async getLocalBackups(): Promise<LocalBackup[]> {
		return this.backups;
	}
}

describe('EditorDocumentSession document recovery', () => {
	const MANGLED = { id: 'doc-bad', name: 'Broken design', parts: [{ name: 'p', id: 'p1' }] };

	function makeRecoverySession() {
		const { session } = makeSession();
		const provider = new BackupMockProvider();
		const storage = new StorageManager('memory');
		storage.registerProvider('memory', provider);
		session.replaceStorageManagerForTesting(storage);
		return { session, provider };
	}

	it('reports an unreadable snapshot as a load failure and leaves the data untouched', async () => {
		const { session, provider } = makeRecoverySession();
		provider.docs.set('doc-bad', MANGLED);

		await expect(session.loadDocumentFromLocalStorage('doc-bad')).resolves.toBe(false);

		expect(session.loadFailure).toMatchObject({
			docId: 'doc-bad',
			name: 'Broken design',
			reason: 'error',
		});
		expect(session.currentDoc.id).not.toBe('doc-bad');
		expect(provider.docs.get('doc-bad')).toBe(MANGLED);
		await expect(session.loadRawDocument('doc-bad')).resolves.toBe(MANGLED);
		session.destroy();
	});

	it('reports a file from a newer app as too-new', async () => {
		const { session, provider } = makeRecoverySession();
		provider.docs.set('doc-new', {
			id: 'doc-new',
			name: 'Future',
			formatVersion: CURRENT_FORMAT_VERSION + 1,
			parts: [],
		});

		await session.loadDocumentFromLocalStorage('doc-new');

		expect(session.loadFailure?.reason).toBe('too-new');
		session.destroy();
	});

	it('does not report a missing document as a load failure', async () => {
		const { session } = makeRecoverySession();

		await expect(session.loadDocumentFromLocalStorage('nope')).resolves.toBe(false);

		expect(session.loadFailure).toBeNull();
		session.destroy();
	});

	it('lists backups newest first, flags unreadable ones, and restores a readable one', async () => {
		const { session, provider } = makeRecoverySession();
		provider.docs.set('doc-bad', MANGLED);
		const good = new FoldnanoDocument('doc-bad', 'Broken design').toJSON();
		provider.backups = [
			{ id: 'b-old', docId: 'doc-bad', createdAt: 1000, reason: 'periodic', snapshot: good },
			{
				id: 'b-new',
				docId: 'doc-bad',
				createdAt: 2000,
				reason: 'before_pull',
				github: { owner: 'alice', repo: 'designs', branch: 'main', path: 'a.fn.json' },
				snapshot: MANGLED,
			},
		];
		await session.loadDocumentFromLocalStorage('doc-bad');

		const backups = await session.listBackups('doc-bad');

		expect(backups.map((b) => [b.id, b.readable, b.label, b.detail])).toEqual([
			['b-new', false, 'Before pulling from GitHub', 'main · a.fn.json'],
			['b-old', true, 'Automatic backup', null],
		]);
		await expect(session.restoreBackup('doc-bad', backups[0])).resolves.toBe('not-allowed');

		await expect(session.restoreBackup('doc-bad', backups[1])).resolves.toBe('restored');

		expect(provider.saveOptions).toContainEqual({
			backup: { reason: 'before_restore', github: undefined },
		});
		expect(session.loadFailure).toBeNull();
		expect(session.currentDoc.id).toBe('doc-bad');
		session.destroy();
	});
});

describe('EditorDocumentSession recovery restore through IndexedDB', () => {
	it('restores a backup handed in as a proxy (reactive UI state)', async () => {
		const db = new FoldnanoIndexedDb(`test-recovery-${crypto.randomUUID()}`);
		const { session } = makeSession();
		const storage = new StorageManager('indexedDB');
		storage.registerProvider('indexedDB', new IndexedDbStorageProvider(db));
		session.replaceStorageManagerForTesting(storage);
		await db.saveDocument('doc-bad', { id: 'doc-bad', name: 'Broken', parts: [{ id: 'p' }] });
		const good = new FoldnanoDocument('doc-bad', 'Broken').toJSON();
		const backup = {
			id: 'b1',
			reason: 'periodic' as const,
			label: 'Automatic backup',
			detail: null,
			createdAt: 1000,
			snapshot: new Proxy(good, {}),
			readable: true,
		};

		await expect(session.restoreBackup('doc-bad', backup)).resolves.toBe('restored');

		expect(session.currentDoc.id).toBe('doc-bad');
		const kept = await db.getLocalBackups('doc-bad');
		expect(kept[0]).toMatchObject({ reason: 'before_restore' });
		expect(kept[0].snapshot).toMatchObject({ name: 'Broken', parts: [{ id: 'p' }] });
		session.destroy();
		await db.delete();
	});

	async function openSessionOn(db: FoldnanoIndexedDb, doc: FoldnanoDocument) {
		const { session } = makeSession();
		const storage = new StorageManager('indexedDB');
		storage.registerProvider('indexedDB', new IndexedDbStorageProvider(db));
		session.replaceStorageManagerForTesting(storage);
		await db.saveDocument(doc.id, doc.toJSON());
		await session.loadDocumentFromLocalStorage(doc.id);
		return session;
	}

	it('keeps unsaved edits of the open design in the backup taken before restoring', async () => {
		const db = new FoldnanoIndexedDb(`test-restore-open-${crypto.randomUUID()}`);
		const session = await openSessionOn(db, new FoldnanoDocument('doc-open', 'Open design'));
		const older = new FoldnanoDocument('doc-open', 'Older').toJSON();
		session.historyStack.tx(() => {
			session.currentDoc.addNewPart('HONEYCOMB');
		});
		expect(session.hasUnsavedLocalChanges).toBe(true);

		const result = await session.restoreBackup('doc-open', {
			id: 'b1',
			reason: 'periodic',
			label: 'Automatic backup',
			detail: null,
			createdAt: 1,
			snapshot: older,
			readable: true,
		});

		expect(result).toBe('restored');
		expect(session.currentDoc.name).toBe('Older');
		const [newest] = await db.getLocalBackups('doc-open');
		expect(newest).toMatchObject({ reason: 'before_restore' });
		expect((newest.snapshot as { parts: unknown[] }).parts).toHaveLength(1);
		session.destroy();
		await db.delete();
	});

	it('keeps the replaced copy when a hand-resolved conflict is applied', async () => {
		const db = new FoldnanoIndexedDb(`test-resolve-${crypto.randomUUID()}`);
		const session = await openSessionOn(db, new FoldnanoDocument('doc-c', 'Mine'));
		const resolved = new FoldnanoDocument('doc-c', 'Resolved').toJSON();

		await expect(session.applyResolvedConflict('doc-c', resolved)).resolves.toBe(true);

		expect(session.currentDoc.name).toBe('Resolved');
		const [newest] = await db.getLocalBackups('doc-c');
		expect(newest).toMatchObject({ reason: 'before_conflict_resolve' });
		expect(newest.snapshot).toMatchObject({ name: 'Mine' });
		session.destroy();
		await db.delete();
	});
});

describe('EditorDocumentSession GitHub dirty detection', () => {
	it('keeps a design uncommitted when autosave runs while the commit uploads', async () => {
		// Earlier tests stub this; this one needs the real comparison.
		vi.spyOn(githubMetadataStore, 'getUncommittedPaths').mockRestore();
		const { session } = makeSession();
		const storage = new StorageManager('indexedDB');
		storage.registerProvider('indexedDB', new IndexedDbStorageProvider());
		session.replaceStorageManagerForTesting(storage);
		const doc = new FoldnanoDocument('doc-race', 'race');
		await foldnanoIndexedDb.saveDocument(doc.id, doc.toJSON());
		await session.loadDocumentFromLocalStorage(doc.id);
		session.bindCurrentDocumentToGitHubFile({
			path: 'race.fn.json',
			sha: 'sha-1',
			owner: 'alice',
			repo: 'designs',
			branch: 'main',
			lastSyncAt: 1,
		});
		session.historyStack.tx(() => {
			session.currentDoc.addNewPart('HONEYCOMB');
		});
		vi.mocked(githubStorageProvider.commitDocument).mockImplementation(async () => {
			// An edit and an autosave land while the upload is still in flight.
			session.historyStack.tx(() => {
				session.currentDoc.addNewPart('SQUARE');
			});
			await session.historyStack.saveNow();
			return 'commit-sha';
		});

		await session.commitCurrentDocToGitHub('save');

		await vi.waitFor(() => expect(session.hasUncommittedGitHubChanges).toBe(true));
		expect(await githubMetadataStore.getUncommittedPaths('alice', 'designs')).toContain(
			'race.fn.json'
		);
		session.destroy();
		githubMetadataStore.clearFileMetadata(doc.id);
		await foldnanoIndexedDb.deleteDocument(doc.id);
	});
});
