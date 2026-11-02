<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { communityPlugins, type CommunityPluginEntry } from '$lib/plugin/communityPlugins';
	import { hubPlugins } from '$lib/plugin/corePlugins';
	import { prepareCommunityInstall, preparePointerInstall } from '$lib/plugin/PluginInstaller';
	import { DEMO_TAG, countTags, filterByTags, hasTag, tagKey } from '$lib/plugin/pluginTags';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import { toast } from 'svelte-sonner';
	import PluginHubCard from './PluginHubCard.svelte';
	import PluginTagFilter from './PluginTagFilter.svelte';

	const { onInstalled }: { onInstalled: () => void } = $props();

	const editorCtx = getEditorViewContext();
	const registry = $derived(editorCtx.pluginRegistry);

	// Only one manifest awaits install confirmation at a time.
	let pendingConfirmId = $state<string | null>(null);
	let installingId = $state<string | null>(null);

	// One filter for every Hub section.
	const selectedTags = new SvelteSet<string>();
	let showDemos = $state(true);
	const allListings = [...hubPlugins, ...communityPlugins];
	const filterTags = countTags(allListings).filter((t) => t.key !== tagKey(DEMO_TAG));
	const hasDemos = allListings.some((m) => hasTag(m, DEMO_TAG));
	const visibleCore = $derived(filterByTags(hubPlugins, { selected: selectedTags, showDemos }));
	const visibleCommunity = $derived(
		filterByTags(communityPlugins, { selected: selectedTags, showDemos })
	);

	function toggleTag(key: string) {
		if (selectedTags.has(key)) selectedTags.delete(key);
		else selectedTags.add(key);
	}

	function clearFilters() {
		selectedTags.clear();
		showDemos = true;
	}

	async function confirmInstall(manifest: (typeof hubPlugins)[number]) {
		installingId = manifest.id;
		try {
			const outcome = await editorCtx.pluginInstallGate.requestInstall(() =>
				preparePointerInstall(manifest, registry)
			);
			if (outcome.status === 'installed') {
				pendingConfirmId = null;
				onInstalled();
			} else if (outcome.status === 'error') {
				toast.error('Cannot install plugin', { description: outcome.message });
			}
		} finally {
			installingId = null;
		}
	}

	// The listing has no full manifest, so the downloaded zip's is reviewed in the install dialog.
	async function installCommunity(entry: CommunityPluginEntry) {
		pendingConfirmId = null;
		installingId = entry.id;
		try {
			const outcome = await editorCtx.pluginInstallGate.requestInstall(
				async () => {
					const prepared = await prepareCommunityInstall(entry, registry);
					installingId = null;
					return prepared;
				},
				{ review: true }
			);
			if (outcome.status === 'installed') onInstalled();
			else if (outcome.status === 'error')
				toast.error('Cannot install plugin', { description: outcome.message });
		} finally {
			installingId = null;
		}
	}
</script>

{#snippet noMatches(section: string)}
	<div
		class="rounded border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground"
	>
		No {section} plugins match these filters.
		<button type="button" class="underline hover:text-foreground" onclick={clearFilters}
			>Clear filters</button
		>
	</div>
{/snippet}

<div class="h-full space-y-4 overflow-y-auto px-3 py-2">
	{#if filterTags.length > 0 || hasDemos}
		<PluginTagFilter
			tags={filterTags}
			selected={selectedTags}
			onToggleTag={toggleTag}
			{hasDemos}
			bind:showDemos
		/>
	{/if}

	<!-- Core Plugins -->
	<section>
		<div class="mb-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
			Core Plugins
		</div>
		{#each visibleCore as manifest (manifest.id)}
			<PluginHubCard
				{manifest}
				installed={registry.get(manifest.id) !== undefined}
				review={pendingConfirmId === manifest.id ? manifest : null}
				installing={installingId === manifest.id}
				onRequestInstall={() => (pendingConfirmId = manifest.id)}
				onConfirmInstall={() => confirmInstall(manifest)}
				onCancelInstall={() => (pendingConfirmId = null)}
			/>
		{:else}
			{@render noMatches('core')}
		{/each}
	</section>

	{#if communityPlugins.length > 0}
		<section>
			<div class="mb-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
				Community Plugins
			</div>
			<p class="mb-1.5 text-[11px] leading-snug text-muted-foreground">
				Not shipped with Foldnano; each has its own license and source.
			</p>
			{#each visibleCommunity as entry (entry.id)}
				<PluginHubCard
					manifest={entry}
					iconSvg={entry.iconSvg}
					installed={registry.get(entry.id) !== undefined}
					installing={installingId === entry.id}
					onRequestInstall={() => installCommunity(entry)}
				/>
			{:else}
				{@render noMatches('community')}
			{/each}
		</section>
	{/if}
</div>
