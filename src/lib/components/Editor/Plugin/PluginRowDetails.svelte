<script lang="ts">
	import type { PythonPlugin } from '$lib/plugin/types';
	import { classifyEnv } from '$lib/plugin/envClassification';
	import {
		APPLY_STRATEGY_DESCRIPTIONS,
		FORMAT_DESCRIPTIONS,
		envTierDescription,
	} from '$lib/plugin/manifestDescriptions';
	import PluginCitations from './PluginCitations.svelte';
	import PluginCredits from './PluginCredits.svelte';

	const { plugin }: { plugin: PythonPlugin } = $props();

	const manifest = $derived(plugin.manifest);
	const envTier = $derived(classifyEnv(manifest));
</script>

<div class="flex flex-col gap-1.5">
	<!-- Kind pills; the full explanation is in each tooltip and the install review. -->
	<div class="flex flex-wrap items-center gap-1">
		<span
			class="rounded bg-muted px-1.5 font-mono text-[10px] leading-4 text-muted-foreground"
			title={FORMAT_DESCRIPTIONS[manifest.format]}>{manifest.format}</span
		>
		<span
			class="max-w-full truncate rounded bg-muted px-1.5 font-mono text-[10px] leading-4 text-muted-foreground"
			title={APPLY_STRATEGY_DESCRIPTIONS[manifest.applyStrategy]}>{manifest.applyStrategy}</span
		>
		{#if plugin.origin === 'linked'}
			<span
				class="rounded bg-violet-100 px-1.5 font-mono text-[10px] leading-4 text-violet-700 dark:bg-violet-950 dark:text-violet-300"
				title="Runs in its own dev environment. Installed, it would run in the {envTier} environment."
				>dev env</span
			>
		{:else}
			<span
				class="rounded px-1.5 font-mono text-[10px] leading-4 {envTier === 'custom'
					? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
					: 'bg-muted text-muted-foreground'}"
				title={envTierDescription(envTier)}>{envTier} env</span
			>
		{/if}
		{#each manifest.tags ?? [] as tag (tag)}
			<span
				class="rounded-full border border-border px-1.5 text-[10px] leading-4 text-muted-foreground"
				>{tag}</span
			>
		{/each}
	</div>
	<PluginCredits {manifest} />
	{#if manifest.citations?.length}
		<PluginCitations citations={manifest.citations} />
	{/if}
</div>
