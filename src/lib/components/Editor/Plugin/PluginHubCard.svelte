<script lang="ts">
	import { help } from '$lib/components/help/help';
	import { classifyEnv } from '$lib/plugin/envClassification';
	import type { PluginListing } from '$lib/plugin/types';
	import { CircleArrowUp, Download, CircleCheckBig, Loader } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import PluginCredits from './PluginCredits.svelte';
	import PluginTile from './PluginTile.svelte';

	// Install downloads the plugin into the install dialog for review; clicking the card shows its
	// details (PluginInfoDialog).
	const {
		manifest,
		iconSvg,
		installed,
		updateVersion = null,
		installing,
		onRequestInstall,
		onOpenInfo,
	}: {
		manifest: PluginListing;
		iconSvg?: string;
		installed: boolean;
		/** The listed version, when it is newer than the installed one. */
		updateVersion?: string | null;
		installing: boolean;
		/** Installs, or updates when `updateVersion` is set; both end in the install dialog. */
		onRequestInstall: () => void;
		onOpenInfo: () => void;
	} = $props();

	const isCustomEnv = $derived(classifyEnv(manifest) === 'custom');
	const hasCredits = $derived(
		!!manifest.authors?.length ||
			!!manifest.maintainers?.length ||
			!!manifest.license ||
			!!manifest.repository
	);
</script>

<div
	class="mb-1.5 flex flex-col gap-0.5 rounded-md border border-border bg-card p-2 transition-colors hover:border-foreground/20"
>
	<div class="flex items-start gap-2.5">
		<button
			type="button"
			class="flex min-w-0 flex-1 items-start gap-2.5 text-left"
			onclick={onOpenInfo}
			title="Show details"
		>
			<PluginTile {manifest} {iconSvg} />
			<div class="min-w-0 flex-1">
				<!-- Inline flow: meta follows the last line of a wrapped name. -->
				<div class="text-xs leading-snug">
					<span class="font-medium break-words text-card-foreground">{manifest.name}</span>
					<span class="ml-1.5 text-[10px] whitespace-nowrap text-muted-foreground"
						>{manifest.version}</span
					>
					{#if isCustomEnv}
						<span
							class="ml-1.5 text-[10px] whitespace-nowrap text-amber-700 dark:text-amber-300"
							title="Custom environment: only one custom-environment plugin can be active at a time"
							>· custom env</span
						>
					{/if}
				</div>
				{#if manifest.description}
					<p class="mt-0.5 truncate text-[11px] leading-snug text-muted-foreground">
						{manifest.description}
					</p>
				{/if}
				{#if manifest.tags?.length}
					<div class="mt-1 flex flex-wrap gap-1">
						{#each manifest.tags as tag (tag)}
							<span
								class="rounded-full border border-border px-1.5 text-[10px] leading-4 text-muted-foreground"
								>{tag}</span
							>
						{/each}
					</div>
				{/if}
			</div>
		</button>
		{#if installed && updateVersion}
			<Button
				variant="outline"
				size="sm"
				class="mt-0.5 h-6 shrink-0 gap-1 border-blue-200 bg-blue-50 px-2 text-xs text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300 dark:hover:bg-blue-900"
				onclick={onRequestInstall}
				disabled={installing}
				title="Update to {updateVersion}"
				{@attach help({
					title: 'Update',
					text: 'Replace the installed version with the one listed here. You review the change first.',
					doc: 'plugins-for-users',
				})}
			>
				{#if installing}
					<Loader size={11} class="animate-spin" />
				{:else}
					<CircleArrowUp size={11} />
				{/if}
				Update
			</Button>
		{:else if installed}
			<span class="mt-0.5 flex shrink-0 items-center gap-1 text-[11px] text-green-600">
				<CircleCheckBig size={11} />
				Installed
			</span>
		{:else}
			<Button
				variant="outline"
				size="icon"
				class="mt-0.5 size-6 shrink-0"
				onclick={onRequestInstall}
				disabled={installing}
				title={installing ? 'Downloading…' : 'Install'}
				aria-label="Install {manifest.name}"
				{@attach help({
					title: 'Install',
					text: 'Add this plugin to My Plugins. You review its details before it installs.',
					doc: 'plugins-for-users',
				})}
			>
				{#if installing}
					<Loader size={11} class="animate-spin" />
				{:else}
					<Download size={11} />
				{/if}
			</Button>
		{/if}
	</div>
	<!-- Outside the button: credits hold links. Indented past the tile (size-8 + gap-2.5). -->
	{#if hasCredits}
		<div class="pl-[2.625rem]"><PluginCredits {manifest} /></div>
	{/if}
</div>
