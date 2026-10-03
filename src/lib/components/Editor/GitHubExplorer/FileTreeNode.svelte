<script lang="ts">
	import {
		ChevronRight,
		ChevronDown,
		Folder,
		FolderOpen,
		FileJson2,
		Trash2,
		LoaderCircle,
	} from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import type { FileNode } from './types';
	import FileTreeNode from './FileTreeNode.svelte';
	import { fileStem, isRenamableFile, validateFileStem } from './fileNaming';

	interface Props {
		node: FileNode;
		depth?: number;
		activePath?: string;
		selectedFolderPath?: string;
		dirtyPaths?: ReadonlySet<string>;
		cleanLocalPaths?: ReadonlySet<string>;
		onFileClick: (node: FileNode) => void;
		onFolderSelect?: (path: string) => void;
		renamingPath?: string;
		/** `newStem` is the file name without its `.fn.json` extension. */
		onRename?: (node: FileNode, newStem: string) => Promise<void>;
		onRenameEnd?: () => void;
		onDelete?: (node: FileNode) => Promise<void>;
		onContextMenu?: (e: MouseEvent, node: FileNode) => void;
	}

	let {
		node,
		depth = 0,
		activePath = '',
		selectedFolderPath = '',
		dirtyPaths,
		cleanLocalPaths,
		onFileClick,
		onFolderSelect,
		renamingPath = '',
		onRename,
		onRenameEnd,
		onDelete,
		onContextMenu,
	}: Props = $props();

	const isActive = $derived(node.type === 'file' && node.path === activePath);
	const isFolderSelected = $derived(node.type === 'folder' && node.path === selectedFolderPath);

	let expanded = $state(depth === 0 || node.name === 'designs');

	// Inline rename state (files only; folders cannot be renamed)
	let renaming = $state(false);
	let renameValue = $state('');
	let renameInput = $state<HTMLInputElement | null>(null);
	let busy = $state(false); // true while rename/delete API call in-flight
	const canRename = $derived(!!onRename && isRenamableFile(node));

	function handleFolderClick() {
		if (isFolderSelected) {
			expanded = !expanded;
		} else {
			onFolderSelect?.(node.path);
			expanded = true;
		}
	}

	function beginRename() {
		renameValue = fileStem(node.name);
		renaming = true;
		// Focus input on next tick
		setTimeout(() => {
			renameInput?.focus();
			renameInput?.select();
		}, 0);
	}

	function startRename(e: MouseEvent | KeyboardEvent) {
		if (!canRename) return;
		e.stopPropagation();
		e.preventDefault();
		beginRename();
	}

	// Rename requested from outside (context menu)
	$effect(() => {
		if (canRename && renamingPath === node.path && !renaming) beginRename();
	});

	function cancelRename() {
		renaming = false;
		renameValue = '';
		onRenameEnd?.();
	}

	async function confirmRename(fromBlur = false) {
		if (!renaming) return; // Enter removes the input, which then blurs
		const newStem = renameValue.trim();
		if (!newStem || newStem === fileStem(node.name) || !onRename) {
			cancelRename();
			return;
		}
		const invalid = validateFileStem(newStem);
		if (invalid) {
			// Enter keeps the input open so the name can be fixed; a blur just abandons the edit.
			if (fromBlur) cancelRename();
			else toast.error(invalid);
			return;
		}
		renaming = false;
		onRenameEnd?.();
		busy = true;
		try {
			await onRename(node, newStem);
		} finally {
			busy = false;
		}
	}

	function handleRenameKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			confirmRename();
		} else if (e.key === 'Escape') {
			cancelRename();
		}
	}

	async function handleDelete(e: MouseEvent) {
		if (!onDelete) return;
		e.stopPropagation();
		busy = true;
		try {
			await onDelete(node);
		} finally {
			busy = false;
		}
	}
</script>

<div class="select-none">
	{#if node.type === 'folder'}
		<div
			role="none"
			class="group flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-sm hover:bg-muted
				{isFolderSelected ? 'ring-1 ring-blue-400 ring-inset' : ''}"
			style="padding-left: {depth * 12 + 4}px"
			oncontextmenu={(e) => {
				onContextMenu?.(e, node);
			}}
		>
			<button
				class="flex min-w-0 flex-1 items-center gap-1 overflow-hidden"
				onclick={handleFolderClick}
			>
				{#if expanded}
					<ChevronDown size={14} class="shrink-0 text-muted-foreground" />
					<FolderOpen size={14} class="shrink-0 text-yellow-500" />
				{:else}
					<ChevronRight size={14} class="shrink-0 text-muted-foreground" />
					<Folder size={14} class="shrink-0 text-yellow-500" />
				{/if}
				<span class="truncate text-foreground">{node.name}</span>
			</button>
			{#if busy}
				<LoaderCircle size={12} class="mr-1 shrink-0 animate-spin text-muted-foreground" />
			{:else}
				<button
					class="mr-0.5 shrink-0 rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-red-500"
					title="Delete folder"
					onclick={handleDelete}><Trash2 size={11} /></button
				>
			{/if}
		</div>
		{#if expanded && node.children}
			{#each node.children as child (child.path)}
				<FileTreeNode
					node={child}
					depth={depth + 1}
					{activePath}
					{selectedFolderPath}
					{dirtyPaths}
					{cleanLocalPaths}
					{onFileClick}
					{onFolderSelect}
					{renamingPath}
					{onRename}
					{onRenameEnd}
					{onDelete}
					{onContextMenu}
				/>
			{/each}
		{/if}
	{:else}
		<div
			role="none"
			class="group flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-sm
				{isActive
				? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
				: 'text-foreground hover:bg-muted hover:text-blue-700'}"
			style="padding-left: {depth * 12 + 4}px"
			oncontextmenu={(e) => {
				onContextMenu?.(e, node);
			}}
		>
			<button
				class="flex min-w-0 flex-1 items-center gap-1 overflow-hidden"
				onclick={() => {
					if (!renaming) onFileClick(node);
				}}
			>
				<span class="w-3.5 shrink-0"></span>
				<FileJson2 size={14} class="shrink-0 {isActive ? 'text-blue-600' : 'text-blue-400'}" />
				{#if renaming}
					<!-- svelte-ignore a11y_autofocus -->
					<input
						bind:this={renameInput}
						bind:value={renameValue}
						autofocus
						class="min-w-0 flex-1 rounded border border-blue-400 bg-background px-1 text-xs text-foreground outline-none"
						onkeydown={handleRenameKeydown}
						onblur={() => confirmRename(true)}
						onclick={(e) => e.stopPropagation()}
					/>
				{:else}
					<span
						class="truncate {isActive ? 'font-medium' : 'font-normal'}"
						ondblclick={startRename}
						role="button"
						tabindex="-1">{node.name}</span
					>
				{/if}
				{#if !renaming && (node.localOnly || dirtyPaths?.has(node.path))}
					<span
						class="ml-auto size-1.5 shrink-0 rounded-full bg-amber-400"
						title={node.localOnly
							? 'Local only — not yet committed to GitHub'
							: 'Uncommitted local changes'}
					></span>
				{:else if !renaming && cleanLocalPaths?.has(node.path)}
					<span
						class="ml-auto size-1.5 shrink-0 rounded-full border border-gray-400"
						title="Cached locally — no unsaved changes"
					></span>
				{/if}
			</button>
			{#if busy}
				<LoaderCircle size={12} class="mr-1 shrink-0 animate-spin text-muted-foreground" />
			{:else if !renaming}
				<button
					class="mr-0.5 shrink-0 rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-red-500"
					title="Delete file"
					onclick={handleDelete}><Trash2 size={11} /></button
				>
			{/if}
		</div>
	{/if}
</div>
