import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import FoldnanoDocument from '$lib/model/document.svelte';
import { StorageManager } from '$lib/services/storage/StorageManager';
import type { StorageProvider } from '$lib/services/storage/StorageProvider';
import { githubExplorerStateStore, githubMetadataStore } from '$lib/services/storage';
import { githubStorageProvider } from '$lib/services/storage/providers/GitHubStorageProvider';
import type { DocumentMetadata, LocalBackup } from '$lib/services/storage/types';
import { CURRENT_FORMAT_VERSION } from '$lib/model/documentFormat';
import {
	GitHubApiError,
	GitHubConflictError,
	GitHubNetworkError,
	deleteFileContent,
} from '$lib/services/github/api';
import { TabSync } from '$lib/services/tabSync.svelte';
import {
	EditorDocumentSession,
	type SameDesignAnswer,
	type SameDesignQuestion,
} from './EditorDocumentSession.svelte';
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
	getRepoTreeMock,
} = vi.hoisted(() => ({
	listBranchesMock: vi.fn(),
	createBranchMock: vi.fn(),
	getFileContentMock: vi.fn(),
	listCommitsMock: vi.fn(),
	checkRemoteStateMock: vi.fn(),
	getRepoTreeMock: vi.fn(),
}));

vi.mock('$lib/services/github/api', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/services/github/api')>()),
	listBranches: listBranchesMock,
	createBranch: createBranchMock,
	getFileContent: getFileContentMock,
	listCommits: listCommitsMock,
	getRepoTree: getRepoTreeMock,
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

	async rekeyDocument(oldId: string, newId: string): Promise<boolean> {
		const snapshot = this.docs.get(oldId);
		if (!snapshot || this.docs.has(newId)) return false;
		this.docs.set(newId, { ...snapshot, id: newId });
		this.docs.delete(oldId);
		const context = this.contexts.get(oldId);
		if (context) this.contexts.set(newId, context);
		this.contexts.delete(oldId);
		for (const entry of this.docList) if (entry.id === oldId) entry.id = newId;
		return true;
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

function makeSession(
	chooseSameDesignAction?: (question: SameDesignQuestion) => Promise<SameDesignAnswer>
) {
	const hooks = {
		resetEphemeralEditorState: vi.fn(),
		clearStaleSelectionsAfterReplay: vi.fn(),
		repairActiveRegion: vi.fn(),
		loadPersistedContext: vi.fn().mockResolvedValue(true),
		savePersistedContext: vi.fn().mockResolvedValue(true),
		chooseSameDesignAction,
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
		getRepoTreeMock.mockResolvedValue({ sha: 't', url: '', tree: [], truncated: false });
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

	it('imports a file whose id is already saved locally as a copy, leaving the saved design', async () => {
		const { session } = makeSession();
		const { storage, provider } = makeStorage();
		session.replaceStorageManagerForTesting(storage);
		const saved = new FoldnanoDocument('doc-taken', 'Saved');
		saved.addNewPart('HONEYCOMB');
		await provider.saveDocument('doc-taken', saved.toJSON());

		await session.openImportedDocument(new FoldnanoDocument('doc-taken', 'Re-imported'));

		expect(session.currentDoc.id).not.toBe('doc-taken');
		expect(session.currentDoc.name).toBe('Re-imported');
		expect(provider.docs.has(session.currentDoc.id)).toBe(true);
		const stillSaved = provider.docs.get('doc-taken') as { name: string; parts: unknown[] };
		expect(stillSaved.name).toBe('Saved');
		expect(stillSaved.parts).toHaveLength(1);
	});

	it('replaces the saved design on request, keeping a backup and its GitHub link', async () => {
		const { session } = makeSession();
		const { storage, provider } = makeStorage();
		session.replaceStorageManagerForTesting(storage);
		await provider.saveDocument('doc-replace', new FoldnanoDocument('doc-replace', 'Old').toJSON());
		const meta = {
			path: 'designs/old.fn.json',
			sha: 'sha-old',
			owner: 'alice',
			repo: 'designs',
			branch: 'main',
			lastSyncAt: 1,
		};
		githubMetadataStore.setFileMetadata('doc-replace', meta);
		const save = vi.spyOn(storage, 'saveDocument');
		try {
			const imported = new FoldnanoDocument('doc-replace', 'From file');
			imported.addNewPart('HONEYCOMB');
			await session.openImportedDocument(imported, 'replace');

			expect(session.currentDoc.id).toBe('doc-replace');
			expect(session.currentFileMetadata).toEqual(meta);
			expect(save).toHaveBeenCalledWith('doc-replace', expect.anything(), {
				backup: { reason: 'before_import' },
			});
			expect((provider.docs.get('doc-replace') as { parts: unknown[] }).parts).toHaveLength(1);
		} finally {
			githubMetadataStore.clearFileMetadata('doc-replace');
		}
	});

	it('imports as a copy when the id still has GitHub metadata', async () => {
		const { session } = makeSession();
		const { storage, provider } = makeStorage();
		session.replaceStorageManagerForTesting(storage);
		githubMetadataStore.setFileMetadata('doc-linked', {
			path: 'designs/linked.fn.json',
			sha: 'sha-linked',
			owner: 'alice',
			repo: 'designs',
			branch: 'main',
			lastSyncAt: 1,
		});
		try {
			await session.openImportedDocument(new FoldnanoDocument('doc-linked', 'Linked'));

			expect(session.currentDoc.id).not.toBe('doc-linked');
			expect(provider.docs.has('doc-linked')).toBe(false);
			expect(session.currentFileMetadata).toBeNull();
		} finally {
			githubMetadataStore.clearFileMetadata('doc-linked');
		}
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

		const result = await session.loadDocumentFromGitHub(
			'alice',
			'designs',
			'remote.fn.json',
			'main'
		);

		expect(result).toBe('loaded');
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

	it('stores a GitHub file written without a name under its file name', async () => {
		const { session } = makeSession();
		const { storage, provider } = makeStorage();
		session.replaceStorageManagerForTesting(storage);

		const { name: _name, ...file } = new FoldnanoDocument('doc-nameless', 'ignored').toJSON();
		getFileContentMock.mockResolvedValue({ content: btoa(JSON.stringify(file)), sha: 'sha-n' });
		listCommitsMock.mockResolvedValue([]);

		await session.loadDocumentFromGitHub('alice', 'designs', 'designs/crate.fn.json', 'main');

		expect(session.currentDoc.name).toBe('crate');
		expect(provider.docs.get('doc-nameless')).toMatchObject({ name: 'crate' });
	});

	describe('opening a GitHub file whose design id is taken here', () => {
		const answer = (value: SameDesignAnswer) => vi.fn().mockResolvedValue(value);
		const linkTo = (path: string) => ({
			path,
			sha: 'sha-linked',
			owner: 'alice',
			repo: 'designs',
			branch: 'main',
			lastSyncAt: 1,
		});

		function serveGitHubFile(doc: FoldnanoDocument) {
			getFileContentMock.mockResolvedValue({
				content: btoa(JSON.stringify(doc.toJSON())),
				sha: 'remote-sha',
			});
			listCommitsMock.mockResolvedValue([]);
		}

		async function saveBrowserOnlyDesign(provider: MockStorageProvider, id: string) {
			const saved = new FoldnanoDocument(id, 'Browser only');
			saved.addNewPart('HONEYCOMB');
			await provider.saveDocument(id, saved.toJSON());
		}

		function clearLinks(...ids: string[]) {
			for (const id of ids) githubMetadataStore.clearFileMetadata(id);
		}

		describe('the id belongs to a design saved only in this browser', () => {
			it('cancels without touching the browser design', async () => {
				const ask = answer({ action: 'cancel' });
				const { session } = makeSession(ask);
				const { storage, provider } = makeStorage();
				session.replaceStorageManagerForTesting(storage);
				await saveBrowserOnlyDesign(provider, 'doc-taken');
				serveGitHubFile(new FoldnanoDocument('doc-taken', 'Remote'));
				const save = vi.spyOn(storage, 'saveDocument');

				const result = await session.loadDocumentFromGitHub(
					'alice',
					'designs',
					'box.fn.json',
					'main'
				);

				expect(result).toBe('cancelled');
				expect(ask).toHaveBeenCalledWith({
					kind: 'browser-only',
					designId: 'doc-taken',
					incomingName: 'box',
					savedName: 'Browser only',
					savedAt: null,
					sameContent: false,
				});
				expect(save).not.toHaveBeenCalled();
				expect(githubMetadataStore.getFileMetadata('doc-taken')).toBeNull();
			});

			it('open as copy moves the browser design to a new id, so the file keeps its own', async () => {
				const { session } = makeSession(answer({ action: 'copy' }));
				const { storage, provider } = makeStorage();
				session.replaceStorageManagerForTesting(storage);
				await saveBrowserOnlyDesign(provider, 'doc-taken');
				githubExplorerStateStore.saveLocalOnlyEntries('alice', 'designs', [
					{ docId: 'doc-taken', path: 'draft.fn.json', name: 'draft.fn.json' },
				]);
				serveGitHubFile(new FoldnanoDocument('doc-taken', 'Remote'));
				try {
					const result = await session.loadDocumentFromGitHub(
						'alice',
						'designs',
						'box.fn.json',
						'main'
					);

					expect(result).toBe('loaded');
					expect(session.currentDoc.id).toBe('doc-taken');
					expect(session.currentFileMetadata?.path).toBe('box.fn.json');
					const moved = provider.docList.find((d) => d.name === 'Browser only');
					expect(moved?.id).toBeDefined();
					expect(moved?.id).not.toBe('doc-taken');
					const movedDoc = provider.docs.get(moved!.id) as { id: string; parts: unknown[] };
					expect(movedDoc.id).toBe(moved!.id);
					expect(movedDoc.parts).toHaveLength(1);
					expect(githubExplorerStateStore.getLocalOnlyEntries('alice', 'designs')).toEqual([
						{ docId: moved!.id, path: 'draft.fn.json', name: 'draft.fn.json' },
					]);
				} finally {
					clearLinks('doc-taken');
				}
			});

			it("won't move the browser design while another tab has it open", async () => {
				const { uninstall } = installFakeLocks();
				const otherTab = new TabSync('doc-taken');
				const { session } = makeSession(answer({ action: 'copy' }));
				const { storage, provider } = makeStorage();
				session.replaceStorageManagerForTesting(storage);
				await saveBrowserOnlyDesign(provider, 'doc-taken');
				serveGitHubFile(new FoldnanoDocument('doc-taken', 'Remote'));
				try {
					await flushLocks();
					const result = await session.loadDocumentFromGitHub(
						'alice',
						'designs',
						'box.fn.json',
						'main'
					);

					expect(result).toBe('cancelled');
					expect((provider.docs.get('doc-taken') as { name: string }).name).toBe('Browser only');
					expect(githubMetadataStore.getFileMetadata('doc-taken')).toBeNull();
				} finally {
					otherTab.destroy();
					session.destroy();
					uninstall();
				}
			});

			it('replaces the browser design on request, keeping a backup', async () => {
				const { session } = makeSession(answer({ action: 'replace' }));
				const { storage, provider } = makeStorage();
				session.replaceStorageManagerForTesting(storage);
				await saveBrowserOnlyDesign(provider, 'doc-taken');
				serveGitHubFile(new FoldnanoDocument('doc-taken', 'Remote'));
				const save = vi.spyOn(storage, 'saveDocument');
				try {
					const result = await session.loadDocumentFromGitHub(
						'alice',
						'designs',
						'box.fn.json',
						'main'
					);

					expect(result).toBe('loaded');
					expect(session.currentDoc.id).toBe('doc-taken');
					expect(save).toHaveBeenCalledWith('doc-taken', expect.anything(), {
						backup: { reason: 'before_import' },
					});
					expect((provider.docs.get('doc-taken') as { parts: unknown[] }).parts).toHaveLength(0);
					expect(githubMetadataStore.getFileMetadata('doc-taken')?.path).toBe('box.fn.json');
				} finally {
					clearLinks('doc-taken');
				}
			});
		});

		describe('the id belongs to another file in the repo', () => {
			it('saves a renamed copy as an uncommitted file, leaving both GitHub files alone', async () => {
				const ask = answer({ action: 'copy', name: 'box v2' });
				const { session } = makeSession(ask);
				const { storage, provider } = makeStorage();
				session.replaceStorageManagerForTesting(storage);
				githubMetadataStore.setFileMetadata('doc-linked', linkTo('designs/box.fn.json'));
				serveGitHubFile(new FoldnanoDocument('doc-linked', 'Remote'));
				try {
					const result = await session.loadDocumentFromGitHub(
						'alice',
						'designs',
						'designs/twin.fn.json',
						'main'
					);

					expect(result).toBe('loaded');
					expect(ask).toHaveBeenCalledWith({
						kind: 'other-repo-file',
						designId: 'doc-linked',
						incomingName: 'twin',
						incomingPath: 'designs/twin.fn.json',
						linkedPath: 'designs/box.fn.json',
						suggestedName: 'twin copy',
					});
					expect(session.currentDoc.id).not.toBe('doc-linked');
					expect(session.currentDoc.name).toBe('box v2');
					expect(session.currentFileMetadata).toBeNull();
					expect(provider.docs.has(session.currentDoc.id)).toBe(true);
					expect(githubExplorerStateStore.getLocalOnlyEntries('alice', 'designs')).toEqual([
						{
							docId: session.currentDoc.id,
							path: 'designs/box v2.fn.json',
							name: 'box v2.fn.json',
						},
					]);
					expect(githubMetadataStore.getFileMetadata('doc-linked')?.path).toBe(
						'designs/box.fn.json'
					);
					expect(
						githubMetadataStore.findDocIdByPath('alice', 'designs', 'designs/twin.fn.json')
					).toBeNull();
				} finally {
					clearLinks('doc-linked');
				}
			});

			it('cancels without opening anything', async () => {
				const { session } = makeSession(answer({ action: 'cancel' }));
				const { storage } = makeStorage();
				session.replaceStorageManagerForTesting(storage);
				githubMetadataStore.setFileMetadata('doc-linked', linkTo('designs/box.fn.json'));
				serveGitHubFile(new FoldnanoDocument('doc-linked', 'Remote'));
				const save = vi.spyOn(storage, 'saveDocument');
				try {
					const result = await session.loadDocumentFromGitHub(
						'alice',
						'designs',
						'designs/twin.fn.json',
						'main'
					);

					expect(result).toBe('cancelled');
					expect(save).not.toHaveBeenCalled();
				} finally {
					clearLinks('doc-linked');
				}
			});

			it('opens normally when the linked file is gone from GitHub', async () => {
				const ask = vi.fn();
				const { session } = makeSession(ask);
				const { storage } = makeStorage();
				session.replaceStorageManagerForTesting(storage);
				githubMetadataStore.setFileMetadata('doc-linked', linkTo('designs/deleted.fn.json'));
				const file = new FoldnanoDocument('doc-linked', 'Remote');
				getFileContentMock.mockImplementation(async (_o: string, _r: string, path: string) => {
					if (path === 'designs/deleted.fn.json') throw new GitHubApiError('Not Found', 404);
					return { content: btoa(JSON.stringify(file.toJSON())), sha: 'remote-sha' };
				});
				listCommitsMock.mockResolvedValue([]);
				try {
					const result = await session.loadDocumentFromGitHub(
						'alice',
						'designs',
						'designs/twin.fn.json',
						'main'
					);

					expect(result).toBe('loaded');
					expect(ask).not.toHaveBeenCalled();
					expect(session.currentDoc.id).toBe('doc-linked');
					expect(githubMetadataStore.getFileMetadata('doc-linked')?.path).toBe(
						'designs/twin.fn.json'
					);
				} finally {
					clearLinks('doc-linked');
				}
			});
		});

		describe("the file's id changed on GitHub", () => {
			it('the design linked to the path follows the new id', async () => {
				const ask = vi.fn();
				const { session } = makeSession(ask);
				const { storage, provider } = makeStorage();
				session.replaceStorageManagerForTesting(storage);
				await saveBrowserOnlyDesign(provider, 'doc-old');
				githubMetadataStore.setFileMetadata('doc-old', linkTo('box.fn.json'));
				serveGitHubFile(new FoldnanoDocument('doc-new', 'Remote'));
				try {
					const result = await session.loadDocumentFromGitHub(
						'alice',
						'designs',
						'box.fn.json',
						'main'
					);

					expect(result).toBe('loaded');
					expect(ask).not.toHaveBeenCalled();
					expect(session.currentDoc.id).toBe('doc-new');
					expect(githubMetadataStore.getFileMetadata('doc-new')?.path).toBe('box.fn.json');
					expect(githubMetadataStore.getFileMetadata('doc-old')).toBeNull();
					expect(provider.docs.has('doc-old')).toBe(false);
				} finally {
					clearLinks('doc-old', 'doc-new');
				}
			});

			it('keeps the local id when the new id is already used here', async () => {
				const { session } = makeSession(vi.fn());
				const { storage, provider } = makeStorage();
				session.replaceStorageManagerForTesting(storage);
				await saveBrowserOnlyDesign(provider, 'doc-old');
				await saveBrowserOnlyDesign(provider, 'doc-new');
				githubMetadataStore.setFileMetadata('doc-old', linkTo('box.fn.json'));
				serveGitHubFile(new FoldnanoDocument('doc-new', 'Remote'));
				try {
					const result = await session.loadDocumentFromGitHub(
						'alice',
						'designs',
						'box.fn.json',
						'main'
					);

					expect(result).toBe('loaded');
					expect(session.currentDoc.id).toBe('doc-old');
					expect(githubMetadataStore.getFileMetadata('doc-old')?.path).toBe('box.fn.json');
					expect((provider.docs.get('doc-new') as { parts: unknown[] }).parts).toHaveLength(1);
				} finally {
					clearLinks('doc-old');
				}
			});

			it('a pull follows the new id and the URL is told', async () => {
				const { session } = makeSession();
				const { storage, provider } = makeStorage();
				session.replaceStorageManagerForTesting(storage);
				await saveBrowserOnlyDesign(provider, 'doc-old');
				session.replaceCurrentDocumentForTesting(new FoldnanoDocument('doc-old', 'box'));
				session.bindCurrentDocumentToGitHubFile(linkTo('box.fn.json'));
				vi.mocked(githubStorageProvider.pullDocument).mockResolvedValue(
					new FoldnanoDocument('doc-new', 'box').toJSON()
				);
				listCommitsMock.mockResolvedValue([]);
				try {
					await expect(session.pullCurrentDocFromGitHub()).resolves.toBe(true);

					expect(session.currentDoc.id).toBe('doc-new');
					expect(session.currentFileMetadata?.path).toBe('box.fn.json');
					expect(githubMetadataStore.getFileMetadata('doc-old')).toBeNull();
					expect(session.lastDocIdChange).toEqual({ from: 'doc-old', to: 'doc-new' });
				} finally {
					clearLinks('doc-old', 'doc-new');
				}
			});

			it('a pull keeps the local id when the new id is already used here', async () => {
				const { session } = makeSession();
				const { storage, provider } = makeStorage();
				session.replaceStorageManagerForTesting(storage);
				await saveBrowserOnlyDesign(provider, 'doc-old');
				await saveBrowserOnlyDesign(provider, 'doc-new');
				session.replaceCurrentDocumentForTesting(new FoldnanoDocument('doc-old', 'box'));
				session.bindCurrentDocumentToGitHubFile(linkTo('box.fn.json'));
				vi.mocked(githubStorageProvider.pullDocument).mockResolvedValue(
					new FoldnanoDocument('doc-new', 'box').toJSON()
				);
				listCommitsMock.mockResolvedValue([]);
				try {
					await expect(session.pullCurrentDocFromGitHub()).resolves.toBe(true);

					expect(session.currentDoc.id).toBe('doc-old');
					expect(session.currentFileMetadata?.path).toBe('box.fn.json');
					expect(session.lastDocIdChange).toBeNull();
				} finally {
					clearLinks('doc-old');
				}
			});
		});

		it("doesn't ask when the id belongs to this same GitHub file", async () => {
			const ask = vi.fn();
			const { session } = makeSession(ask);
			const { storage, provider } = makeStorage();
			session.replaceStorageManagerForTesting(storage);
			await saveBrowserOnlyDesign(provider, 'doc-same');
			githubMetadataStore.setFileMetadata('doc-same', linkTo('box.fn.json'));
			serveGitHubFile(new FoldnanoDocument('doc-same', 'Remote'));
			try {
				const result = await session.loadDocumentFromGitHub(
					'alice',
					'designs',
					'box.fn.json',
					'main'
				);

				expect(result).toBe('loaded');
				expect(ask).not.toHaveBeenCalled();
				expect(session.currentDoc.id).toBe('doc-same');
			} finally {
				clearLinks('doc-same');
			}
		});
	});

	it('opens a stored design under its storage key, even if an older pull stored another id', async () => {
		const { session } = makeSession();
		const { storage, provider } = makeStorage();
		session.replaceStorageManagerForTesting(storage);
		await provider.saveDocument('doc-key', new FoldnanoDocument('doc-inside', 'Mismatch').toJSON());

		await expect(session.loadDocumentFromLocalStorage('doc-key')).resolves.toBe(true);

		expect(session.currentDoc.id).toBe('doc-key');
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
		const loadSpy = vi.spyOn(session, 'loadDocumentFromGitHub').mockResolvedValue('failed');

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
		vi.spyOn(session, 'loadDocumentFromGitHub').mockResolvedValue('loaded');

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

	it('commits a rename of a committed file, leaving nothing to commit', async () => {
		const { session } = makeSession();
		const { storage } = makeStorage();
		session.replaceStorageManagerForTesting(storage);
		session.replaceCurrentDocumentForTesting(new FoldnanoDocument('doc-ren', 'box'));
		session.bindCurrentDocumentToGitHubFile({
			path: 'designs/box.fn.json',
			sha: 'sha-box',
			owner: 'alice',
			repo: 'designs',
			branch: 'main',
			lastSyncAt: 1,
		});
		vi.mocked(githubStorageProvider.commitDocument).mockResolvedValue('commit-rename');
		try {
			const result = await session.renameDocument('crate');

			expect(result).toMatchObject({ kind: 'repo-file-renamed', newPath: 'designs/crate.fn.json' });
			const uploaded = vi.mocked(githubStorageProvider.commitDocument).mock.calls[0][2];
			expect(JSON.parse(JSON.stringify(uploaded)).name).toBe('crate');
			expect(deleteFileContent).toHaveBeenCalledWith(
				'alice',
				'designs',
				'designs/box.fn.json',
				expect.objectContaining({ sha: 'sha-box' })
			);
			expect(session.hasUncommittedGitHubChanges).toBe(false);
			expect(githubMetadataStore.getFileMetadata('doc-ren')).toMatchObject({
				path: 'designs/crate.fn.json',
				commitSha: 'commit-rename',
			});
		} finally {
			githubMetadataStore.clearFileMetadata('doc-ren');
		}
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

	it('keeps the design name when the resolved JSON has none, as diffs leave it out', async () => {
		const db = new FoldnanoIndexedDb(`test-resolve-${crypto.randomUUID()}`);
		const session = await openSessionOn(db, new FoldnanoDocument('doc-n', 'Mine'));
		const { name: _name, ...resolved } = new FoldnanoDocument('doc-n', 'x').toJSON();

		await expect(session.applyResolvedConflict('doc-n', resolved)).resolves.toBe(true);

		expect(session.currentDoc.name).toBe('Mine');
		expect(await db.loadDocument('doc-n')).toMatchObject({ name: 'Mine' });
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

describe('EditorDocumentSession design names', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		githubMetadataStore.clearRepoContext();
		githubExplorerStateStore.saveLocalOnlyEntries('alice', 'designs', []);
		githubExplorerStateStore.saveLocalFolderPaths('alice', 'designs', []);
		getRepoTreeMock.mockResolvedValue({ sha: 't', url: '', tree: [], truncated: false });
	});

	function setup(doc: FoldnanoDocument) {
		const { session } = makeSession();
		const { storage, provider } = makeStorage();
		session.replaceStorageManagerForTesting(storage);
		session.replaceCurrentDocumentForTesting(doc);
		return { session, provider };
	}

	it('never saves a design under the reserved blank-workspace name, and saves once named', async () => {
		const { session, provider } = setup(new FoldnanoDocument('doc-untitled'));
		session.historyStack.tx(() => {
			session.currentDoc.addNewPart('HONEYCOMB');
		});
		expect(session.needsName).toBe(true);

		expect(await session.historyStack.saveNow()).toEqual({ success: false, savedAt: null });
		await session.saveDocumentToLocalStorage({ force: true });
		await session.persistCurrentDocumentSnapshot('before-switch', { force: true });
		expect(provider.docs.has('doc-untitled')).toBe(false);

		await session.renameDocument('Box');
		expect(session.needsName).toBe(false);
		// The design's only Part, still "Part 1", takes the name too.
		expect(session.currentDoc.parts.map((p) => p.name)).toEqual(['Box']);
		expect((provider.docs.get('doc-untitled') as { name: string }).name).toBe('Box');
	});

	describe('saveAsCopy', () => {
		async function setupSaved(id: string, name: string) {
			const doc = new FoldnanoDocument(id, name);
			doc.addNewPart('HONEYCOMB');
			const { session, provider } = setup(doc);
			await provider.saveDocument(id, doc.toJSON());
			return { session, provider };
		}

		afterEach(() => {
			githubMetadataStore.clearFileMetadata('doc-orig');
		});

		it('opens a copy under a new id and name, leaving the original and carrying the view', async () => {
			const { session, provider } = await setupSaved('doc-orig', 'Box');
			await provider.saveContext('doc-orig', { zoom: 3 });

			const id = await session.saveAsCopy('Box v2');

			expect(id).toBe(session.currentDoc.id);
			expect(id).not.toBe('doc-orig');
			expect(session.currentDoc.name).toBe('Box v2');
			expect(session.currentDoc.parts).toHaveLength(1);
			expect(session.currentFileMetadata).toBeNull();
			expect((provider.docs.get(id!) as { id: string; name: string }).name).toBe('Box v2');
			expect((provider.docs.get('doc-orig') as { name: string }).name).toBe('Box');
			expect(provider.contexts.get(id!)).toEqual({ zoom: 3 });
		});

		it('files the copy of a committed repo file next to it as an uncommitted file', async () => {
			const { session } = await setupSaved('doc-orig', 'box');
			session.bindCurrentDocumentToGitHubFile({
				path: 'designs/box.fn.json',
				sha: 'sha-box',
				owner: 'alice',
				repo: 'designs',
				branch: 'main',
				lastSyncAt: 1,
			});

			const id = await session.saveAsCopy('box v2');

			expect(githubExplorerStateStore.getLocalOnlyEntries('alice', 'designs')).toEqual([
				{ docId: id, path: 'designs/box v2.fn.json', name: 'box v2.fn.json' },
			]);
			expect(githubMetadataStore.getFileMetadata('doc-orig')?.path).toBe('designs/box.fn.json');
			expect(githubMetadataStore.getFileMetadata(id!)).toBeNull();
		});

		it('files the copy of an uncommitted repo file in the same folder', async () => {
			const { session } = await setupSaved('doc-orig', 'draft');
			githubMetadataStore.setRepoContext({ owner: 'alice', repo: 'designs', branch: 'main' });
			session.refreshGitHubStateFromStore();
			githubExplorerStateStore.saveLocalOnlyEntries('alice', 'designs', [
				{ docId: 'doc-orig', path: 'folder/draft.fn.json', name: 'draft.fn.json' },
			]);

			const id = await session.saveAsCopy('draft v2');

			expect(githubExplorerStateStore.getLocalOnlyEntries('alice', 'designs')).toContainEqual({
				docId: id,
				path: 'folder/draft v2.fn.json',
				name: 'draft v2.fn.json',
			});
		});

		it('picks a free name when the folder already has that file', async () => {
			const { session } = await setupSaved('doc-orig', 'box');
			session.bindCurrentDocumentToGitHubFile({
				path: 'designs/box.fn.json',
				sha: 'sha-box',
				owner: 'alice',
				repo: 'designs',
				branch: 'main',
				lastSyncAt: 1,
			});
			getRepoTreeMock.mockResolvedValue({
				sha: 't',
				url: '',
				tree: [{ path: 'designs/box v2.fn.json', type: 'blob' }],
				truncated: false,
			});

			await session.saveAsCopy('box v2');

			expect(session.currentDoc.name).not.toBe('box v2');
			expect(session.currentDoc.name.startsWith('box v2')).toBe(true);
		});

		it('refuses an invalid name and stays on the original', async () => {
			const { session, provider } = await setupSaved('doc-orig', 'Box');

			await expect(session.saveAsCopy('a/b')).resolves.toBeNull();

			expect(session.currentDoc.id).toBe('doc-orig');
			expect(provider.docs.size).toBe(1);
		});
	});

	it('does not ask for a name while the workspace is empty', () => {
		const { session } = setup(new FoldnanoDocument('doc-empty'));
		expect(session.needsName).toBe(false);
	});

	it('refuses invalid and reserved names in checkRename and renameDocument', async () => {
		const { session } = setup(new FoldnanoDocument('doc-a', 'A'));
		expect(await session.checkRename('a/b')).toMatchObject({ kind: 'blocked' });
		expect(await session.checkRename('untitled document')).toMatchObject({ kind: 'blocked' });
		expect(await session.checkRename(' A ')).toEqual({ kind: 'unchanged' });
		await expect(session.renameDocument('a:b')).rejects.toThrow();
		expect(session.currentDoc.name).toBe('A');
		await session.renameDocument('Tile.fn.json');
		expect(session.currentDoc.name).toBe('Tile');
	});

	it('warns about another saved design with the same name, ignoring case', async () => {
		const { session, provider } = setup(new FoldnanoDocument('doc-a', 'A'));
		await provider.saveDocument('doc-b', new FoldnanoDocument('doc-b', 'Box').toJSON());

		expect(await session.checkRename('box')).toEqual({
			kind: 'ok',
			name: 'box',
			nameClash: 'Box',
			commitsToGitHub: false,
		});
		// A typed extension is dropped, so `box.fn.json` is the same name as `box`.
		expect(await session.checkRename('box.fn.json')).toMatchObject({
			kind: 'ok',
			name: 'box',
			nameClash: 'Box',
		});
		expect(await session.checkRename('box.fn')).toMatchObject({ kind: 'blocked' });
		expect(await session.checkRename('Tile')).toMatchObject({ kind: 'ok', nameClash: null });
	});

	it('blocks a rename onto a file in the same repo folder, ignoring case, but allows a case-only rename', async () => {
		const { session } = setup(new FoldnanoDocument('doc-local', 'Before'));
		githubMetadataStore.setRepoContext({ owner: 'alice', repo: 'designs', branch: 'main' });
		session.refreshGitHubStateFromStore();
		githubExplorerStateStore.saveLocalOnlyEntries('alice', 'designs', [
			{ docId: 'doc-local', path: 'folder/Before.fn.json', name: 'Before.fn.json' },
		]);
		getRepoTreeMock.mockResolvedValue({
			sha: 't',
			url: '',
			truncated: false,
			tree: [{ path: 'folder/Taken.fn.json', mode: '100644', type: 'blob', sha: 's', url: '' }],
		});

		expect(await session.checkRename('taken')).toEqual({
			kind: 'blocked',
			message: '"Taken.fn.json" already exists in this folder.',
		});
		expect(await session.checkRename('before')).toMatchObject({ kind: 'ok' });
	});

	it('blocks renaming a committed file with uncommitted changes', async () => {
		const { session } = setup(new FoldnanoDocument('doc-committed', 'Committed'));
		session.bindCurrentDocumentToGitHubFile({
			path: 'Committed.fn.json',
			sha: 'sha-1',
			owner: 'alice',
			repo: 'designs',
			branch: 'main',
			lastSyncAt: Date.now(),
		});
		expect(await session.checkRename('Renamed')).toMatchObject({
			kind: 'ok',
			commitsToGitHub: true,
		});

		session.historyStack.tx(() => {
			session.currentDoc.addNewPart('HONEYCOMB');
		});
		expect(await session.checkRename('Renamed')).toMatchObject({ kind: 'blocked' });
		githubMetadataStore.clearFileMetadata('doc-committed');
	});

	it('numbers an opened file whose name a saved design already uses', async () => {
		const { session, provider } = setup(new FoldnanoDocument('doc-open'));
		await provider.saveDocument('doc-box', new FoldnanoDocument('doc-box', 'Box').toJSON());

		await session.openImportedDocument(new FoldnanoDocument('doc-new', 'box'));
		expect(session.currentDoc.name).toBe('box (2)');

		// A copy of a saved design gets a numbered name too.
		await session.openImportedDocument(new FoldnanoDocument('doc-box', 'Box'));
		expect(session.currentDoc.id).not.toBe('doc-box');
		expect(session.currentDoc.name).toBe('Box (3)');
	});

	it('numbers an imported design against design files in the target repo folder', async () => {
		const { session } = setup(new FoldnanoDocument('doc-x'));
		githubMetadataStore.setRepoContext({ owner: 'alice', repo: 'designs', branch: 'main' });
		session.refreshGitHubStateFromStore();
		getRepoTreeMock.mockResolvedValue({
			sha: 't',
			url: '',
			truncated: false,
			tree: [
				{ path: 'folder/Hilbert.fn.json', mode: '100644', type: 'blob', sha: 's', url: '' },
				{ path: 'other/Tile.fn.json', mode: '100644', type: 'blob', sha: 's', url: '' },
			],
		});

		expect(await session.uniqueImportName('hilbert', 'folder')).toBe('hilbert (2)');
		expect(await session.uniqueImportName('Tile', 'folder')).toBe('Tile');
	});
});
