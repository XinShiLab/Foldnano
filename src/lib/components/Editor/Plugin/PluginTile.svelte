<script lang="ts" module>
	export type PluginTileStatus = 'busy' | 'ready' | 'error' | 'warning';
</script>

<script lang="ts">
	import type { PluginManifest } from '$lib/plugin/types';
	import { Loader } from '@lucide/svelte';
	import { pluginFallbackIcon } from '../sidePanels';
	import PluginIcon from './PluginIcon.svelte';

	const {
		manifest,
		iconSvg = null,
		status = null,
		statusLabel,
	}: {
		manifest: Pick<PluginManifest, 'sidePanel'>;
		/** Bundled icon (`PythonPlugin.iconSvg`); Hub listings have none before install. */
		iconSvg?: string | null;
		status?: PluginTileStatus | null;
		statusLabel?: string;
	} = $props();

	const Fallback = $derived(pluginFallbackIcon(manifest));
	const dotColor: Record<Exclude<PluginTileStatus, 'busy'>, string> = {
		ready: 'bg-green-500',
		error: 'bg-red-500',
		warning: 'bg-amber-500',
	};
</script>

<span
	class="relative flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-foreground/70"
>
	{#if iconSvg}
		<PluginIcon svg={iconSvg} size={16} />
	{:else}
		<Fallback size={16} strokeWidth={1.75} aria-hidden="true" />
	{/if}
	{#if status}
		<span
			class="absolute -right-0.5 -bottom-0.5 flex size-3 items-center justify-center rounded-full bg-card"
			title={statusLabel}
		>
			{#if status === 'busy'}
				<Loader size={10} class="animate-spin text-muted-foreground" />
			{:else}
				<span class="size-2 rounded-full {dotColor[status]}"></span>
			{/if}
			{#if statusLabel}<span class="sr-only">{statusLabel}</span>{/if}
		</span>
	{/if}
</span>
