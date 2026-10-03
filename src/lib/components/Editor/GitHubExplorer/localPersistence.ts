import { githubExplorerStateStore, type GitHubLocalOnlyEntry } from '$lib/services/storage';
import type { GitHubRepoContext } from '$lib/services/storage';
import type { FileNode } from './types';

// ---------------------------------------------------------------------------
// Wrappers around GitHubExplorerStateStore that take repoCtx as a parameter
// ---------------------------------------------------------------------------

export function loadLocalOnlyEntries(repoCtx: GitHubRepoContext | null): GitHubLocalOnlyEntry[] {
	if (!repoCtx) return [];
	return githubExplorerStateStore.getLocalOnlyEntries(repoCtx.owner, repoCtx.repo);
}

export function saveLocalOnlyEntries(
	repoCtx: GitHubRepoContext | null,
	entries: GitHubLocalOnlyEntry[]
): void {
	if (!repoCtx) return;
	githubExplorerStateStore.saveLocalOnlyEntries(repoCtx.owner, repoCtx.repo, entries);
}

export function addLocalOnlyEntry(
	repoCtx: GitHubRepoContext | null,
	entry: GitHubLocalOnlyEntry
): void {
	if (!repoCtx) return;
	githubExplorerStateStore.addLocalOnlyEntry(repoCtx.owner, repoCtx.repo, entry);
}

export function loadLocalFolderPaths(repoCtx: GitHubRepoContext | null): string[] {
	if (!repoCtx) return [];
	return githubExplorerStateStore.getLocalFolderPaths(repoCtx.owner, repoCtx.repo);
}

export function saveLocalFolderPaths(repoCtx: GitHubRepoContext | null, paths: string[]): void {
	if (!repoCtx) return;
	githubExplorerStateStore.saveLocalFolderPaths(repoCtx.owner, repoCtx.repo, paths);
}

export function addLocalFolder(repoCtx: GitHubRepoContext | null, path: string): void {
	if (!repoCtx) return;
	githubExplorerStateStore.addLocalFolderPath(repoCtx.owner, repoCtx.repo, path);
}

// ---------------------------------------------------------------------------
// Node converters
// ---------------------------------------------------------------------------

export function entriesToNodes(entries: GitHubLocalOnlyEntry[]): FileNode[] {
	return entries.map((e) => ({
		name: e.name,
		path: e.path,
		type: 'file' as const,
		sha: '',
		localOnly: true,
	}));
}

export function foldersToNodes(paths: string[]): FileNode[] {
	return paths.map((p) => ({
		name: p.split('/').pop()!,
		path: p,
		type: 'folder' as const,
		sha: '',
		children: [],
	}));
}
