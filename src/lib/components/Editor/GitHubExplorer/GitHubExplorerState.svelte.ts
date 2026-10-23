import { pushState } from '$app/navigation';
import { toast } from 'svelte-sonner';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { githubMetadataStore } from '$lib/services/storage';
import { githubStorageProvider } from '$lib/services/storage/providers/GitHubStorageProvider';
import {
	GitHubConflictError,
	getRepoTree,
	putFileContent,
	deleteFileContent,
	getFileContent,
} from '$lib/services/github/api';
import type { EditorDocumentSession } from '../context/EditorDocumentSession.svelte';
import type { FileNode, ChangeEntry } from './types';
import { buildTree, mergeLocalOnly, treeHasPath, collectPaths } from './treeUtils';
import { FN_JSON_EXT, fileStem, isRenamableFile, validateFileStem } from './fileNaming';
import { fnJsonPathFor } from '$lib/model/io/designFileName';
import { summarizeCommitAll, type CommitAllResult, type CommitSummary } from './commitSummary';
import {
	loadLocalOnlyEntries,
	saveLocalOnlyEntries,
	addLocalOnlyEntry,
	loadLocalFolderPaths,
	saveLocalFolderPaths,
	addLocalFolder as persistAddLocalFolder,
	entriesToNodes,
	foldersToNodes,
} from './localPersistence';

interface GitHubExplorerUiState {
	localOnlyEntriesVersion: number;
	repoTreeVersion: number;
	activeGitHubTab: 'files' | 'changes' | 'graph';
}

export class GitHubExplorerState {
	// --- Core tree state ---
	githubTree = $state<FileNode[]>([]);
	localOnlyNodes = $state<FileNode[]>([]);
	localFolderNodes = $state<FileNode[]>([]);

	readonly fileTree = $derived(
		mergeLocalOnly(this.githubTree, this.localOnlyNodes, this.localFolderNodes)
	);

	// --- Loading state ---
	loading = $state(false);
	loadingFile = $state('');
	visibleLoadingFile = $state('');
	error = $state('');
	pulling = $state(false);
	/** Path of the file whose inline rename input was requested (e.g. from the context menu). */
	renamingPath = $state('');
	private loadingFileTimeout: number | undefined;

	// --- Dirty / changes tracking ---
	committedDirtyPaths = $state<Set<string>>(new SvelteSet());
	localCachedPaths = $state<Set<string>>(new SvelteSet());
	readonly pendingDeletedNodes = new SvelteMap<string, { sha: string; name: string }>();

	readonly dirtyPaths = $derived.by(() => {
		const paths = new SvelteSet<string>(this.committedDirtyPaths);
		const session = this.session;
		if (session.hasUncommittedGitHubChanges && session.currentFileMetadata?.path) {
			paths.add(session.currentFileMetadata.path);
		}
		for (const n of this.localOnlyNodes) paths.add(n.path);
		return paths;
	});

	/** Paths that are locally cached (downloaded) but have no uncommitted changes. */
	readonly cleanLocalPaths = $derived.by(() => {
		const result = new SvelteSet<string>();
		for (const path of this.localCachedPaths) {
			if (!this.dirtyPaths.has(path)) result.add(path);
		}
		return result;
	});

	readonly changeEntries = $derived.by((): ChangeEntry[] => {
		const entries: ChangeEntry[] = [];
		const session = this.session;

		for (const n of this.localOnlyNodes) {
			entries.push({ path: n.path, name: n.name, kind: 'added' });
		}

		const modifiedPaths = new SvelteSet<string>(this.committedDirtyPaths);
		if (session.hasUncommittedGitHubChanges && session.currentFileMetadata?.path) {
			modifiedPaths.add(session.currentFileMetadata.path);
		}
		for (const p of modifiedPaths) {
			if (this.pendingDeletedNodes.has(p)) continue;
			if (!entries.find((e) => e.path === p)) {
				entries.push({ path: p, name: p.split('/').pop()!, kind: 'modified' });
			}
		}

		for (const [path, { sha, name }] of this.pendingDeletedNodes) {
			if (!entries.find((e) => e.path === path)) {
				entries.push({ path, name, kind: 'deleted', sha });
			}
		}
		return entries;
	});

	constructor(
		private session: EditorDocumentSession,
		private uiState: GitHubExplorerUiState
	) {
		$effect(() => {
			// Re-sync localOnlyNodes when EditorViewContext signals an external change
			// (e.g. a toolbar rename updating localOnlyEntries in storage)
			void this.uiState.localOnlyEntriesVersion;
			const repoCtx = this.repoCtx;
			if (repoCtx) {
				this.localOnlyNodes = entriesToNodes(loadLocalOnlyEntries(repoCtx));
			}
		});

		$effect(() => {
			// Refresh the GitHub file tree when a committed-file rename is performed from
			// outside this class (e.g. toolbar rename via EditorViewContext.renameDocument).
			if (this.uiState.repoTreeVersion > 0) {
				void this.fetchTree();
			}
		});
	}

	// --- Loading indicator helpers ---

	beginLoadingFile(path: string) {
		this.loadingFile = path;
		this.visibleLoadingFile = '';
		if (this.loadingFileTimeout !== undefined) {
			clearTimeout(this.loadingFileTimeout);
		}
		this.loadingFileTimeout = window.setTimeout(() => {
			if (this.loadingFile === path) {
				this.visibleLoadingFile = path;
			}
		}, 100);
	}

	endLoadingFile(path?: string) {
		if (this.loadingFileTimeout !== undefined) {
			clearTimeout(this.loadingFileTimeout);
			this.loadingFileTimeout = undefined;
		}
		if (!path || this.loadingFile === path) {
			this.loadingFile = '';
		}
		if (!path || this.visibleLoadingFile === path) {
			this.visibleLoadingFile = '';
		}
	}

	// --- Persistence helpers (context-bound) ---

	private get repoCtx() {
		return this.session.currentRepoContext;
	}

	private async loadPersistedDocumentText(docId: string): Promise<string | null> {
		const snapshot = await this.session.storageManager.loadDocument(docId);
		return snapshot ? JSON.stringify(snapshot, null, 2) : null;
	}

	// --- Tree ---

	async fetchTree(): Promise<void> {
		const repoCtx = this.repoCtx;
		if (!repoCtx) return;
		this.loading = true;
		this.error = '';
		try {
			const tree = await getRepoTree(repoCtx.owner, repoCtx.repo, repoCtx.branch, true);
			const built = buildTree(tree.tree);

			const existingPaths = collectPaths(built);

			const entries = loadLocalOnlyEntries(repoCtx);
			const stillLocal = entries.filter((e) => !existingPaths.has(e.path));
			if (stillLocal.length !== entries.length) saveLocalOnlyEntries(repoCtx, stillLocal);
			this.localOnlyNodes = entriesToNodes(stillLocal);

			const folderPaths = loadLocalFolderPaths(repoCtx).filter((p) => !existingPaths.has(p));
			saveLocalFolderPaths(repoCtx, folderPaths);
			this.localFolderNodes = foldersToNodes(folderPaths);

			this.githubTree = built;
			this.committedDirtyPaths = await githubMetadataStore.getUncommittedPaths(
				repoCtx.owner,
				repoCtx.repo
			);
			this.localCachedPaths = githubMetadataStore.getLocalCachedPaths(repoCtx.owner, repoCtx.repo);
		} catch (e) {
			this.error = (e as Error).message || 'Failed to load file tree';
		} finally {
			this.loading = false;
		}
	}

	async loadFromGitHub(node: FileNode): Promise<void> {
		const repoCtx = this.repoCtx;
		if (!repoCtx) return;
		this.beginLoadingFile(node.path);
		this.error = '';
		try {
			const ok = await this.session.loadDocumentFromGitHub(
				repoCtx.owner,
				repoCtx.repo,
				node.path,
				repoCtx.branch
			);
			if (ok) {
				this.localCachedPaths = githubMetadataStore.getLocalCachedPaths(
					repoCtx.owner,
					repoCtx.repo
				);
			} else {
				this.error = `Failed to load ${node.name}`;
			}
		} catch (e) {
			this.error = (e as Error).message || `Failed to load ${node.name}`;
		} finally {
			this.endLoadingFile(node.path);
		}
	}

	// --- File click ---

	async handleFileClick(node: FileNode): Promise<void> {
		const repoCtx = this.repoCtx;
		const session = this.session;
		if (!repoCtx) return;

		if (node.localOnly) {
			const entry = loadLocalOnlyEntries(repoCtx).find((e) => e.path === node.path);
			if (!entry) return;
			await session.saveDocumentToLocalStorage({ skipPristineBlank: true });
			this.beginLoadingFile(node.path);
			try {
				await session.loadDocumentFromLocalStorage(entry.docId);
				await session.syncCurrentDocName(fileStem(entry.path.split('/').pop()!));
			} finally {
				this.endLoadingFile(node.path);
			}
			// eslint-disable-next-line svelte/no-navigation-without-resolve
			pushState(`/editor/${session.currentDoc.id}`, {});
			return;
		}

		if (node.path === session.currentFileMetadata?.path) {
			await this.pullCurrentFile();
			return;
		}

		await session.saveDocumentToLocalStorage({ skipPristineBlank: true });
		this.committedDirtyPaths = await githubMetadataStore.getUncommittedPaths(
			repoCtx.owner,
			repoCtx.repo
		);

		const existingDocId = githubMetadataStore.findDocIdByPath(
			repoCtx.owner,
			repoCtx.repo,
			node.path
		);
		if (existingDocId) {
			this.beginLoadingFile(node.path);
			try {
				const ok = await session.loadDocumentFromLocalStorage(existingDocId);
				if (!ok) {
					await this.loadFromGitHub(node);
				}
			} finally {
				this.endLoadingFile(node.path);
			}
			// eslint-disable-next-line svelte/no-navigation-without-resolve
			pushState(`/editor/${session.currentDoc.id}`, {});
			return;
		}

		if (this.isCadnanoJsonPath(node.path)) {
			// Fetch the file and determine its format by structure, not by extension.
			// A plain .json file could be a Foldnano doc (has `parts`) or a legacy cadnano file (has `vstrands`).
			this.beginLoadingFile(node.path);
			let raw: Record<string, unknown>;
			try {
				const file = await getFileContent(repoCtx.owner, repoCtx.repo, node.path, repoCtx.branch);
				const rawContent = atob(file.content.replace(/\s/g, ''));
				raw = JSON.parse(rawContent) as Record<string, unknown>;
			} catch (e) {
				this.error = `Failed to read "${node.name}": ${(e as Error).message}`;
				this.endLoadingFile(node.path);
				return;
			}
			this.endLoadingFile(node.path);

			// Native Foldnano document: load directly without conversion.
			if (Array.isArray(raw.parts)) {
				await this.loadFromGitHub(node);
				// eslint-disable-next-line svelte/no-navigation-without-resolve
				pushState(`/editor/${session.currentDoc.id}`, {});
				return;
			}

			// Legacy cadnano JSON: check for fn.json conflict, then signal import dialog.
			const fnPath = fnJsonPathFor(node.path);
			const fnName = fnPath.split('/').pop()!;
			if (
				treeHasPath(this.fileTree, fnPath) ||
				this.localOnlyNodes.some((n) => n.path === fnPath)
			) {
				toast.warning(
					`"${node.name}" cannot be opened: "${fnName}" already exists in the same folder. Please rename one of the two files first.`
				);
				return;
			}
			this.pendingCadnanoImportNode = node;
			return;
		}

		await this.loadFromGitHub(node);
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		pushState(`/editor/${session.currentDoc.id}`, {});
	}

	/** Set by handleFileClick when a cadnano import dialog should be shown. Cleared by caller. */
	pendingCadnanoImportNode = $state<FileNode | null>(null);

	isCadnanoJsonPath(path: string): boolean {
		return path.endsWith('.json') && !path.endsWith('.cweb.json') && !path.endsWith('.fn.json');
	}

	// --- File created / published callbacks ---

	handleFileCreated(path: string, node: FileNode, onFolderSelect: (p: string) => void): void {
		const repoCtx = this.repoCtx;
		addLocalOnlyEntry(repoCtx, {
			docId: this.session.currentDoc.id,
			path,
			name: node.name,
		});
		this.localOnlyNodes = [...this.localOnlyNodes, node];
		const parts = path.split('/');
		onFolderSelect(parts.length > 1 ? parts.slice(0, -1).join('/') : '');
	}

	async handlePublished(
		path: string,
		setActiveTab: (tab: 'files' | 'changes' | 'graph') => void
	): Promise<void> {
		const repoCtx = this.repoCtx;
		if (repoCtx) {
			saveLocalOnlyEntries(
				repoCtx,
				loadLocalOnlyEntries(repoCtx).filter((e) => e.path !== path)
			);
			this.localOnlyNodes = entriesToNodes(loadLocalOnlyEntries(repoCtx));
		}
		await this.fetchTree();
		setActiveTab('changes');
	}

	// --- Rename (native `.fn.json` files only) ---

	/** Why `node` cannot be renamed right now, or null when it can. */
	private renameBlockReason(node: FileNode): string | null {
		if (!isRenamableFile(node)) return 'Only .fn.json files can be renamed.';
		if (!node.localOnly && this.isFileDirty(node.path)) {
			return `"${node.name}" has uncommitted changes. Commit or discard them before renaming.`;
		}
		return null;
	}

	requestRename(node: FileNode): void {
		const blocked = this.renameBlockReason(node);
		if (blocked) {
			toast.error(blocked);
			return;
		}
		this.renamingPath = node.path;
	}

	/** `newStem` is the file name without the `.fn.json` extension. */
	async renameFile(node: FileNode, newStem: string): Promise<void> {
		const repoCtx = this.repoCtx;
		if (!repoCtx) return;

		const blocked = this.renameBlockReason(node);
		if (blocked) {
			toast.error(blocked);
			return;
		}

		const stem = newStem.trim();
		const invalid = validateFileStem(stem);
		if (invalid) {
			toast.error(invalid);
			return;
		}

		const newName = stem + FN_JSON_EXT;
		if (newName === node.name) return;
		const newPath = node.path.slice(0, node.path.length - node.name.length) + newName;

		if (treeHasPath(this.fileTree, newPath) || this.pendingDeletedNodes.has(newPath)) {
			toast.error(`"${newName}" already exists in this folder.`);
			return;
		}

		try {
			if (node.localOnly) {
				await this.renameLocalOnlyFile(node, newPath, stem);
			} else {
				await this.renameCommittedFile(node, newPath);
				await this.fetchTree();
			}
		} catch (e) {
			toast.error(`Failed to rename "${node.name}": ${(e as Error).message}`);
			await this.fetchTree();
		}
	}

	private async renameLocalOnlyFile(node: FileNode, newPath: string, stem: string): Promise<void> {
		const repoCtx = this.repoCtx;
		if (!repoCtx) return;
		const entries = loadLocalOnlyEntries(repoCtx);
		const entry = entries.find((e) => e.path === node.path);
		if (!entry) return;

		saveLocalOnlyEntries(
			repoCtx,
			entries.map((e) =>
				e === entry ? { ...e, path: newPath, name: newPath.split('/').pop()! } : e
			)
		);
		this.localOnlyNodes = entriesToNodes(loadLocalOnlyEntries(repoCtx));
		if (entry.docId === this.session.currentDoc.id) {
			await this.session.syncCurrentDocName(stem);
		}
	}

	private async renameCommittedFile(node: FileNode, newPath: string): Promise<void> {
		const repoCtx = this.repoCtx;
		if (!repoCtx) return;
		const { owner, repo, branch } = repoCtx;
		const session = this.session;
		const message = `Rename: ${node.name} → ${newPath.split('/').pop()}`;

		// Rename from GitHub's copy, not the local cache: it is current and its sha is fresh.
		const remote = await getFileContent(owner, repo, node.path, branch);
		const created = await putFileContent(owner, repo, newPath, {
			message,
			content: remote.content.replace(/\s/g, ''),
			branch,
		});
		try {
			await deleteFileContent(owner, repo, node.path, { message, sha: remote.sha, branch });
		} catch (e) {
			// Undo the copy so a failed rename does not leave two files on GitHub.
			let reverted = true;
			await deleteFileContent(owner, repo, newPath, {
				message: `Revert: ${message}`,
				sha: created.content.sha,
				branch,
			}).catch(() => {
				reverted = false;
			});
			throw reverted ? e : new Error(`${(e as Error).message} (a copy may remain at ${newPath})`);
		}

		const docId = githubMetadataStore.findDocIdByPath(owner, repo, node.path);
		if (docId) {
			const meta = githubMetadataStore.getFileMetadata(docId);
			if (meta) githubMetadataStore.setFileMetadata(docId, { ...meta, path: newPath, sha: '' });
		}
		if (session.currentFileMetadata?.path === node.path) {
			session.applyExternalCurrentFileRename(node.path, newPath, { clearSha: true });
		}
		toast.success(`Renamed to ${newPath.split('/').pop()}`);
	}

	// --- Delete ---

	isFileDirty(path: string): boolean {
		const session = this.session;
		return (
			this.committedDirtyPaths.has(path) ||
			(session.currentFileMetadata?.path === path && session.hasUncommittedGitHubChanges)
		);
	}

	async commitFileBeforeDelete(node: FileNode): Promise<string> {
		const repoCtx = this.repoCtx;
		if (!repoCtx) return node.sha;
		const docId = githubMetadataStore.findDocIdByPath(repoCtx.owner, repoCtx.repo, node.path);
		if (!docId) return node.sha;
		const msg = `Save before delete: ${node.name}`;
		const session = this.session;
		if (docId === session.currentDoc.id) {
			await session.commitCurrentDocToGitHub(msg);
		} else {
			await githubStorageProvider.commitDocument(docId, msg);
			await githubMetadataStore.stampSyncTime(docId, Date.now());
		}
		const updatedSha =
			githubMetadataStore.getFileMetadata(docId)?.sha ??
			(docId === session.currentDoc.id ? session.currentFileMetadata?.sha : null) ??
			node.sha;
		toast.success(`Committed "${node.name}" before deletion`);
		return updatedSha;
	}

	async handleDelete(node: FileNode): Promise<void> {
		if (!this.repoCtx) return;

		if (node.type === 'folder') {
			function collectFiles(n: FileNode): FileNode[] {
				if (n.type === 'file') return [n];
				return (n.children ?? []).flatMap(collectFiles);
			}
			const files = collectFiles(node);
			const dirtyCount = files.filter((f) => !f.localOnly && this.isFileDirty(f.path)).length;
			const dirtyWarning =
				dirtyCount > 0
					? `\n\n⚠️ ${dirtyCount} file${dirtyCount === 1 ? ' has' : 's have'} uncommitted changes that will be lost.`
					: '';
			const names = files.map((f) => f.name).join(', ') || '(empty folder)';
			const confirmed = window.confirm(
				`Delete folder "${node.name}" and ${files.length} file${files.length === 1 ? '' : 's'}?\n\n${names}${dirtyWarning}`
			);
			if (!confirmed) return;
			for (const file of files) {
				await this.deleteSingleFile(file, true);
			}
			await this.fetchTree();
			return;
		}

		await this.deleteSingleFile(node, false);
	}

	async deleteSingleFile(node: FileNode, skipConfirm: boolean): Promise<void> {
		const repoCtx = this.repoCtx;
		if (!repoCtx) return;
		const session = this.session;
		let deleteSha = node.sha;

		if (node.localOnly) {
			const docId = loadLocalOnlyEntries(repoCtx).find((e) => e.path === node.path)?.docId;
			if (docId) {
				await githubStorageProvider.deleteDocument(docId);
				saveLocalOnlyEntries(
					repoCtx,
					loadLocalOnlyEntries(repoCtx).filter((e) => e.path !== node.path)
				);
				this.localOnlyNodes = entriesToNodes(loadLocalOnlyEntries(repoCtx));
				if (session.currentDoc.id === docId) {
					session.resetToBlankDocument();
				}
			}
			return;
		}

		if (!skipConfirm && this.isFileDirty(node.path)) {
			const commitFirst = window.confirm(
				`"${node.name}" has uncommitted local changes.\n\nCommit them to GitHub before deleting so you can restore from git history?\n\nOK = commit first, then stage for deletion\nCancel = stage for deletion without committing`
			);
			if (commitFirst) {
				try {
					deleteSha = await this.commitFileBeforeDelete(node);
				} catch {
					toast.error(`Failed to commit "${node.name}" — deletion cancelled`);
					return;
				}
			}
			skipConfirm = true;
		}

		if (!skipConfirm) {
			const confirmed = window.confirm(
				`Stage "${node.name}" for deletion?\n\nThe file will be deleted from GitHub when you commit.`
			);
			if (!confirmed) return;
		}

		this.pendingDeletedNodes.set(node.path, { sha: deleteSha, name: node.name });

		function removeFromTree(nodes: FileNode[]): FileNode[] {
			return nodes
				.filter((n) => n.path !== node.path)
				.map((n) => ({ ...n, children: n.children ? removeFromTree(n.children) : undefined }));
		}
		this.githubTree = removeFromTree(this.githubTree);

		if (session.currentFileMetadata?.path === node.path) {
			session.resetToBlankDocument();
		}

		this.uiState.activeGitHubTab = 'changes';
		toast.info(`"${node.name}" staged for deletion — commit to delete from GitHub`);
	}

	// --- Download ---

	async downloadFile(node: FileNode): Promise<void> {
		const repoCtx = this.repoCtx;
		if (!repoCtx) return;
		let content: string;
		const docId = node.localOnly
			? loadLocalOnlyEntries(repoCtx).find((e) => e.path === node.path)?.docId
			: githubMetadataStore.findDocIdByPath(repoCtx.owner, repoCtx.repo, node.path);

		if (docId) {
			content = (await this.loadPersistedDocumentText(docId)) ?? '{}';
		} else {
			const file = await getFileContent(repoCtx.owner, repoCtx.repo, node.path, repoCtx.branch);
			content = atob(file.content.replace(/\s/g, ''));
		}
		const blob = new Blob([content], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = node.name;
		a.click();
		URL.revokeObjectURL(url);
	}

	// --- Local folder management ---

	addLocalFolder(path: string): void {
		const repoCtx = this.repoCtx;
		persistAddLocalFolder(repoCtx, path);
		this.localFolderNodes = foldersToNodes(loadLocalFolderPaths(repoCtx));
	}

	// --- Branch ---

	async handleCreateBranch(branchName: string): Promise<void> {
		await this.session.createAndSwitchBranch(branchName);
		toast.success(`Switched to new branch "${branchName}"`, {
			description: 'You can now commit to this branch.',
		});
	}

	// --- Commit ---

	async commitAll(message: string, paths: string[]): Promise<CommitSummary | null> {
		const repoCtx = this.repoCtx;
		if (!repoCtx) return null;
		const session = this.session;

		const pathSet = new SvelteSet(paths);
		const result: CommitAllResult = { committed: [], conflicts: [], failed: [] };
		const reasonOf = (e: unknown) => (e instanceof Error && e.message) || 'Unknown error';

		const loEntries = loadLocalOnlyEntries(repoCtx).filter((e) => pathSet.has(e.path));
		for (const entry of loEntries) {
			githubMetadataStore.setFileMetadata(entry.docId, {
				path: entry.path,
				sha: '',
				owner: repoCtx.owner,
				repo: repoCtx.repo,
				branch: repoCtx.branch,
			});
			try {
				if (entry.docId === session.currentDoc.id) {
					await session.commitCurrentDocToGitHub(message);
				} else {
					await githubStorageProvider.commitDocument(entry.docId, message);
					await githubMetadataStore.stampSyncTime(entry.docId, Date.now());
				}
				result.committed.push(entry.name);
				saveLocalOnlyEntries(
					repoCtx,
					loadLocalOnlyEntries(repoCtx).filter((e) => e.docId !== entry.docId)
				);
			} catch (e) {
				githubMetadataStore.clearFileMetadata(entry.docId);
				result.failed.push({ name: entry.name, reason: reasonOf(e) });
			}
		}
		this.localOnlyNodes = entriesToNodes(loadLocalOnlyEntries(repoCtx));

		const currentFileMeta = session.currentFileMetadata;
		const modifiedPaths = new SvelteSet<string>(
			[...this.committedDirtyPaths].filter((p) => pathSet.has(p))
		);
		if (
			session.hasUncommittedGitHubChanges &&
			currentFileMeta?.path &&
			pathSet.has(currentFileMeta.path)
		) {
			modifiedPaths.add(currentFileMeta.path);
		}
		for (const dirtyPath of modifiedPaths) {
			if (this.pendingDeletedNodes.has(dirtyPath)) continue;
			const docId = githubMetadataStore.findDocIdByPath(repoCtx.owner, repoCtx.repo, dirtyPath);
			if (!docId) continue;
			const name = dirtyPath.split('/').pop()!;
			try {
				// "unknown" goes ahead: GitHub's SHA check still refuses a stale commit (caught below).
				if ((await githubStorageProvider.checkRemoteState(docId)) === 'changed') {
					result.conflicts.push(name);
					continue;
				}
				if (docId === session.currentDoc.id) {
					await session.commitCurrentDocToGitHub(message);
				} else {
					await githubStorageProvider.commitDocument(docId, message);
					await githubMetadataStore.stampSyncTime(docId, Date.now());
				}
				result.committed.push(name);
			} catch (e) {
				if (e instanceof GitHubConflictError) result.conflicts.push(name);
				else result.failed.push({ name, reason: reasonOf(e) });
			}
		}

		const deletionPaths = [...this.pendingDeletedNodes.keys()].filter((p) => pathSet.has(p));
		for (const path of deletionPaths) {
			const entry = this.pendingDeletedNodes.get(path)!;
			try {
				await deleteFileContent(repoCtx.owner, repoCtx.repo, path, {
					message: `Delete: ${path.split('/').pop()}`,
					sha: entry.sha,
					branch: repoCtx.branch,
				});
				this.pendingDeletedNodes.delete(path);
				const docId = githubMetadataStore.findDocIdByPath(repoCtx.owner, repoCtx.repo, path);
				if (docId) await githubStorageProvider.deleteDocument(docId);
				result.committed.push(entry.name);
			} catch (e) {
				result.failed.push({ name: entry.name, reason: reasonOf(e) });
			}
		}

		await this.fetchTree();

		const summary = summarizeCommitAll(result);
		if (summary.kind === 'success') {
			toast.success(summary.title, { description: message });
		} else {
			const show = summary.kind === 'partial' ? toast.warning : toast.error;
			show(summary.title, { description: summary.details.join('\n') });
		}
		return summary;
	}

	// --- Pull / discard ---

	/** `reason` labels the backup of the replaced copy (discard reuses the pull). */
	async doPull(reason: 'before_pull' | 'before_discard' = 'before_pull'): Promise<void> {
		const session = this.session;
		const repoCtx = this.repoCtx;
		const currentFileMeta = session.currentFileMetadata;
		if (!currentFileMeta) return;
		this.pulling = true;
		this.error = '';
		try {
			const ok = await session.pullCurrentDocFromGitHub(reason);
			if (ok) {
				this.committedDirtyPaths = await githubMetadataStore.getUncommittedPaths(
					repoCtx!.owner,
					repoCtx!.repo
				);
				if (reason === 'before_discard') {
					toast.success(`Discarded local changes to "${currentFileMeta.path}"`, {
						description:
							'Your version is kept in Backups (last 5 only). Download it there if you need it.',
					});
				} else {
					toast.success('Pulled latest version', {
						description: `${currentFileMeta.path} updated from ${currentFileMeta.branch}`,
					});
				}
			} else {
				this.error = 'Pull failed';
			}
		} catch (e) {
			this.error = (e as Error).message || 'Pull failed';
		} finally {
			this.pulling = false;
		}
	}

	async pullCurrentFile(): Promise<void> {
		const session = this.session;
		if (!session.currentFileMetadata) return;
		if (session.hasUncommittedGitHubChanges) {
			const ok = window.confirm(
				"You have local changes that haven't been committed to GitHub. Pulling will overwrite them. Continue?"
			);
			if (!ok) return;
		}
		await this.doPull();
	}

	async executeDiscard(entry: ChangeEntry): Promise<void> {
		const repoCtx = this.repoCtx;
		const session = this.session;

		if (entry.kind === 'deleted') {
			this.pendingDeletedNodes.delete(entry.path);
			await this.fetchTree();
			toast.success(`Deletion of "${entry.name}" cancelled`);
			return;
		}

		if (entry.kind === 'added') {
			const docId = loadLocalOnlyEntries(repoCtx).find((e) => e.path === entry.path)?.docId;
			if (docId) {
				await githubStorageProvider.deleteDocument(docId);
				saveLocalOnlyEntries(
					repoCtx,
					loadLocalOnlyEntries(repoCtx).filter((e) => e.path !== entry.path)
				);
				this.localOnlyNodes = entriesToNodes(loadLocalOnlyEntries(repoCtx));
				if (session.currentDoc.id === docId) {
					session.resetToBlankDocument();
				}
			}
			toast.success(`Discarded "${entry.name}"`);
			return;
		}

		// modified
		const isCurrentFile = session.currentFileMetadata?.path === entry.path;
		if (isCurrentFile) {
			await this.doPull('before_discard');
		} else {
			const docId = githubMetadataStore.findDocIdByPath(repoCtx!.owner, repoCtx!.repo, entry.path);
			if (docId) {
				// Replace the local copy with GitHub's, keeping it as a backup (the dialog promises one).
				await githubStorageProvider.pullDocument(docId, 'before_discard');
				await githubMetadataStore.stampSyncTime(docId, Date.now());
			}
			this.committedDirtyPaths = await githubMetadataStore.getUncommittedPaths(
				repoCtx!.owner,
				repoCtx!.repo
			);
			toast.success(`Discarded local changes to "${entry.name}"`, {
				description:
					'Your version is kept in Backups (last 5 only). Download it there if you need it.',
			});
		}
	}

	// --- Disconnect ---

	disconnect(): void {
		if (this.changeEntries.length > 0) {
			const ok = window.confirm(
				`You have ${this.changeEntries.length} uncommitted change${this.changeEntries.length === 1 ? '' : 's'}. Disconnecting will not delete your local copies, but the changes will no longer be tracked. Continue?`
			);
			if (!ok) return;
		}
		this.session.disconnectGitHub();
		this.githubTree = [];
		this.localOnlyNodes = [];
	}

	// --- Init helpers ---

	initFromPersistedState(): void {
		const repoCtx = this.repoCtx;
		this.localOnlyNodes = entriesToNodes(loadLocalOnlyEntries(repoCtx));
		this.localFolderNodes = foldersToNodes(loadLocalFolderPaths(repoCtx));
	}
}

/** Returns the filename without its extension(s) (e.g. "foo.fn.json" → "foo"). */
