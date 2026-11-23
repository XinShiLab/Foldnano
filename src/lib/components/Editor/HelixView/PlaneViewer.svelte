<script lang="ts">
	import { onDestroy } from 'svelte';
	import { Stage, Layer } from 'svelte-konva';
	import type { Stage as StageType } from 'svelte-konva';
	import type { Part } from '$lib/model/Part/Part.svelte';
	import type OligoSegment from '$lib/model/Oligo/OligoSegment.svelte';
	import { LatticedDesignRegion } from '$lib/model/Part/DesignRegion';
	import LatticeViewer from './LatticeViewer.svelte';
	import FreeformViewer from './FreeformViewer.svelte';
	import PlaneGestureHint from './PlaneGestureHint.svelte';
	import { handleWheel } from '../mouseHandler';
	import { scrollStrip } from '$lib/components/scroll-strip/scroll-strip';
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
	// The stage fills the pane, so presses on bare canvas around a zoomed-out lattice still land.
	let paneWidth = $state(0);
	let paneHeight = $state(0);
	let latticeViewer = $state<LatticeViewer>();
	const DRAW_NUDGE_MS = 4000;
	let drawNudge = $state(false);
	let drawNudgeTimer: ReturnType<typeof setTimeout> | undefined;

	function showDrawNudge(): void {
		drawNudge = true;
		clearTimeout(drawNudgeTimer);
		drawNudgeTimer = setTimeout(() => (drawNudge = false), DRAW_NUDGE_MS);
	}

	onDestroy(() => clearTimeout(drawNudgeTimer));

	let activeRegion = $derived.by(() => {
		const id = editorViewContext.activeRegionId;
		if (id) {
			const found = part.getRegionById(id);
			if (found) return found;
		}
		return part.regions[0] ?? null;
	});
</script>

<div class="flex h-full flex-col overflow-hidden">
	{#if part.regions.length > 1}
		<div
			class="shrink-0 scrollbar-none overflow-x-auto overflow-y-hidden border-b border-border bg-background px-2 py-1 [&::-webkit-scrollbar]:hidden"
			{@attach scrollStrip}
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

	<div
		class="relative min-h-0 flex-1 overflow-hidden"
		bind:clientWidth={paneWidth}
		bind:clientHeight={paneHeight}
	>
		{#if activeRegion instanceof LatticedDesignRegion}
			<Stage
				draggable={editorMode === 'PAN'}
				width={paneWidth || latticeCanvasWidth}
				height={paneHeight || latticeCanvasHeight}
				bind:this={stageRef}
				onwheel={(e) => handleWheel(e, stageRef, editorMode === 'PAN')}
				onpointerdown={(e) => latticeViewer?.onStagePointerDown(e)}
				onpointermove={(e) => latticeViewer?.onPointerMove(e)}
				onpointerup={(e) => latticeViewer?.onPointerUp(e)}
				onpointercancel={() => latticeViewer?.cancelPointer()}
			>
				<Layer>
					<LatticeViewer
						bind:this={latticeViewer}
						{part}
						region={activeRegion}
						onIdleClick={showDrawNudge}
					/>
				</Layer>
			</Stage>
		{:else if activeRegion?.supportsFreeformPlacement}
			<FreeformViewer
				{part}
				region={activeRegion}
				{focusedSegments}
				onIdleClick={showDrawNudge}
				bind:stageRef
			/>
		{/if}
		{#if activeRegion}
			<PlaneGestureHint {part} region={activeRegion} nudge={drawNudge} />
		{/if}
	</div>
</div>
