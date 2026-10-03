<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		LoaderCircle,
		GitCommitHorizontal,
		AlertTriangle,
		GitPullRequestArrow,
		GitBranch,
		GitMerge,
	} from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { githubStorageProvider } from '$lib/services/storage/providers/GitHubStorageProvider';
	import { GitHubConflictError } from '$lib/services/github/api';
	import { getEditorDocumentSession } from '../context/EditorDocumentSession.svelte';
	import DiffDialog from '../GitHubDiff/DiffDialog.svelte';
	import { modKeySymbol } from '$lib/utils/platform';

	const mod = modKeySymbol();

	interface Props {
		open: boolean;
	}

	let { open = $bindable() }: Props = $props();

	const session = getEditorDocumentSession();

	let message = $state('');
	let busy = $state(false);
	let error = $state('');
	let conflictDetected = $state(false);

	// New-branch inline form
	let creatingBranch = $state(false);
	let newBranchName = $state('');
	let creatingBranchBusy = $state(false);
	let diffDialogOpen = $state(false);

	const docId = $derived(session.currentDoc.id);
	const fileMeta = $derived(session.currentFileMetadata);
	const isMainBranch = $derived(fileMeta?.branch === 'main' || fileMeta?.branch === 'master');

	$effect(() => {
		if (open) {
			message = '';
			error = '';
			conflictDetected = false;
			creatingBranch = false;
			newBranchName = '';
		}
	});

	async function switchToBranch() {
		if (!newBranchName.trim() || !fileMeta) return;
		creatingBranchBusy = true;
		error = '';
		try {
			await session.createAndSwitchBranch(newBranchName.trim());
			toast.success(`Switched to new branch "${newBranchName.trim()}"`, {
				description: 'You can now commit to this branch.',
			});
			creatingBranch = false;
			newBranchName = '';
		} catch (e) {
			error = (e as Error).message || 'Failed to create branch';
		} finally {
			creatingBranchBusy = false;
		}
	}

	async function commit() {
		if (!message.trim() || !fileMeta) return;
		busy = true;
		error = '';
		conflictDetected = false;
		try {
			// "unknown" goes ahead: GitHub's own SHA check still refuses a stale commit (caught below).
			if ((await githubStorageProvider.checkRemoteState(docId)) === 'changed') {
				conflictDetected = true;
				return;
			}
			const sha = await session.commitCurrentDocToGitHub(message.trim());
			open = false;
			toast.success('Committed successfully', {
				description: `${fileMeta.path} → ${fileMeta.branch} (${sha.slice(0, 7)})`,
			});
		} catch (e) {
			if (e instanceof GitHubConflictError) {
				conflictDetected = true;
				return;
			}
			error = (e as Error).message || 'Commit failed';
		} finally {
			busy = false;
		}
	}

	async function forceOverwrite() {
		if (!message.trim() || !fileMeta) return;
		busy = true;
		error = '';
		conflictDetected = false;
		try {
			const sha = await session.overwriteGitHubWithLocal(message.trim());
			open = false;
			toast.success('Force-committed successfully', {
				description: `${fileMeta.path} → ${fileMeta.branch} (${sha.slice(0, 7)})`,
			});
		} catch (e) {
			error = (e as Error).message || 'Commit failed';
		} finally {
			busy = false;
		}
	}

	async function pullLatest() {
		if (!fileMeta) return;
		const hasLocalChanges = session.hasUncommittedGitHubChanges;
		if (hasLocalChanges) {
			const ok = window.confirm('Pulling will overwrite your local changes. Continue?');
			if (!ok) return;
		}
		busy = true;
		error = '';
		conflictDetected = false;
		try {
			const ok = await session.pullCurrentDocFromGitHub('before_accept_remote');
			if (ok) {
				open = false;
				toast.success('Pulled latest version', {
					description: `${fileMeta.path} updated from ${fileMeta.branch}`,
				});
			} else {
				error = 'Pull failed — check the console for details';
			}
		} catch (e) {
			error = (e as Error).message || 'Pull failed';
		} finally {
			busy = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<GitCommitHorizontal size={18} />
				Commit to GitHub
			</Dialog.Title>
			{#if fileMeta}
				<Dialog.Description class="font-mono text-xs">
					{fileMeta.path}
					<span class="ml-1 rounded bg-muted px-1 not-italic">{fileMeta.branch}</span>
				</Dialog.Description>
			{/if}
		</Dialog.Header>

		<div class="flex flex-col gap-3 py-1">
			{#if isMainBranch}
				<div
					class="flex flex-col gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300"
				>
					<div class="flex items-start gap-2">
						<AlertTriangle size={14} class="mt-0.5 shrink-0" />
						<div class="flex flex-1 flex-wrap items-center justify-between gap-1">
							<span>Committing directly to <strong>{fileMeta?.branch}</strong>.</span>
							{#if !creatingBranch}
								<button
									class="flex items-center gap-1 rounded border border-amber-300 bg-background px-2 py-0.5 font-medium text-amber-700 hover:bg-amber-100"
									onclick={() => {
										creatingBranch = true;
										newBranchName = '';
									}}
								>
									<GitBranch size={11} />
									Create new branch
								</button>
							{/if}
						</div>
					</div>
					{#if creatingBranch}
						<div class="flex items-center gap-1.5 pl-5">
							<input
								type="text"
								placeholder="branch-name"
								bind:value={newBranchName}
								class="flex-1 rounded border border-amber-300 bg-background px-2 py-1 text-xs outline-none focus:border-blue-400"
								onkeydown={(e) => {
									if (e.key === 'Enter') switchToBranch();
									if (e.key === 'Escape') {
										creatingBranch = false;
									}
								}}
							/>
							<button
								class="rounded border border-amber-300 bg-background px-2 py-1 font-medium hover:bg-amber-100 disabled:opacity-50"
								onclick={switchToBranch}
								disabled={!newBranchName.trim() || creatingBranchBusy}
							>
								{#if creatingBranchBusy}<LoaderCircle
										size={11}
										class="animate-spin"
									/>{:else}Create{/if}
							</button>
							<button
								class="rounded px-1 py-1 hover:bg-amber-100"
								onclick={() => {
									creatingBranch = false;
								}}>✕</button
							>
						</div>
					{/if}
				</div>
			{/if}

			{#if error}
				<p class="rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
			{/if}

			{#if conflictDetected}
				<div
					class="flex flex-col gap-2 rounded border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700"
				>
					<p class="font-medium">Conflict detected</p>
					<p class="text-xs">
						The file on GitHub has changed since you last synced. Choose an option:
					</p>
					<div class="flex flex-wrap gap-2 pt-1">
						<Button
							size="sm"
							variant="outline"
							onclick={() => {
								diffDialogOpen = true;
							}}
							disabled={busy}
						>
							<GitMerge size={13} />
							View diff
						</Button>
						<Button size="sm" variant="destructive" onclick={forceOverwrite} disabled={busy}>
							{#if busy}<LoaderCircle class="animate-spin" size={13} />{/if}
							Force overwrite
						</Button>
						<Button size="sm" variant="outline" onclick={pullLatest} disabled={busy}>
							{#if busy}<LoaderCircle class="animate-spin" size={13} />{/if}
							<GitPullRequestArrow size={13} />
							Pull latest first
						</Button>
					</div>
				</div>
			{:else}
				<div class="flex flex-col gap-1.5">
					<label class="text-xs font-medium text-muted-foreground" for="commit-message"
						>Commit message</label
					>
					<textarea
						id="commit-message"
						rows={3}
						placeholder="Describe your changes…"
						bind:value={message}
						class="w-full resize-none rounded border border-border px-3 py-2 text-sm outline-none focus:border-blue-400"
						onkeydown={(e) => {
							if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit();
						}}
					></textarea>
					<p class="text-xs text-muted-foreground">Tip: {mod}↵ to commit</p>
				</div>
			{/if}
		</div>

		{#if !conflictDetected}
			<Dialog.Footer>
				<Button
					variant="outline"
					onclick={() => {
						open = false;
					}}>Cancel</Button
				>
				<Button onclick={commit} disabled={!message.trim() || busy || !fileMeta}>
					{#if busy}<LoaderCircle class="animate-spin" size={14} />{/if}
					Commit
				</Button>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<DiffDialog bind:open={diffDialogOpen} />
