<script lang="ts">
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Trash2 } from '@lucide/svelte';
	import type { Part } from '$lib/model/Part';
	import { removeAllSkipsInRegionCmd, removeAllInsertsInRegionCmd } from '$lib/commands/strands';

	type Props = { part: Part };
	let { part }: Props = $props();

	const ctx = getEditorViewContext();
	const skipInsertCtx = $derived(ctx.strandViewContext.skipInsertContext);
	const activeRegion = $derived(ctx.activeRegion);
	const isSkipMode = $derived(ctx.editorMode === 'SKIP');

	const regionStats = $derived.by(() => {
		if (!activeRegion) return { skipCount: 0, insertCount: 0 };
		let skipCount = 0;
		let insertCount = 0;
		for (const vh of part.virtualHelices.filter((vh) => vh.regionId === activeRegion.id)) {
			for (const strandSet of vh.strandSets) {
				for (const segId of strandSet.segmentIds) {
					const seg = part.getSegmentById(segId);
					if (!seg) continue;
					for (const slot of seg.slots) {
						if (slot.seq.length === 0) skipCount++;
						else if (slot.seq.length > 1) insertCount++;
					}
				}
			}
		}
		return { skipCount, insertCount };
	});

	let confirmRemove = $state(false);

	function handleRemove() {
		if (!confirmRemove) {
			confirmRemove = true;
			setTimeout(() => (confirmRemove = false), 3000);
			return;
		}
		if (!activeRegion) return;
		if (isSkipMode) {
			removeAllSkipsInRegionCmd({ part, regionId: activeRegion.id }, ctx.historyStack);
		} else {
			removeAllInsertsInRegionCmd({ part, regionId: activeRegion.id }, ctx.historyStack);
		}
		confirmRemove = false;
	}

	const count = $derived(isSkipMode ? regionStats.skipCount : regionStats.insertCount);
	const label = $derived(isSkipMode ? 'skip' : 'insert');
</script>

<div class="flex flex-col gap-2">
	<!-- Toggle: Apply to all VH -->
	<div class="flex items-center justify-between gap-2">
		<Label class="text-xs">Apply to all VH in region</Label>
		<Switch bind:checked={skipInsertCtx.applyToAllVh} />
	</div>

	<!-- Stats -->
	{#if activeRegion}
		<div class="rounded border border-border bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
			<span class="font-medium">{activeRegion.name}</span>
			— {regionStats.skipCount} skip{regionStats.skipCount !== 1 ? 's' : ''},
			{regionStats.insertCount} insert{regionStats.insertCount !== 1 ? 's' : ''}
		</div>
	{:else}
		<p class="text-xs text-muted-foreground">No active region selected.</p>
	{/if}

	<!-- Bulk remove button (two-click confirmation, mode-specific) -->
	<Button
		size="sm"
		variant={confirmRemove ? 'destructive' : 'outline'}
		disabled={!activeRegion || count === 0}
		onclick={handleRemove}
		class="w-full justify-start text-xs"
	>
		<Trash2 size={12} class="mr-1" />
		{confirmRemove ? `Confirm — remove all ${label}s` : `Remove all ${label}s (${count})`}
	</Button>
</div>
