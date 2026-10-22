<script lang="ts">
	import { help } from '$lib/components/help/help';
	import { LoaderCircle, RefreshCw, GitBranch, Plus } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import * as Select from '$lib/components/ui/select/index.js';
	import { listBranches, listCommits, createBranch, getRepo } from '$lib/services/github/api';
	import { getEditorDocumentSession } from '../context/EditorDocumentSession.svelte';
	import {
		computeLayout,
		pickGraphBranches,
		rowInstructions,
		laneColor,
		lx,
		LANE_WIDTH,
		ROW_HEIGHT,
		DOT_RADIUS,
		relativeDate,
		type CommitNode,
	} from '$lib/services/github/gitGraph';
	import type { GitHubBranch, GitHubCommit } from '$lib/services/github/types';
	import type { ChangeEntry } from '../GitHubExplorer/types';

	interface Props {
		onBranchSwitch?: () => void;
		changes?: ChangeEntry[];
	}
	let { onBranchSwitch, changes = [] }: Props = $props();

	const session = getEditorDocumentSession();
	const repoCtx = $derived(session.currentRepoContext);
	const currentFileMeta = $derived(session.currentFileMetadata);

	// ─── State ──────────────────────────────────────────────────────────────

	let branches = $state<GitHubBranch[]>([]);
	/** The subset of `branches` whose history is loaded into the graph. */
	let graphBranches = $state<GitHubBranch[]>([]);
	let allCommits = $state<Map<string, GitHubCommit>>(new Map());
	let layoutRows = $state<CommitNode[]>([]);
	let graphWidth = $state(LANE_WIDTH * 2); // grows as more lanes appear

	let loading = $state(false);
	let loadingMore = $state(false);
	let error = $state('');
	let switching = $state('');

	/** Next page index per branch sha (for load-more) */
	let nextPage = $state<Map<string, number>>(new Map());

	// Create-branch form
	let creatingBranch = $state(false);
	let newBranchName = $state('');
	let createBusy = $state(false);

	// ─── Data loading ────────────────────────────────────────────────────────

	async function fetchAll() {
		if (!repoCtx) return;
		loading = true;
		error = '';
		try {
			const [allBranches, defaultBranch] = await Promise.all([
				listBranches(repoCtx.owner, repoCtx.repo, 100),
				// Only used to prioritise branches; the graph still works without it
				getRepo(repoCtx.owner, repoCtx.repo).then(
					(r) => r.default_branch,
					() => null
				),
			]);
			branches = allBranches;
			graphBranches = pickGraphBranches(allBranches, repoCtx.branch, defaultBranch);

			const branchesToFetch = graphBranches;
			// eslint-disable-next-line svelte/prefer-svelte-reactivity
			const pages = new Map<string, number>();
			const results = await Promise.all(
				branchesToFetch.map((b) =>
					listCommits(repoCtx!.owner, repoCtx!.repo, { sha: b.commit.sha, perPage: 50 }).then(
						(commits) => {
							pages.set(b.commit.sha, 2);
							return commits;
						}
					)
				)
			);

			// eslint-disable-next-line svelte/prefer-svelte-reactivity
			const merged = new Map<string, GitHubCommit>();
			for (const commits of results) {
				for (const c of commits) merged.set(c.sha, c);
			}

			allCommits = merged;
			nextPage = pages;
			rebuildLayout(merged, branches);
		} catch (e) {
			error = (e as Error).message || 'Failed to load graph';
		} finally {
			loading = false;
		}
	}

	async function loadMore() {
		if (!repoCtx || loadingMore) return;
		loadingMore = true;
		try {
			const branchesToFetch = graphBranches;
			const results = await Promise.all(
				branchesToFetch.map((b) => {
					const page = nextPage.get(b.commit.sha) ?? 2;
					return listCommits(repoCtx!.owner, repoCtx!.repo, {
						sha: b.commit.sha,
						perPage: 50,
						page,
					}).then((commits) => {
						nextPage.set(b.commit.sha, page + 1);
						return commits;
					});
				})
			);

			// eslint-disable-next-line svelte/prefer-svelte-reactivity
			const merged = new Map(allCommits);
			let newCount = 0;
			for (const commits of results) {
				for (const c of commits) {
					if (!merged.has(c.sha)) {
						merged.set(c.sha, c);
						newCount++;
					}
				}
			}

			if (newCount === 0) {
				toast.info('No more commits to load');
			} else {
				allCommits = merged;
				rebuildLayout(merged, branches);
			}
		} catch (e) {
			error = (e as Error).message || 'Failed to load more';
		} finally {
			loadingMore = false;
		}
	}

	function rebuildLayout(commits: Map<string, GitHubCommit>, refs: GitHubBranch[]) {
		if (!repoCtx) return;

		// Topological sort: newest-first by author date
		const sorted = [...commits.values()].sort((a, b) => {
			const da = a.commit.author?.date ?? '';
			const db = b.commit.author?.date ?? '';
			return db.localeCompare(da);
		});

		const rows = computeLayout(sorted, refs, repoCtx.branch);
		layoutRows = rows;

		// Compute max lanes across all rows for a consistent SVG width
		const max = rows.reduce((m, r) => Math.max(m, r.maxLanes), 1);
		graphWidth = Math.max(max * LANE_WIDTH + 4, LANE_WIDTH * 2);
	}

	// ─── Branch actions ──────────────────────────────────────────────────────

	async function switchToBranch(targetBranch: string) {
		if (!repoCtx || targetBranch === repoCtx.branch) return;
		switching = targetBranch;
		error = '';
		try {
			const result = await session.switchToBranch(targetBranch);
			if (result.fileMissing) {
				toast.success(`Switched to ${targetBranch}`, {
					description: 'File not found on this branch',
				});
			} else if (result.reloaded && currentFileMeta) {
				toast.success(`Switched to ${targetBranch}`, {
					description: `${currentFileMeta.path} reloaded`,
				});
			} else {
				toast.success(`Switched to ${targetBranch}`);
			}

			// Rebuild layout so current-branch highlight updates
			rebuildLayout(allCommits, branches);
			onBranchSwitch?.();
		} catch (e) {
			const message = (e as Error).message || 'Failed to switch branch';
			if (message.startsWith('Commit or discard changes first:')) {
				toast.error('Cannot switch branch', { description: message });
			} else {
				error = message;
			}
		} finally {
			switching = '';
		}
	}

	async function handleCreateBranch() {
		const name = newBranchName.trim();
		if (!name || !repoCtx) return;
		createBusy = true;
		error = '';
		try {
			const current = branches.find((b) => b.name === repoCtx!.branch);
			if (!current) throw new Error(`Branch "${repoCtx.branch}" not found`);
			await createBranch(repoCtx.owner, repoCtx.repo, name, current.commit.sha);
			creatingBranch = false;
			newBranchName = '';
			await fetchAll();
			await switchToBranch(name);
		} catch (e) {
			error = (e as Error).message || 'Failed to create branch';
		} finally {
			createBusy = false;
		}
	}

	const graphBranchNames = $derived(new Set(graphBranches.map((b) => b.name)));

	// Lane of the current branch HEAD — used to anchor the uncommitted-changes row
	const headLane = $derived.by(() => {
		if (!repoCtx) return 0;
		const headRow = layoutRows.find((r) => r.branchLabels.includes(repoCtx!.branch));
		return headRow?.lane ?? 0;
	});

	// ─── Init ────────────────────────────────────────────────────────────────

	$effect(() => {
		if (repoCtx) {
			fetchAll();
		} else {
			branches = [];
			graphBranches = [];
			allCommits = new Map();
			layoutRows = [];
		}
	});
</script>

<div class="flex h-full flex-col">
	<!-- Toolbar -->
	<div class="flex items-center gap-2 border-b border-border px-2 py-1">
		<span class="min-w-0 truncate text-xs text-muted-foreground">
			{allCommits.size} commits
			{#if graphBranches.length < branches.length}
				<span title="Only these branches' history is shown; switch to a branch to bring it in">
					· {graphBranches.length} of {branches.length} branches
				</span>
			{/if}
		</span>
		<div class="ml-auto flex shrink-0 items-center gap-1">
			{#if repoCtx && branches.length > 0}
				<Select.Root
					type="single"
					bind:value={() => repoCtx?.branch ?? '', (v) => v && switchToBranch(v)}
					disabled={!!switching || loading}
				>
					<Select.Trigger
						size="sm"
						class="h-6 max-w-40 py-0"
						title="Switch to branch"
						{@attach help({
							title: 'Branch',
							text: 'Switch to another branch; the file list reloads from it.',
						})}
					>
						<GitBranch size={11} />
						<span class="truncate">{switching || repoCtx.branch}</span>
					</Select.Trigger>
					<Select.Content class="max-h-72">
						<Select.Group>
							<Select.Label>Switch to branch</Select.Label>
							{#each branches as b (b.name)}
								<Select.Item value={b.name} label={b.name}>
									<span class="truncate">{b.name}</span>
									{#if !graphBranchNames.has(b.name)}
										<span class="ml-auto pl-2 text-[10px] text-muted-foreground">not in graph</span>
									{/if}
								</Select.Item>
							{/each}
						</Select.Group>
					</Select.Content>
				</Select.Root>
			{/if}
			<button
				class="rounded p-1 text-muted-foreground hover:bg-muted hover:text-muted-foreground disabled:opacity-40"
				title="Refresh"
				{@attach help({
					title: 'Refresh',
					text: 'Reload branches and commit history from GitHub.',
				})}
				onclick={fetchAll}
				disabled={loading}
			>
				{#if loading}
					<LoaderCircle size={13} class="animate-spin" />
				{:else}
					<RefreshCw size={13} />
				{/if}
			</button>
		</div>
	</div>

	{#if error}
		<p class="px-3 py-2 text-xs text-red-600">{error}</p>
	{/if}

	<!-- Graph rows -->
	{#if loading && layoutRows.length === 0}
		<div class="flex items-center justify-center py-8">
			<LoaderCircle class="animate-spin text-muted-foreground" size={20} />
		</div>
	{:else if layoutRows.length === 0}
		<p class="px-3 py-6 text-center text-xs text-muted-foreground">No commits found.</p>
	{:else}
		<div class="flex-1 overflow-y-auto">
			<!-- Uncommitted-changes row: shown above HEAD when local changes exist -->
			{#if changes.length > 0 && layoutRows.length > 0}
				{@const allPaths = changes.map((c) => c.name).join(', ')}
				<div
					class="flex items-stretch border-b border-dashed border-amber-300 bg-amber-50 dark:border-amber-600 dark:bg-amber-950"
					style="height: {ROW_HEIGHT}px"
					title="Uncommitted local changes: {allPaths}"
				>
					<svg
						width={graphWidth}
						height={ROW_HEIGHT}
						class="shrink-0"
						style="min-width: {graphWidth}px"
					>
						<line
							x1={lx(headLane)}
							y1={ROW_HEIGHT / 2}
							x2={lx(headLane)}
							y2={ROW_HEIGHT}
							stroke="#f59e0b"
							stroke-width="1.5"
							stroke-dasharray="3 2"
						/>
						<circle
							cx={lx(headLane)}
							cy={ROW_HEIGHT / 2}
							r={DOT_RADIUS}
							fill="white"
							stroke="#f59e0b"
							stroke-width="1.5"
						/>
					</svg>
					<div class="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden pr-2 pl-1">
						<span
							class="shrink-0 rounded border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:border-amber-600 dark:bg-amber-900 dark:text-amber-300"
						>
							uncommitted
						</span>
						<span class="min-w-0 flex-1 truncate text-xs text-amber-700 italic" title={allPaths}>
							{changes.length} file{changes.length === 1 ? '' : 's'}: {allPaths}
						</span>
					</div>
				</div>
			{/if}
			{#each layoutRows as node (node.sha)}
				{@const instrs = rowInstructions(node)}
				<div class="group flex items-stretch hover:bg-muted" style="height: {ROW_HEIGHT}px">
					<!-- SVG graph column -->
					<svg
						width={graphWidth}
						height={ROW_HEIGHT}
						class="shrink-0"
						style="min-width: {graphWidth}px"
					>
						{#each instrs as instr, index (index)}
							{#if instr.type === 'line'}
								<line
									x1={instr.x1}
									y1={instr.y1}
									x2={instr.x2}
									y2={instr.y2}
									stroke={instr.color}
									stroke-width="1.5"
								/>
							{:else if instr.type === 'path'}
								<path d={instr.d} fill="none" stroke={instr.color} stroke-width="1.5" />
							{:else}
								<circle
									cx={instr.cx}
									cy={instr.cy}
									r={DOT_RADIUS}
									fill={laneColor(node.lane)}
									stroke="white"
									stroke-width="1.5"
								/>
							{/if}
						{/each}
					</svg>

					<!-- Commit info -->
					<div class="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden pr-2 pl-1">
						<!-- Branch labels -->
						{#each node.branchLabels as label (label)}
							{@const isCurrent = label === repoCtx?.branch}
							{@const isSwitching = switching === label}
							<button
								class="shrink-0 rounded px-1.5 py-0.5 text-xs leading-none text-white transition-opacity
									{isCurrent ? 'cursor-default font-bold' : 'font-medium hover:opacity-90 disabled:opacity-50'}"
								style="background-color: {laneColor(node.lane)}; {isCurrent
									? `box-shadow: 0 0 0 2px white, 0 0 0 4px ${laneColor(node.lane)};`
									: ''}"
								title={isCurrent ? `Current branch: ${label}` : `Switch to ${label}`}
								onclick={() => switchToBranch(label)}
								disabled={!!switching && !isCurrent}
							>
								{#if isSwitching}
									<LoaderCircle size={9} class="animate-spin" />
								{:else}
									<GitBranch size={9} class="mr-0.5 inline" />{label}
								{/if}
							</button>
						{/each}

						<!-- Short message -->
						<span class="min-w-0 flex-1 truncate text-xs text-foreground" title={node.shortMessage}
							>{node.shortMessage}</span
						>

						<!-- Meta (hidden until hover) -->
						<span class="hidden shrink-0 text-xs text-muted-foreground group-hover:inline">
							{node.shortSha}
						</span>
						{#if node.authorDate}
							<span class="shrink-0 text-xs text-muted-foreground">
								{relativeDate(node.authorDate)}
							</span>
						{/if}
					</div>
				</div>
			{/each}

			<!-- Load more -->
			<div class="flex justify-center py-2">
				<button
					class="rounded border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-40"
					onclick={loadMore}
					disabled={loadingMore || loading}
				>
					{#if loadingMore}<LoaderCircle size={11} class="mr-1 inline animate-spin" />{/if}
					Load more
				</button>
			</div>
		</div>
	{/if}

	<!-- Footer: create branch -->
	<div class="border-t border-border px-2 py-2">
		{#if creatingBranch}
			<div class="flex items-center gap-1">
				<input
					type="text"
					placeholder="new-branch-name"
					bind:value={newBranchName}
					class="min-w-0 flex-1 rounded border border-border px-2 py-1 text-xs outline-none focus:border-blue-400"
					onkeydown={(e) => {
						if (e.key === 'Enter') handleCreateBranch();
						if (e.key === 'Escape') {
							creatingBranch = false;
							newBranchName = '';
						}
					}}
				/>
				<button
					class="rounded border border-border bg-background px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
					onclick={handleCreateBranch}
					disabled={!newBranchName.trim() || createBusy}
				>
					{#if createBusy}<LoaderCircle size={11} class="animate-spin" />{:else}Create{/if}
				</button>
				<button
					class="rounded px-1 py-1 text-xs text-muted-foreground hover:bg-muted"
					onclick={() => {
						creatingBranch = false;
						newBranchName = '';
					}}>✕</button
				>
			</div>
		{:else}
			<button
				class="flex w-full items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
				onclick={() => {
					creatingBranch = true;
				}}
				disabled={loading || !repoCtx}
				{@attach help({
					title: 'New branch',
					text: 'Create a branch from the current one and switch to it.',
				})}
			>
				<Plus size={13} />
				New branch from <span class="font-medium">{repoCtx?.branch ?? '…'}</span>
			</button>
		{/if}
	</div>
</div>
