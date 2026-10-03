<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { LoaderCircle, GitBranch } from '@lucide/svelte';
	import { listRepos, listBranches } from '$lib/services/github/api';
	import type { GitHubRepo, GitHubBranch } from '$lib/services/github/types';
	import { githubMetadataStore } from '$lib/services/storage';

	interface Props {
		open: boolean;
		onConnected: () => void;
	}

	let { open = $bindable(), onConnected }: Props = $props();

	let repos = $state<GitHubRepo[]>([]);
	let branches = $state<GitHubBranch[]>([]);
	let selectedRepo = $state<GitHubRepo | null>(null);
	let selectedBranch = $state('');
	let searchQuery = $state('');
	let loadingRepos = $state(false);
	let loadingBranches = $state(false);
	let error = $state('');

	let filteredRepos = $derived(
		searchQuery
			? repos.filter(
					(r) =>
						r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
						r.full_name.toLowerCase().includes(searchQuery.toLowerCase())
				)
			: repos
	);

	async function fetchRepos() {
		loadingRepos = true;
		error = '';
		try {
			repos = await listRepos({ sort: 'updated', perPage: 50 });
		} catch (e) {
			error = (e as Error).message || 'Failed to load repositories';
		} finally {
			loadingRepos = false;
		}
	}

	async function selectRepo(repo: GitHubRepo) {
		selectedRepo = repo;
		selectedBranch = repo.default_branch;
		loadingBranches = true;
		try {
			branches = await listBranches(repo.owner.login, repo.name);
		} catch (e) {
			error = (e as Error).message || 'Failed to load branches';
		} finally {
			loadingBranches = false;
		}
	}

	function connect() {
		if (!selectedRepo) return;
		githubMetadataStore.setRepoContext({
			owner: selectedRepo.owner.login,
			repo: selectedRepo.name,
			branch: selectedBranch || selectedRepo.default_branch,
		});
		open = false;
		onConnected();
	}

	$effect(() => {
		if (open && repos.length === 0) {
			fetchRepos();
		}
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="flex max-h-[85vh] flex-col sm:max-w-lg">
		<Dialog.Header class="shrink-0">
			<Dialog.Title class="flex items-center gap-2">
				<GitBranch size={18} />
				Connect a GitHub Repository
			</Dialog.Title>
			<Dialog.Description>
				Select a repository and branch to browse design files. Synced files are stored in GitHub, so
				confirm whether the repository is private or public. Unsynced work remains in this browser's
				IndexedDB.
			</Dialog.Description>
		</Dialog.Header>

		<div class="min-h-0 flex-1 overflow-y-auto py-2">
			{#if error}
				<p class="mb-2 rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
			{/if}

			{#if !selectedRepo}
				<!-- Repo picker -->
				<div class="flex flex-col gap-2 px-1">
					<input
						type="text"
						placeholder="Search repositories…"
						bind:value={searchQuery}
						class="rounded border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-blue-400"
					/>
					{#if loadingRepos}
						<div class="flex items-center justify-center py-6">
							<LoaderCircle class="animate-spin text-muted-foreground" size={20} />
						</div>
					{:else}
						<div class="rounded border border-border">
							{#each filteredRepos as repo (repo.id)}
								<button
									class="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-muted"
									onclick={() => selectRepo(repo)}
								>
									<span class="font-medium text-foreground">{repo.full_name}</span>
									{#if repo.description}
										<span class="truncate text-xs text-muted-foreground">{repo.description}</span>
									{/if}
								</button>
							{:else}
								<p class="px-3 py-4 text-center text-sm text-muted-foreground">
									No repositories found
								</p>
							{/each}
						</div>
						<p class="mt-2 text-xs text-muted-foreground">
							Can't find a private repository?
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
							<a href="/api/auth/github/install" class="text-blue-500 hover:underline"
								>Install or configure app access →</a
							>
						</p>
					{/if}
				</div>
			{:else}
				<!-- Branch picker -->
				<div class="flex flex-col gap-3 px-1">
					<button
						class="text-left text-sm text-blue-600 hover:underline"
						onclick={() => {
							selectedRepo = null;
							branches = [];
						}}
					>
						← Back to repositories
					</button>
					<p class="text-sm font-medium text-foreground">{selectedRepo.full_name}</p>

					<div class="flex flex-col gap-1">
						<label class="text-xs font-medium text-muted-foreground" for="branch-select"
							>Branch</label
						>
						{#if loadingBranches}
							<div class="flex items-center gap-2 text-sm text-muted-foreground">
								<LoaderCircle class="animate-spin" size={14} /> Loading branches…
							</div>
						{:else}
							<select
								id="branch-select"
								bind:value={selectedBranch}
								class="rounded border border-gray-200 px-3 py-1.5 text-sm"
							>
								{#each branches as b (b.name)}
									<option value={b.name}>{b.name}</option>
								{/each}
							</select>
						{/if}
					</div>
				</div>
			{/if}
		</div>

		<Dialog.Footer class="shrink-0">
			<Button
				variant="outline"
				onclick={() => {
					open = false;
				}}>Cancel</Button
			>
			<Button onclick={connect} disabled={!selectedRepo || loadingBranches}>Connect</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
