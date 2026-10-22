<script lang="ts">
	import { help } from '$lib/components/help/help';
	import {
		LoaderCircle,
		AlertCircle,
		CloudDownload,
		GitMerge,
		FilePlus,
		ExternalLink,
		FileEdit,
		Copy,
		Download,
		Trash2,
		FolderPlus,
	} from '@lucide/svelte';
	import { getEditorDocumentSession } from '../context/EditorDocumentSession.svelte';
	import FileTreeNode from './FileTreeNode.svelte';
	import type { FileNode } from './types';
	import type { GitHubExplorerState } from './GitHubExplorerState.svelte';
	import { loadLocalOnlyEntries } from './localPersistence';
	import { isRenamableFile } from './fileNaming';
	import { toast } from 'svelte-sonner';
	import * as ContextMenu from '$lib/components/ui/context-menu/index.js';

	interface Props {
		explorerState: GitHubExplorerState;
		selectedFolderPath: string;
		onFolderSelect: (path: string) => void;
		onOpenDiff: (path: string | null) => void;
		onOpenNewFileDialog: () => void;
		onOpenCommitDialog: () => void;
	}

	const {
		explorerState,
		selectedFolderPath,
		onFolderSelect,
		onOpenDiff,
		onOpenNewFileDialog,
		onOpenCommitDialog,
	}: Props = $props();

	const session = getEditorDocumentSession();
	const repoCtx = $derived(session.currentRepoContext);
	const isDiverged = $derived(session.remoteAheadOfLocal && session.hasUncommittedGitHubChanges);

	const activePathValue = $derived.by(() => {
		const currentFileMeta = session.currentFileMetadata;
		if (currentFileMeta?.path) return currentFileMeta.path;
		const currentDocId = session.currentDoc?.id;
		if (!currentDocId) return '';
		void explorerState.localOnlyNodes; // reactive trigger
		return loadLocalOnlyEntries(repoCtx).find((e) => e.docId === currentDocId)?.path ?? '';
	});

	// --- Context menu ---

	let currentContextNode: FileNode | null = $state(null);

	function handleContextMenu(_e: MouseEvent, node: FileNode) {
		currentContextNode = node;
	}

	function handleEmptyAreaContextMenu(e: MouseEvent) {
		if (e.target !== e.currentTarget) return;
		currentContextNode = null;
	}

	async function handleContextMenuAction(type: string, node: FileNode | null) {
		if (type === 'open' && node?.type === 'file') {
			await explorerState.handleFileClick(node);
		} else if (type === 'rename' && node) {
			explorerState.requestRename(node);
		} else if (type === 'delete' && node) {
			await explorerState.handleDelete(node);
		} else if (type === 'copy-path' && node && repoCtx) {
			const fullPath = `${repoCtx.owner}/${repoCtx.repo}/${repoCtx.branch}/${node.path}`;
			await navigator.clipboard.writeText(fullPath);
			toast.success('Path copied to clipboard');
		} else if (type === 'download' && node?.type === 'file') {
			await explorerState.downloadFile(node);
		} else if (type === 'new-design') {
			const folderPath = node?.type === 'folder' ? node.path : '';
			onFolderSelect(folderPath);
			onOpenNewFileDialog();
		} else if (type === 'new-folder') {
			const parentPath = node?.type === 'folder' ? node.path : '';
			const raw = window.prompt('Folder name:');
			if (!raw?.trim()) return;
			const name = raw.trim().replace(/[/\\]/g, '-');
			const path = parentPath ? `${parentPath}/${name}` : name;
			explorerState.addLocalFolder(path);
		}
	}
</script>

{#if isDiverged}
	<div
		class="flex flex-col gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
	>
		<div class="flex items-center gap-1.5">
			<GitMerge size={13} class="shrink-0" />
			<span class="font-medium">Diverged — local and remote have both changed.</span>
		</div>
		<div class="flex flex-wrap gap-1.5 pl-5">
			<button
				class="rounded border border-amber-300 bg-background px-2 py-0.5 font-medium hover:bg-amber-100"
				onclick={() => onOpenDiff(null)}
				{@attach help({
					title: 'Review changes',
					text: 'Compare your local design with the GitHub version.',
				})}>Review changes</button
			>
			<button
				class="rounded border border-amber-300 bg-background px-2 py-0.5 font-medium hover:bg-amber-100"
				onclick={onOpenCommitDialog}
				{@attach help({ title: 'Commit local', text: 'Commit your local version to GitHub.' })}
				>Commit local</button
			>
			<button
				class="rounded border border-amber-300 bg-background px-2 py-0.5 font-medium hover:bg-amber-100 disabled:opacity-50"
				onclick={() => explorerState.doPull('before_pull')}
				{@attach help({
					title: 'Discard & pull',
					text: 'Drop your local changes and load the GitHub version. A local backup is saved first.',
				})}
				disabled={explorerState.pulling}
			>
				{#if explorerState.pulling}<LoaderCircle size={11} class="animate-spin" />{:else}Discard &
					pull{/if}
			</button>
		</div>
	</div>
{:else if session.remoteAheadOfLocal && session.currentFileMetadata}
	<div
		class="flex items-center justify-between gap-2 border-b border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700"
	>
		<div class="flex items-center gap-1.5">
			<CloudDownload size={13} class="shrink-0" />
			<span>GitHub has newer changes.</span>
		</div>
		<button
			class="rounded border border-blue-200 bg-background px-2 py-0.5 font-medium hover:bg-blue-100 disabled:opacity-50"
			onclick={() => explorerState.pullCurrentFile()}
			disabled={explorerState.pulling}
			{@attach help({ title: 'Pull', text: 'Load the newer GitHub version of this design.' })}
		>
			{#if explorerState.pulling}<LoaderCircle size={11} class="animate-spin" />{:else}Pull{/if}
		</button>
	</div>
{/if}

{#if explorerState.error}
	<div class="flex items-center gap-1.5 px-3 py-2 text-xs text-red-600">
		<AlertCircle size={13} />
		{explorerState.error}
	</div>
{/if}

<!-- File tree toolbar -->
<div class="flex items-center justify-between border-b border-border px-2 py-1">
	<span class="text-xs text-muted-foreground">
		{selectedFolderPath ? selectedFolderPath : '/'}
	</span>
	<button
		class="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-blue-600"
		title="New design file"
		{@attach help({
			title: 'New design file',
			text: 'Create an empty design file in the selected folder.',
		})}
		onclick={onOpenNewFileDialog}
	>
		<FilePlus size={13} />
	</button>
</div>

{#if explorerState.loading}
	<div class="flex items-center justify-center py-8">
		<LoaderCircle class="animate-spin text-muted-foreground" size={20} />
	</div>
{:else if explorerState.fileTree.length === 0}
	<p class="px-3 py-4 text-center text-xs text-muted-foreground">
		No .json files found in this repository.
	</p>
{:else}
	<ContextMenu.Root>
		<ContextMenu.Trigger class="block flex-1 overflow-y-auto">
			<div
				class="relative h-full overflow-y-auto p-1"
				role="tree"
				tabindex="-1"
				oncontextmenu={handleEmptyAreaContextMenu}
			>
				{#if explorerState.visibleLoadingFile}
					<div
						class="absolute inset-x-0 bottom-2 z-10 flex items-center gap-1.5 bg-background/80 px-2 py-1.5 text-xs text-blue-600"
					>
						<LoaderCircle class="animate-spin" size={13} />
						Loading {explorerState.visibleLoadingFile.split('/').pop()}…
					</div>
				{/if}
				{#each explorerState.fileTree as node (node.path)}
					<FileTreeNode
						{node}
						depth={0}
						activePath={activePathValue}
						{selectedFolderPath}
						dirtyPaths={explorerState.dirtyPaths}
						cleanLocalPaths={explorerState.cleanLocalPaths}
						onFileClick={(n) => explorerState.handleFileClick(n)}
						{onFolderSelect}
						renamingPath={explorerState.renamingPath}
						onRename={(n, stem) => explorerState.renameFile(n, stem)}
						onRenameEnd={() => (explorerState.renamingPath = '')}
						onDelete={(n) => explorerState.handleDelete(n)}
						onContextMenu={handleContextMenu}
					/>
				{/each}
			</div>
		</ContextMenu.Trigger>
		<ContextMenu.Content
			class="w-44"
			onCloseAutoFocus={(e) => {
				// The inline rename input takes focus; don't hand it back to the tree.
				if (explorerState.renamingPath) e.preventDefault();
			}}
		>
			{@const node = currentContextNode}
			{#if node?.type === 'file'}
				<ContextMenu.Item onclick={() => handleContextMenuAction('open', node)}>
					<ExternalLink class="size-3.5" />
					Open
				</ContextMenu.Item>
				{#if isRenamableFile(node)}
					<ContextMenu.Item onclick={() => handleContextMenuAction('rename', node)}>
						<FileEdit class="size-3.5" />
						Rename
					</ContextMenu.Item>
				{/if}
				<ContextMenu.Separator />
				<ContextMenu.Item onclick={() => handleContextMenuAction('copy-path', node)}>
					<Copy class="size-3.5" />
					Copy path
				</ContextMenu.Item>
				<ContextMenu.Item onclick={() => handleContextMenuAction('download', node)}>
					<Download class="size-3.5" />
					Download
				</ContextMenu.Item>
				<ContextMenu.Separator />
				<ContextMenu.Item
					variant="destructive"
					onclick={() => handleContextMenuAction('delete', node)}
				>
					<Trash2 class="size-3.5" />
					Delete
				</ContextMenu.Item>
			{:else if node?.type === 'folder'}
				<ContextMenu.Item onclick={() => handleContextMenuAction('new-design', node)}>
					<FilePlus class="size-3.5" />
					New design here
				</ContextMenu.Item>
				<ContextMenu.Item onclick={() => handleContextMenuAction('new-folder', node)}>
					<FolderPlus class="size-3.5" />
					New folder
				</ContextMenu.Item>
				<ContextMenu.Separator />
				<ContextMenu.Item
					variant="destructive"
					onclick={() => handleContextMenuAction('delete', node)}
				>
					<Trash2 class="size-3.5" />
					Delete folder
				</ContextMenu.Item>
			{:else}
				<!-- Empty area -->
				<ContextMenu.Item onclick={() => handleContextMenuAction('new-design', null)}>
					<FilePlus class="size-3.5" />
					New design
				</ContextMenu.Item>
				<ContextMenu.Item onclick={() => handleContextMenuAction('new-folder', null)}>
					<FolderPlus class="size-3.5" />
					New folder
				</ContextMenu.Item>
			{/if}
		</ContextMenu.Content>
	</ContextMenu.Root>
{/if}
