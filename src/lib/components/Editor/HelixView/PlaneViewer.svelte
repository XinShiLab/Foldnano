<script lang="ts">
	import { Stage, Layer } from 'svelte-konva';
	import type { Stage as StageType } from 'svelte-konva';
	import type { Part } from '$lib/model/Part/Part.svelte';
	import type OligoSegment from '$lib/model/Oligo/OligoSegment.svelte';
	import { LatticedDesignRegion } from '$lib/model/Part/DesignRegion';
	import LatticeViewer from './LatticeViewer.svelte';
	import FreeformViewer from './FreeformViewer.svelte';
	import { handleWheel } from '../mouseHandler';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';

	interface Props {
		part: Part;
		focusedSegments?: Set<OligoSegment> | null;
		stageRef?: StageType;
	}

	let { part, focusedSegments = null, stageRef = $bindable() }: Props = $props();

	const editorViewContext = getEditorViewContext();
	let editorMode = $derived(editorViewContext.editorMode);
	const latticeCanvasWidth = 1200;
	const latticeCanvasHeight = 1200;
	let tabsScroller = $state<HTMLDivElement | null>(null);

	let activeRegion = $derived.by(() => {
		const id = editorViewContext.activeRegionId;
		if (id) {
			const found = part.getRegionById(id);
			if (found) return found;
		}
		return part.regions[0] ?? null;
	});

	function handleRegionTabsWheel(e: WheelEvent): void {
		if (!tabsScroller || tabsScroller.scrollWidth <= tabsScroller.clientWidth) return;
		const dominantDelta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
		if (dominantDelta === 0) return;
		const scale =
			e.deltaMode === WheelEvent.DOM_DELTA_LINE
				? 16
				: e.deltaMode === WheelEvent.DOM_DELTA_PAGE
					? tabsScroller.clientWidth
					: 1;
		tabsScroller.scrollLeft += dominantDelta * scale;
		e.preventDefault();
	}
</script>

<div class="flex h-full flex-col overflow-hidden">
	{#if part.regions.length > 1}
		<div
			bind:this={tabsScroller}
			class="shrink-0 scrollbar-none overflow-x-auto overflow-y-hidden border-b border-border bg-background px-2 py-1 [&::-webkit-scrollbar]:hidden"
			onwheel={handleRegionTabsWheel}
		>
			<div class="flex min-w-max gap-1">
				{#each part.regions as region (region.id)}
					<button
						class="shrink-0 rounded px-2 py-0.5 text-xs whitespace-nowrap transition-colors {activeRegion?.id ===
						region.id
							? 'bg-accent text-accent-foreground'
							: 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
						onclick={() => editorViewContext.setActiveRegion(region.id)}
					>
						{region.name}
					</button>
				{/each}
			</div>
		</div>
	{/if}

	<div class="min-h-0 flex-1 overflow-hidden">
		{#if activeRegion instanceof LatticedDesignRegion}
			<Stage
				draggable={editorMode === 'PAN'}
				width={latticeCanvasWidth}
				height={latticeCanvasHeight}
				bind:this={stageRef}
				onwheel={(e) => handleWheel(e, stageRef)}
			>
				<Layer>
					<LatticeViewer
						{part}
						region={activeRegion}
						canvasWidth={latticeCanvasWidth}
						canvasHeight={latticeCanvasHeight}
					/>
				</Layer>
			</Stage>
		{:else if activeRegion?.kind === 'FREEFORM'}
			<FreeformViewer {part} region={activeRegion} {focusedSegments} bind:stageRef />
		{/if}
	</div>
</div>
