<script lang="ts">
	import { help } from '$lib/components/help/help';
	import type { CommitSummary } from './commitSummary';
	import {
		LoaderCircle,
		GitCommitHorizontal,
		AlertTriangle,
		FilePlus,
		FileEdit,
		Trash2,
		Plus,
		Minus,
		RotateCcw,
		GitBranch,
	} from '@lucide/svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import type { ChangeEntry } from './types';
	import type { GitHubRepoContext } from '$lib/services/storage';
	import * as ContextMenu from '$lib/components/ui/context-menu/index.js';
	import { modKeySymbol } from '$lib/utils/platform';

	const mod = modKeySymbol();

	interface Props {
		changes: ChangeEntry[];
		repoCtx: GitHubRepoContext | null;
		onCommit: (message: string, paths: string[]) => Promise<CommitSummary | null>;
		onFileClick: (path: string) => void;
		onDiscard: (path: string) => void;
		onCreateBranch: (branchName: string) => Promise<void>;
	}

	let { changes, repoCtx, onCommit, onFileClick, onDiscard, onCreateBranch }: Props = $props();

	let message = $state('');
	let busy = $state(false);
	let error = $state('');
	// The last multi-file commit that didn't fully go through, kept until the next attempt.
	let lastSummary = $state<CommitSummary | null>(null);
	let stagedPaths = new SvelteSet<string>();

	// New-branch inline form
	let creatingBranch = $state(false);
	let newBranchName = $state('');
	let creatingBranchBusy = $state(false);
	let branchError = $state('');

	async function handleCreateBranch() {
		if (!newBranchName.trim()) return;
		creatingBranchBusy = true;
		branchError = '';
		try {
			await onCreateBranch(newBranchName.trim());
			creatingBranch = false;
			newBranchName = '';
		} catch (e) {
			branchError = (e as Error).message || 'Failed to create branch';
		} finally {
			creatingBranchBusy = false;
		}
	}

	// Prune staged paths that no longer exist in changes (e.g. after a successful commit)
	$effect(() => {
		const validPaths = new Set(changes.map((c) => c.path));
		for (const p of [...stagedPaths]) {
			if (!validPaths.has(p)) stagedPaths.delete(p);
		}
	});

	const staged = $derived(changes.filter((c) => stagedPaths.has(c.path)));
	const unstaged = $derived(changes.filter((c) => !stagedPaths.has(c.path)));

	const isMainBranch = $derived(repoCtx?.branch === 'main' || repoCtx?.branch === 'master');

	function stage(path: string) {
		stagedPaths.add(path);
	}
	function unstage(path: string) {
		stagedPaths.delete(path);
	}
	function stageAll() {
		for (const c of changes) stagedPaths.add(c.path);
	}
	function unstageAll() {
		stagedPaths.clear();
	}

	async function handleCommit() {
		if (!message.trim() || staged.length === 0) return;
		busy = true;
		error = '';
		lastSummary = null;
		try {
			const summary = await onCommit(
				message.trim(),
				staged.map((c) => c.path)
			);
			// Keep the message when something is left, so retrying is one click.
			if (!summary || summary.kind === 'success') message = '';
			else lastSummary = summary;
		} catch (e) {
			error = (e as Error).message || 'Commit failed';
		} finally {
			busy = false;
		}
	}
</script>

{#snippet fileRow(entry: ChangeEntry, isStaged: boolean)}
	<ContextMenu.Root>
		<ContextMenu.Trigger class="block w-full">
			<div
				class="group flex w-full items-center gap-1 rounded px-2 py-0.5 text-xs hover:bg-muted"
				role="none"
			>
				<button
					class="shrink-0 text-left"
					title={entry.path}
					onclick={() => entry.kind !== 'deleted' && onFileClick(entry.path)}
				>
					{#if entry.kind === 'added'}
						<FilePlus size={12} class="text-green-500" />
					{:else if entry.kind === 'deleted'}
						<Trash2 size={12} class="text-red-400" />
					{:else}
						<FileEdit size={12} class="text-amber-400" />
					{/if}
				</button>
				<button
					class="min-w-0 flex-1 truncate text-left {entry.kind === 'deleted'
						? 'text-red-400 line-through'
						: 'text-foreground'}"
					title={entry.path}
					onclick={() => entry.kind !== 'deleted' && onFileClick(entry.path)}
				>
					{entry.name}
				</button>
				<span
					class="shrink-0 truncate text-muted-foreground"
					style="max-width:6rem"
					title={entry.path}
				>
					{entry.path.includes('/') ? entry.path.split('/').slice(0, -1).join('/') : ''}
				</span>
				{#if entry.kind === 'added'}
					<span class="shrink-0 font-bold text-green-600" title="New file">A</span>
				{:else if entry.kind === 'deleted'}
					<span class="shrink-0 font-bold text-red-500" title="Deleted">D</span>
				{:else}
					<span class="shrink-0 font-bold text-amber-500" title="Modified">M</span>
				{/if}
				<!-- Stage / unstage toggle -->
				{#if isStaged}
					<button
						class="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-red-500"
						title="Unstage"
						{@attach help({ title: 'Unstage', text: 'Leave this file out of the next commit.' })}
						onclick={() => unstage(entry.path)}><Minus size={11} /></button
					>
				{:else}
					<button
						class="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-green-600"
						title="Stage"
						{@attach help({ title: 'Stage', text: 'Include this file in the next commit.' })}
						onclick={() => stage(entry.path)}><Plus size={11} /></button
					>
				{/if}
			</div>
		</ContextMenu.Trigger>
		<ContextMenu.Content>
			<ContextMenu.Item variant="destructive" onclick={() => onDiscard(entry.path)}>
				<RotateCcw class="size-3.5" />
				{entry.kind === 'deleted' ? 'Undo staged deletion' : 'Discard changes'}
			</ContextMenu.Item>
		</ContextMenu.Content>
	</ContextMenu.Root>
{/snippet}

<div class="flex h-full flex-col overflow-hidden">
	{#if changes.length === 0}
		<div
			class="flex flex-col items-center justify-center gap-2 py-10 text-center text-xs text-muted-foreground"
		>
			<GitCommitHorizontal size={28} class="text-gray-200" />
			<span>No local changes</span>
		</div>
	{:else}
		<div class="flex-1 overflow-y-auto">
			<!-- Staged section -->
			<div class="flex items-center justify-between px-2 py-1">
				<span class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
					Staged ({staged.length})
				</span>
				{#if staged.length > 0}
					<button
						class="rounded p-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-red-500"
						title="Unstage all"
						{@attach help({
							title: 'Unstage all',
							text: 'Move every staged file back to Changes.',
						})}
						onclick={unstageAll}><Minus size={11} /></button
					>
				{/if}
			</div>
			{#if staged.length === 0}
				<p class="px-2 pb-2 text-xs text-muted-foreground italic">
					No staged files — click + to stage
				</p>
			{:else}
				{#each staged as entry (entry.path)}
					{@render fileRow(entry, true)}
				{/each}
			{/if}

			<!-- Unstaged section -->
			<div class="mt-1 flex items-center justify-between px-2 py-1">
				<span class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
					Changes ({unstaged.length})
				</span>
				{#if unstaged.length > 0}
					<button
						class="rounded p-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-green-600"
						title="Stage all"
						{@attach help({
							title: 'Stage all',
							text: 'Include every changed file in the next commit.',
						})}
						onclick={stageAll}><Plus size={11} /></button
					>
				{/if}
			</div>
			{#each unstaged as entry (entry.path)}
				{@render fileRow(entry, false)}
			{/each}
		</div>

		<!-- Commit section -->
		<div class="flex flex-col gap-2 border-t border-border p-2">
			{#if isMainBranch && repoCtx}
				<div
					class="flex flex-col gap-1.5 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-700 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300"
				>
					<div class="flex items-center justify-between gap-1.5">
						<div class="flex items-center gap-1.5">
							<AlertTriangle size={12} class="shrink-0" />
							<span>Committing directly to <strong>{repoCtx.branch}</strong></span>
						</div>
						{#if !creatingBranch}
							<button
								class="flex shrink-0 items-center gap-1 rounded border border-amber-300 bg-background px-1.5 py-0.5 font-medium text-amber-700 hover:bg-amber-100"
								onclick={() => {
									creatingBranch = true;
									newBranchName = '';
									branchError = '';
								}}
								{@attach help({
									title: 'New branch',
									text: 'Create a branch from the current one and switch to it, so you commit there instead.',
								})}><GitBranch size={11} /> New branch</button
							>
						{/if}
					</div>
					{#if creatingBranch}
						<div class="flex items-center gap-1.5">
							<input
								type="text"
								placeholder="branch-name"
								bind:value={newBranchName}
								class="flex-1 rounded border border-amber-300 bg-background px-2 py-1 text-xs outline-none focus:border-blue-400"
								onkeydown={(e) => {
									if (e.key === 'Enter') handleCreateBranch();
									if (e.key === 'Escape') {
										creatingBranch = false;
									}
								}}
							/>
							<button
								class="rounded border border-amber-300 bg-background px-2 py-1 font-medium hover:bg-amber-100 disabled:opacity-50"
								onclick={handleCreateBranch}
								disabled={!newBranchName.trim() || creatingBranchBusy}
								>{#if creatingBranchBusy}<LoaderCircle
										size={11}
										class="animate-spin"
									/>{:else}Create{/if}</button
							>
							<button
								class="rounded px-1 py-1 hover:bg-amber-100"
								onclick={() => {
									creatingBranch = false;
								}}>✕</button
							>
						</div>
						{#if branchError}
							<p class="text-xs text-red-600">{branchError}</p>
						{/if}
					{/if}
				</div>
			{:else if repoCtx}
				<div class="flex items-center justify-between gap-1.5">
					<span class="truncate text-xs text-muted-foreground"
						>Branch: <strong class="text-muted-foreground">{repoCtx.branch}</strong></span
					>
					{#if !creatingBranch}
						<button
							class="flex shrink-0 items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted"
							onclick={() => {
								creatingBranch = true;
								newBranchName = '';
								branchError = '';
							}}
							{@attach help({
								title: 'New branch',
								text: 'Create a branch from the current one and switch to it, so you commit there instead.',
							})}><GitBranch size={11} /> New branch</button
						>
					{:else}
						<div class="flex flex-1 items-center gap-1.5">
							<input
								type="text"
								placeholder="branch-name"
								bind:value={newBranchName}
								class="min-w-0 flex-1 rounded border border-border px-2 py-0.5 text-xs outline-none focus:border-blue-400"
								onkeydown={(e) => {
									if (e.key === 'Enter') handleCreateBranch();
									if (e.key === 'Escape') {
										creatingBranch = false;
									}
								}}
							/>
							<button
								class="shrink-0 rounded border border-border bg-background px-2 py-0.5 text-xs hover:bg-muted disabled:opacity-50"
								onclick={handleCreateBranch}
								disabled={!newBranchName.trim() || creatingBranchBusy}
								>{#if creatingBranchBusy}<LoaderCircle
										size={11}
										class="animate-spin"
									/>{:else}Create{/if}</button
							>
							<button
								class="shrink-0 rounded px-1 py-0.5 text-xs hover:bg-muted"
								onclick={() => {
									creatingBranch = false;
								}}>✕</button
							>
						</div>
					{/if}
				</div>
				{#if branchError}
					<p class="rounded bg-red-50 px-2 py-1 text-xs text-red-600">{branchError}</p>
				{/if}
			{/if}

			{#if error}
				<p class="rounded bg-red-50 px-2 py-1.5 text-xs text-red-600">{error}</p>
			{/if}
			{#if lastSummary}
				<div
					class="rounded px-2 py-1.5 text-xs {lastSummary.kind === 'partial'
						? 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
						: 'bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-300'}"
				>
					<p class="font-medium">{lastSummary.title}</p>
					<ul class="mt-1 list-disc space-y-0.5 pl-4">
						{#each lastSummary.details as line, i (i)}
							<li>{line}</li>
						{/each}
					</ul>
				</div>
			{/if}

			<textarea
				rows={3}
				placeholder="Commit message…"
				{@attach help({ title: 'Commit message', text: `Describe the change. ${mod}↵ commits.` })}
				bind:value={message}
				class="w-full resize-none rounded border border-border px-2 py-1.5 text-xs outline-none focus:border-blue-400"
				onkeydown={(e) => {
					if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleCommit();
				}}
			></textarea>

			<button
				class="flex w-full items-center justify-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
				onclick={handleCommit}
				disabled={!message.trim() || busy || staged.length === 0}
				{@attach help({
					title: 'Commit',
					text: 'Save the staged files to GitHub as one commit on this branch.',
					doc: 'saving-github',
				})}
			>
				{#if busy}
					<LoaderCircle size={12} class="animate-spin" />
				{:else}
					<GitCommitHorizontal size={12} />
				{/if}
				{#if staged.length === 0}
					Commit — stage files first
				{:else}
					Commit {staged.length} file{staged.length === 1 ? '' : 's'}
				{/if}
			</button>
			<p class="text-center text-xs text-muted-foreground">{mod}↵ to commit</p>
		</div>
	{/if}
</div>
