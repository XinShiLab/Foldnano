<script lang="ts">
	import { help } from '$lib/components/help/help';
	import { classifyEnv } from '$lib/plugin/envClassification';
	import type { PluginManifest } from '$lib/plugin/types';
	import { Download, CircleCheckBig, Loader, X } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import PluginCredits from './PluginCredits.svelte';
	import PluginManifestInfo from './PluginManifestInfo.svelte';
	import PluginTile from './PluginTile.svelte';

	// Core: Install opens `review` (the manifest) here and switches the button to Confirm.
	// Community: the listing has no full manifest; Install downloads it into the install dialog.
	const {
		manifest,
		iconSvg,
		installed,
		review = null,
		installing,
		onRequestInstall,
		onConfirmInstall = () => {},
		onCancelInstall = () => {},
	}: {
		manifest: Pick<
			PluginManifest,
			| 'name'
			| 'version'
			| 'description'
			| 'tags'
			| 'sidePanel'
			| 'requirements'
			| 'network'
			| 'authors'
			| 'maintainers'
			| 'license'
			| 'repository'
			| 'upstream'
		>;
		iconSvg?: string;
		installed: boolean;
		review?: PluginManifest | null;
		installing: boolean;
		onRequestInstall: () => void;
		onConfirmInstall?: () => void;
		onCancelInstall?: () => void;
	} = $props();

	const pending = $derived(review !== null);
	const isCustomEnv = $derived(classifyEnv(manifest) === 'custom');
	const hasCredits = $derived(
		!!manifest.authors?.length ||
			!!manifest.maintainers?.length ||
			!!manifest.license ||
			!!manifest.repository
	);
</script>

<div class="mb-1.5 flex flex-col gap-2 rounded-md border border-border bg-card p-2">
	<div class="flex items-start gap-2.5">
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
				<p
					class="mt-0.5 text-[11px] leading-snug text-muted-foreground {pending ? '' : 'truncate'}"
					title={pending ? undefined : manifest.description}
				>
					{manifest.description}
				</p>
			{/if}
			{#if !pending && hasCredits}
				<div class="mt-0.5"><PluginCredits {manifest} /></div>
			{/if}
			{#if !pending && manifest.tags?.length}
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
		{#if installed}
			<span class="mt-0.5 flex shrink-0 items-center gap-1 text-[11px] text-green-600">
				<CircleCheckBig size={11} />
				Installed
			</span>
		{:else if pending}
			<div class="mt-0.5 flex shrink-0 items-center gap-1">
				<Button
					size="sm"
					class="h-6 gap-1 px-2 text-xs font-normal"
					onclick={onConfirmInstall}
					disabled={installing}
				>
					<Download size={11} />
					{installing ? 'Installing…' : 'Confirm'}
				</Button>
				<Button variant="ghost" size="icon" class="size-6" onclick={onCancelInstall} title="Cancel">
					<X size={11} />
				</Button>
			</div>
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
					text: 'Add this plugin to My Plugins. You confirm before it installs.',
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

	{#if review}
		<PluginManifestInfo manifest={review} />
	{/if}
</div>
