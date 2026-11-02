<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { PluginListing, PluginManifest } from '$lib/plugin/types';
	import PluginCredits from './PluginCredits.svelte';
	import PluginManifestInfo from './PluginManifestInfo.svelte';
	import PluginTile from './PluginTile.svelte';

	// Read-only details of a Hub listing or an installed plugin. Without a full manifest (a community
	// listing not yet downloaded) it shows what the listing carries.
	const {
		listing,
		manifest,
		iconSvg = null,
		onClose,
		actions,
	}: {
		listing: PluginListing;
		manifest: PluginManifest | null;
		iconSvg?: string | null;
		onClose: () => void;
		actions?: Snippet;
	} = $props();
</script>

<Dialog.Root
	open={true}
	onOpenChange={(v) => {
		if (!v) onClose();
	}}
>
	<!-- Long declarations scroll in the body so the header and actions stay on screen. -->
	<Dialog.Content class="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-lg">
		<Dialog.Header>
			<div class="flex items-center gap-2.5">
				<PluginTile manifest={listing} {iconSvg} />
				<Dialog.Title class="text-base leading-snug">
					{listing.name}
					<span class="ml-1 text-xs font-normal whitespace-nowrap text-muted-foreground"
						>{listing.version}</span
					>
				</Dialog.Title>
			</div>
		</Dialog.Header>

		<div class="min-h-0 space-y-2 overflow-y-auto text-sm text-muted-foreground">
			{#if listing.description}
				<p>{listing.description}</p>
			{/if}
			{#if listing.tags?.length}
				<div class="flex flex-wrap gap-1">
					{#each listing.tags as tag (tag)}
						<span
							class="rounded-full border border-border px-1.5 text-[10px] leading-4 text-muted-foreground"
							>{tag}</span
						>
					{/each}
				</div>
			{/if}
			{#if manifest}
				<PluginManifestInfo {manifest} />
			{:else}
				<PluginCredits manifest={listing} />
				<p class="text-xs">
					Installing downloads the plugin, checks it is the listed file, and shows what it declares
					(network access, Python packages) before it installs.
				</p>
			{/if}
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={onClose}>Close</Button>
			{@render actions?.()}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
