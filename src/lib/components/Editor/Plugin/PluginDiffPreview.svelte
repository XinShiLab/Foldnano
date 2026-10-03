<script lang="ts">
	import type { PendingApply } from '$lib/plugin/PluginCoordinator.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';

	let {
		pending,
		onConfirm,
		onCancel,
		readOnly = false,
	}: {
		pending: PendingApply;
		onConfirm: () => void;
		onCancel: () => void;
		/** Another tab owns the document, so the result can't be applied here. */
		readOnly?: boolean;
	} = $props();

	const isReplacePart = $derived(pending.manifest.applyStrategy === 'replacePart');
	const isReplaceRegion = $derived(pending.manifest.applyStrategy === 'replaceRegion');
	const warningText = $derived(
		isReplacePart
			? '⚠ All sequences and modifications will be removed. Use Undo to restore.'
			: isReplaceRegion
				? 'Sequences in the replaced region are not preserved. Previous modifications and oligo names are not restored.'
				: 'Sequences preserved for matched oligos. New or repositioned oligos will have no sequence.'
	);
</script>

<div class="rounded border border-border bg-background px-3 py-2 text-xs">
	<!-- Header -->
	<div class="mb-1.5 flex flex-col items-start gap-1">
		<span class="font-medium text-foreground"
			>{pending.manifest.name} v{pending.manifest.version}</span
		>
		<Badge variant={isReplacePart ? 'destructive' : 'secondary'} class="px-1.5 py-0.5 text-[10px]">
			{pending.manifest.applyStrategy}
		</Badge>
	</div>

	<!-- Warning -->
	<p class="mb-1 text-muted-foreground">{warningText}</p>

	<!-- Summary -->
	{#if pending.summary}
		<p class="mb-2 rounded bg-muted px-1.5 py-1 font-mono text-[10px] text-muted-foreground">
			{pending.summary}
		</p>
	{/if}

	{#if readOnly}
		<p class="mb-2 text-amber-700 dark:text-amber-400">
			This file is open in another tab. Take back control to apply this result.
		</p>
	{/if}

	<!-- Actions -->
	<div class="flex justify-end gap-2">
		<Button variant="outline" size="sm" class="h-6 px-2 text-xs" onclick={onCancel}>Cancel</Button>
		<Button size="sm" class="h-6 px-2 text-xs" disabled={readOnly} onclick={onConfirm}>Apply</Button
		>
	</div>
</div>
