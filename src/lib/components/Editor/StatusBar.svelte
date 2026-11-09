<script lang="ts">
	import { GitBranch, HardDrive, History } from '@lucide/svelte';
	import { getEditorViewContext } from './context/EditorViewContext.svelte';
	import NotificationHistory from './NotificationHistory.svelte';

	const ctx = getEditorViewContext();
	const session = $derived(ctx.session);
	const fileMeta = $derived(session.currentFileMetadata);
	const repoCtx = $derived(session.currentRepoContext);
	const notCommitted = $derived(fileMeta !== null && session.hasUncommittedGitHubChanges);
	const region = $derived(ctx.activeRegion);

	let backupCount = $state(0);
	// Backups are kept when a save replaces the stored copy, so recount after each save and
	// when the Backups dialog closes (a restore or a fresh backup may have changed it).
	$effect(() => {
		const docId = session.currentDoc.id;
		void session.lastLocalPersistAt;
		if (ctx.showBackups) return;
		let stale = false;
		void session.countBackups(docId).then((n) => {
			if (!stale) backupCount = n;
		});
		return () => {
			stale = true;
		};
	});
</script>

{#snippet divider()}
	<span class="h-3.5 w-px shrink-0 bg-primary-foreground/30" aria-hidden="true"></span>
{/snippet}

<div
	class="-mr-2 flex h-7 shrink-0 items-center justify-between gap-4 bg-primary px-3 text-sm text-primary-foreground/80"
>
	<!-- Left: where the design lives, its sync state, backups -->
	<div class="flex min-w-0 items-center gap-2 overflow-hidden">
		{#if fileMeta && repoCtx}
			<span class="flex shrink-0 items-center gap-1 font-semibold text-primary-foreground">
				<GitBranch class="size-3" />
				{repoCtx.branch}
			</span>
			<span class="truncate" title="{fileMeta.owner}/{fileMeta.repo}/{fileMeta.path}">
				{fileMeta.owner}/{fileMeta.repo} › {fileMeta.path}
			</span>
			{#if fileMeta.commitSha}
				<span class="shrink-0 font-mono text-xs" title="Current commit: {fileMeta.commitSha}"
					>@{fileMeta.commitSha.slice(0, 7)}</span
				>
			{/if}
			{#if notCommitted || session.remoteAheadOfLocal || session.remoteCheckFailed}
				{@render divider()}
			{/if}
			{#if notCommitted}
				<span
					class="flex shrink-0 items-center gap-1 text-amber-300"
					title="Your changes are kept in this browser. Commit to save them to GitHub."
				>
					<span class="inline-block size-1.5 rounded-full bg-amber-300"></span>
					{session.hasUnsavedLocalChanges ? 'Not committed' : 'Saved in browser · not committed'}
				</span>
			{/if}
			{#if session.remoteAheadOfLocal}
				<span class="shrink-0 text-sky-200" title="GitHub has commits newer than this copy">
					↓ {notCommitted ? 'Newer on GitHub' : 'Newer version on GitHub'}
				</span>
			{/if}
			{#if session.remoteCheckFailed}
				<button
					class="shrink-0 text-amber-300 hover:underline"
					title="Couldn't check GitHub for newer changes. Committing still checks and warns if the file changed. Click to try again."
					onclick={() => session.recheckRemote()}
				>
					? GitHub not checked
				</button>
			{/if}
		{:else}
			<span
				class="flex shrink-0 items-center gap-1 font-semibold text-primary-foreground"
				title="This design is kept in this browser and is not tracked on GitHub"
			>
				<HardDrive class="size-3" />
				Saved in this browser
			</span>
		{/if}
		{@render divider()}
		<button
			class="flex shrink-0 items-center gap-1 rounded border border-primary-foreground/30 bg-primary-foreground/10 px-1.5 py-0.5 text-xs hover:bg-primary-foreground/20"
			title="Earlier versions of this design kept in this browser"
			onclick={() => (ctx.showBackups = true)}
		>
			<History class="size-3" />
			Backups
			{#if backupCount > 0}
				<span class="font-mono tabular-nums">{backupCount}</span>
			{/if}
		</button>
		{#if !fileMeta && repoCtx}
			{@render divider()}
			<span
				class="flex min-w-0 items-center gap-1 text-primary-foreground/55"
				title="Connected repository. This design is not in it."
			>
				<GitBranch class="size-3 shrink-0" />
				<span class="truncate">{repoCtx.owner}/{repoCtx.repo} · {repoCtx.branch} (not in repo)</span
				>
			</span>
		{/if}
	</div>

	<!-- Right: active region, then whatever is under the pointer -->
	<div class="flex min-w-0 shrink items-center gap-2">
		{#if region}
			<span
				class="shrink-0"
				title="The region your edits apply to. Click in another region to switch; the rest of this bar follows the pointer."
				>{region.name} <span class="text-primary-foreground/55">(active)</span></span
			>
		{/if}
		{#if region && ctx.strandViewContext.footnote}
			{@render divider()}
		{/if}
		<span class="truncate font-mono text-xs tabular-nums">{ctx.strandViewContext.footnote}</span>
		{@render divider()}
		<NotificationHistory />
	</div>
</div>
