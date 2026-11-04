<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { communityPlugins, type CommunityPluginEntry } from '$lib/plugin/communityPlugins';
	import { hubPlugins } from '$lib/plugin/corePlugins';
	import { prepareCommunityInstall, preparePointerInstall } from '$lib/plugin/PluginInstaller';
	import type { PreparedInstall } from '$lib/plugin/PluginInstaller';
	import {
		availableUpdate,
		listingVersion,
		prepareListingInstall,
	} from '$lib/plugin/pluginUpdates';
	import { DEMO_TAG, countTags, filterByTags, hasTag, tagKey } from '$lib/plugin/pluginTags';
	import type { PluginManifest, PythonPlugin } from '$lib/plugin/types';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import { toast } from 'svelte-sonner';
	import { CircleArrowUp, Download, Trash2 } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import PluginHubCard from './PluginHubCard.svelte';
	import PluginInfoDialog from './PluginInfoDialog.svelte';
	import PluginTagFilter from './PluginTagFilter.svelte';

	const {
		onInstalled,
		onRemove,
	}: { onInstalled: () => void; onRemove: (plugin: PythonPlugin) => void } = $props();

	const editorCtx = getEditorViewContext();
	const registry = $derived(editorCtx.pluginRegistry);

	let installingId = $state<string | null>(null);
	let infoId = $state<string | null>(null);

	// One filter for every Hub section.
	const selectedTags = new SvelteSet<string>();
	let showDemos = $state(false);
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

	// The spinner covers the download; the install dialog takes over once it opens.
	async function install(id: string, prepare: () => Promise<PreparedInstall>, review: boolean) {
		installingId = id;
		try {
			const outcome = await editorCtx.pluginInstallGate.requestInstall(
				async () => {
					const prepared = await prepare();
					installingId = null;
					return prepared;
				},
				{ review }
			);
			if (outcome.status === 'installed') onInstalled();
			else if (outcome.status === 'error')
				toast.error('Cannot install plugin', { description: outcome.message });
		} finally {
			installingId = null;
		}
	}

	// From the info dialog a core plugin installs directly: its full manifest was just shown.
	// A community listing has no full manifest, so its download is always reviewed.
	function installCore(manifest: PluginManifest, review: boolean) {
		void install(manifest.id, () => preparePointerInstall(manifest, registry), review);
	}

	function installCommunity(entry: CommunityPluginEntry) {
		void install(entry.id, () => prepareCommunityInstall(entry, registry), true);
	}

	const infoCore = $derived(hubPlugins.find((m) => m.id === infoId) ?? null);
	const infoEntry = $derived(communityPlugins.find((e) => e.id === infoId) ?? null);
	const infoInstalled = $derived(infoId ? registry.get(infoId) : undefined);
	const infoListing = $derived(infoInstalled?.manifest ?? infoCore ?? infoEntry);
	const infoUpdate = $derived(infoInstalled ? availableUpdate(infoInstalled) : null);

	// The card's Install button doubles as Update: an installed id prepares as a Replace.
	function updateVersionFor(id: string): string | null {
		const plugin = registry.get(id);
		const ref = plugin ? availableUpdate(plugin) : null;
		return ref ? listingVersion(ref) : null;
	}

	function updateFromInfo() {
		const ref = infoUpdate;
		const id = infoId;
		infoId = null;
		if (ref && id) void install(id, () => prepareListingInstall(ref, registry), true);
	}

	function removeFromInfo() {
		const plugin = infoInstalled;
		infoId = null;
		if (plugin) onRemove(plugin);
	}

	function installFromInfo() {
		const core = infoCore;
		const entry = infoEntry;
		infoId = null;
		if (core) installCore(core, false);
		else if (entry) installCommunity(entry);
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
				updateVersion={updateVersionFor(manifest.id)}
				installing={installingId === manifest.id}
				onRequestInstall={() => installCore(manifest, true)}
				onOpenInfo={() => (infoId = manifest.id)}
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
					updateVersion={updateVersionFor(entry.id)}
					installing={installingId === entry.id}
					onRequestInstall={() => installCommunity(entry)}
					onOpenInfo={() => (infoId = entry.id)}
				/>
			{:else}
				{@render noMatches('community')}
			{/each}
		</section>
	{/if}
</div>

{#if infoListing}
	<!-- An installed plugin shows what is installed, which may be an older version than listed. -->
	<PluginInfoDialog
		listing={infoListing}
		manifest={infoInstalled?.manifest ?? infoCore}
		iconSvg={infoInstalled?.iconSvg ?? infoEntry?.iconSvg}
		onClose={() => (infoId = null)}
	>
		{#snippet actions()}
			{#if infoInstalled?.origin === 'user'}
				<Button
					variant="destructive"
					class="gap-1 sm:order-first sm:mr-auto"
					onclick={removeFromInfo}
				>
					<Trash2 size={14} />
					Remove
				</Button>
			{/if}
			{#if infoUpdate}
				<Button class="gap-1" onclick={updateFromInfo}>
					<CircleArrowUp size={14} />
					Update to {listingVersion(infoUpdate)}
				</Button>
			{:else if !infoInstalled}
				<Button class="gap-1" onclick={installFromInfo}>
					<Download size={14} />
					Install
				</Button>
			{/if}
		{/snippet}
	</PluginInfoDialog>
{/if}
