<script lang="ts">
	import type { PluginManifest } from '$lib/plugin/types';
	import { classifyEnv, requirementSources } from '$lib/plugin/envClassification';
	import { ANY_HOST } from '$lib/plugin/networkPolicy';
	import {
		APPLY_STRATEGY_DESCRIPTIONS,
		FORMAT_DESCRIPTIONS,
		envTierDescription,
	} from '$lib/plugin/manifestDescriptions';
	import { Info, ShieldCheck } from '@lucide/svelte';
	import PluginCitations from './PluginCitations.svelte';
	import PluginCredits from './PluginCredits.svelte';

	let { manifest }: { manifest: PluginManifest } = $props();

	const envTier = $derived(classifyEnv(manifest));
	const packages = $derived(requirementSources(manifest));
	const network = $derived(manifest.network ?? []);
	const anyHost = $derived(network.includes(ANY_HOST));

	const packageGroups = $derived(
		[
			{ names: packages.distribution, note: 'from the Pyodide distribution', warn: false },
			{
				names: packages.pypi,
				note: 'downloaded from PyPI on Activate: third-party code Foldnano does not review',
				warn: true,
			},
			{ names: packages.bundled, note: 'bundled in the plugin', warn: false },
			{ names: packages.firstParty, note: 'provided by Foldnano', warn: false },
		].filter((group) => group.names.length > 0)
	);

	function accessLabel(strategy: string): string {
		if (strategy === 'previewOnly') return 'PreviewOnly';
		if (strategy.startsWith('replaceRegion') || strategy === 'replayMutationLogInRegion')
			return 'ModifyRegions';
		return 'ModifyParts';
	}
</script>

<div class="flex flex-col gap-2 rounded-md border bg-muted/40 p-2.5 text-xs">
	<div class="flex items-start gap-1.5">
		<Info size={13} class="mt-0.5 shrink-0 text-blue-500" />
		<span class="font-semibold text-foreground">What this plugin does</span>
	</div>

	<div class="ml-5 flex flex-col gap-1.5">
		<PluginCredits {manifest} />
		<div>
			<span class="rounded bg-background px-1.5 py-0.5 font-mono text-[10px]">
				Type: {manifest.format}
			</span>
			<span class="text-muted-foreground">
				{FORMAT_DESCRIPTIONS[manifest.format] ?? ''}
			</span>
		</div>

		<div>
			<span class="rounded bg-background px-1.5 py-0.5 font-mono text-[10px]">
				Apply: {manifest.applyStrategy}
			</span>
			<span class="text-muted-foreground">
				{APPLY_STRATEGY_DESCRIPTIONS[manifest.applyStrategy] ?? ''}
			</span>
		</div>

		<div class="flex flex-wrap items-center gap-1">
			<span class="font-semibold text-foreground">Access:</span>
			<span class="rounded bg-background px-1.5 py-0.5 font-mono text-[10px]">
				{accessLabel(manifest.applyStrategy)}
			</span>
		</div>

		<div class="flex flex-wrap items-center gap-1">
			<span class="font-semibold text-foreground">Network:</span>
			{#if network.length === 0}
				<span class="rounded bg-background px-1.5 py-0.5 font-mono text-[10px]">none</span>
				<span class="text-muted-foreground">can't contact any website</span>
			{:else if anyHost}
				<span
					class="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] text-amber-900 dark:bg-amber-900 dark:text-amber-100"
					>any website</span
				>
				<span class="text-muted-foreground">can send and receive data from any HTTPS site</span>
			{:else}
				{#each network as host (host)}
					<span class="rounded bg-background px-1.5 py-0.5 font-mono text-[10px]">{host}</span>
				{/each}
				<span class="text-muted-foreground">can send and receive data from only these sites</span>
			{/if}
		</div>

		<div class="flex flex-wrap items-center gap-1">
			<span class="font-semibold text-foreground">Environment:</span>
			<span class="rounded bg-background px-1.5 py-0.5 font-mono text-[10px]">{envTier}</span>
			<span class="text-muted-foreground">
				{envTierDescription(envTier)}
			</span>
		</div>

		{#each packageGroups as group, i (group.note)}
			<div class="flex flex-wrap items-center gap-1">
				<span class="font-semibold text-foreground" class:invisible={i > 0}>Python packages:</span>
				{#each group.names as req (req)}
					<span
						class="rounded px-1.5 py-0.5 font-mono text-[10px] {group.warn
							? 'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100'
							: 'bg-background'}">{req}</span
					>
				{/each}
				<span class="text-muted-foreground">{group.note}</span>
			</div>
		{/each}

		{#if manifest.entrypointUrl}
			<div class="flex flex-wrap items-center gap-1">
				<span class="font-semibold text-foreground">Code source:</span>
				<span
					class="truncate rounded bg-background px-1.5 py-0.5 font-mono text-[10px]"
					title={manifest.entrypointUrl}
				>
					{manifest.entrypointUrl}
				</span>
				<span class="text-muted-foreground">(served by Foldnano, downloaded once on install)</span>
			</div>
		{:else if manifest.entrypoint}
			<div class="text-muted-foreground">
				<span class="font-semibold text-foreground">Code source:</span> inline (bundled in manifest)
			</div>
		{/if}
	</div>

	<div
		class="ml-5 flex items-start gap-1.5 rounded border border-amber-200 bg-amber-50 p-1.5 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
	>
		<ShieldCheck size={12} class="mt-0.5 shrink-0" />
		<span>
			Plugins run in a sandbox: they can't reach your GitHub account, your other designs, or any
			website not listed under Network. Code loads only when you click <strong>Activate</strong>,
			sees your design only when you click <strong>Run</strong>, and changes it only when you click
			<strong>Apply</strong>.
		</span>
	</div>

	{#if manifest.citations?.length}
		<div class="ml-5">
			<PluginCitations citations={manifest.citations} />
		</div>
	{/if}
</div>
