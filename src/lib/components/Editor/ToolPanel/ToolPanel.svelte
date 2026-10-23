<script lang="ts">
	import { fly } from 'svelte/transition';

	import SequencePanel from './SequencePanel.svelte';
	import ColorPanel from './ColorPanel.svelte';
	import ModificationPanel from './ModificationPanel.svelte';
	import SelectPanel from './SelectPanel.svelte';
	import SkipInsertPanel from './SkipInsertPanel.svelte';
	import View3DPanel from './View3DPanel.svelte';
	import View3DOverlayPanel from './View3DOverlayPanel.svelte';
	import RegionCreationPanel from './RegionCreationPanel.svelte';
	import CircularScaffoldMapPanel from './CircularScaffoldMapPanel.svelte';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import { ChevronLeft, ChevronRight, GripVertical } from '@lucide/svelte';
	import type { Part } from '$lib/model/Part';
	import { help, type HelpSpec } from '$lib/components/help/help';

	type Props = {
		part: Part;
	};
	let { part }: Props = $props();

	let editorViewContext = getEditorViewContext();
	let isMinimal = $state<boolean>(false);
	let isBottom = $state<boolean>(false); // Track panel position: false = top, true = bottom
	let panelHeight = $state();

	const panels = [
		{ mode: 'SELECT', heading: 'Selection Tool', component: SelectPanel },
		{ mode: 'PAINT', heading: 'Paint Tool', component: ColorPanel },
		{ mode: 'MODIFICATION', heading: 'Modification Tool', component: ModificationPanel },
		{ mode: 'SEQUENCE', heading: 'Sequence Tool', component: SequencePanel },
		{ mode: 'SKIP', heading: 'Skip Tool', component: SkipInsertPanel },
		{ mode: 'INSERT', heading: 'Insert Tool', component: SkipInsertPanel },
	];

	const availablePanels = panels.map((panel) => panel.mode);
	const mapModeToPanel = Object.fromEntries(panels.map((panel) => [panel.mode, panel.component]));
	const mapModeToHeading = Object.fromEntries(panels.map((panel) => [panel.mode, panel.heading]));

	let isRegionCreationMode = $derived(editorViewContext.planeSelectionMode);
	let isView3DPanel = $derived(
		!isRegionCreationMode && editorViewContext.activeViewer === 'VIEW3D'
	);
	let view3DToolPanelMode = $derived(
		editorViewContext.view3DToolbarController?.toolPanelMode ?? 'inspector'
	);
	let isScaffoldMapPanel = $derived(
		!isRegionCreationMode && !isView3DPanel && editorViewContext.showScaffoldMap
	);
	let PanelToRender = $derived(
		(isRegionCreationMode
			? RegionCreationPanel
			: isView3DPanel
				? view3DToolPanelMode === 'overlays'
					? View3DOverlayPanel
					: View3DPanel
				: isScaffoldMapPanel
					? CircularScaffoldMapPanel
					: mapModeToPanel[editorViewContext.editorMode]) as import('svelte').Component<{
			part: Part;
		}>
	);
	let panelHeading = $derived(
		isRegionCreationMode
			? 'New Region'
			: isView3DPanel
				? view3DToolPanelMode === 'overlays'
					? '3D Overlays'
					: '3D View Inspector'
				: isScaffoldMapPanel
					? 'Circular Scaffold Map'
					: mapModeToHeading[editorViewContext.editorMode]
	);
	let shouldShowPanel = $derived(
		isRegionCreationMode ||
			isView3DPanel ||
			isScaffoldMapPanel ||
			availablePanels.some((mode) => mode === editorViewContext.editorMode)
	);

	const PANEL_HELP: Record<string, Omit<HelpSpec, 'area' | 'placement' | 'title'>> = {
		'New Region': {
			text: 'Pick the base plane the new region sits on: Top (XY), Front (XZ) or Side (YZ). Planes are not fixed; move or rotate them later in the 3D view.',
			doc: 'creating-a-design',
			newVsCadnano: true,
		},
		'Selection Tool': {
			text: 'Filters decide what a click picks up. Hover a strand to see its details below.',
			doc: 'selection',
		},
		'Paint Tool': {
			text: 'Pick a color, then click an oligo. With oligos already selected, one click anywhere paints them all.',
			doc: 'editing-tools',
		},
		'Modification Tool': {
			text: "Pick a modification, then click free 5' or 3' ends to apply it.",
			doc: 'editing-tools',
		},
		'Sequence Tool': {
			text: 'Assign, fill or clear sequences on the strands you click.',
			doc: 'editing-tools',
		},
		'Skip Tool': { text: 'Click strand positions to toggle skipped bases.', doc: 'editing-tools' },
		'Insert Tool': { text: 'Click strand positions to add inserted bases.', doc: 'editing-tools' },
		'3D View Inspector': {
			text: 'Add regions, show plane overlays, and move or rotate the selected plane.',
			doc: 'views',
			newVsCadnano: true,
		},
		'3D Overlays': {
			text: 'Load an external structure (mrDNA .txt or PDB) to compare with your design in 3D.',
			doc: '3d-overlays',
		},
		'Circular Scaffold Map': {
			text: 'How staples bind the scaffold: each scaffold as a circle, each staple as an arc between the positions it binds.',
			doc: 'selection',
		},
	};

	// Dragging state
	let isDragging = $state(false);
	let startY = $state(0);
	let dragThreshold = 100; // Minimum distance to trigger position change
	let showTopPreview = $state(false);
	let showBottomPreview = $state(false);

	function handleDragStart(e: MouseEvent) {
		isDragging = true;
		startY = e.clientY;
	}

	function handleDragMove(e: MouseEvent) {
		if (!isDragging) return;

		const deltaY = e.clientY - startY;

		// Show preview based on drag direction and threshold
		if (!isBottom && deltaY > dragThreshold) {
			showBottomPreview = true;
			showTopPreview = false;
		} else if (isBottom && deltaY < -dragThreshold) {
			showTopPreview = true;
			showBottomPreview = false;
		} else {
			showTopPreview = false;
			showBottomPreview = false;
		}
	}

	function handleDragEnd(e: MouseEvent) {
		if (!isDragging) return;
		isDragging = false;

		const deltaY = e.clientY - startY;

		// If dragged down significantly from top position, move to bottom
		if (!isBottom && deltaY > dragThreshold) {
			isBottom = true;
		}
		// If dragged up significantly from bottom position, move to top
		else if (isBottom && deltaY < -dragThreshold) {
			isBottom = false;
		}

		// Clear previews
		showTopPreview = false;
		showBottomPreview = false;
	}

	function togglePosition() {
		isBottom = !isBottom;
	}
</script>

<svelte:window onmousemove={handleDragMove} onmouseup={handleDragEnd} />

<!-- Preview outlines when dragging -->
{#if showTopPreview}
	<div
		class="fixed right-5 z-40 rounded-md border-2 border-dashed border-foreground/20 bg-background/40 p-2 backdrop-blur-sm {isScaffoldMapPanel
			? 'w-115 max-w-none'
			: 'w-70 max-w-sm'}"
		style={`top: 7rem; height: ${panelHeight}px;`}
	></div>
{/if}

{#if showBottomPreview}
	<div
		class="fixed right-5 z-40 rounded-md border-2 border-dashed border-foreground/20 bg-background/40 p-2 backdrop-blur-sm {isScaffoldMapPanel
			? 'w-115 max-w-none'
			: 'w-70 max-w-sm'}"
		style={`bottom: 20px; height: ${panelHeight}px;`}
	></div>
{/if}

{#if shouldShowPanel}
	{#if isMinimal}
		<!-- Minimal mode: show a small button to expand the panel -->
		<div
			transition:fly={{ x: 20, duration: 200 }}
			class="fixed right-0 z-50"
			style={isBottom ? 'bottom: 20px;' : 'top: 7rem;'}
		>
			<button
				class="glass-paper h-20 rounded-l-md p-0.5 hover:brightness-105"
				onclick={() => (isMinimal = !isMinimal)}
			>
				<ChevronLeft size={12} />
			</button>
		</div>
	{:else if shouldShowPanel}
		<div
			transition:fly={{ x: 20, duration: 200 }}
			bind:clientHeight={panelHeight}
			{@attach help({
				area: true,
				placement: 'left',
				title: panelHeading,
				...PANEL_HELP[panelHeading],
			})}
			class="glass-paper fixed right-5 isolate z-50 flex flex-col rounded-md p-2 transition-all duration-300 {isScaffoldMapPanel
				? 'w-[460px] max-w-none'
				: 'w-70 max-w-sm'}"
			style="{isBottom ? 'bottom: 20px;' : 'top: 7rem;'} max-height: calc(100vh - 7rem - 20px);"
		>
			<div class="relative z-10 flex min-h-0 flex-1 flex-col gap-2 px-2 text-xs">
				<!-- Draggable header -->
				<!-- svelte:ignore a11y_no_static_element_interactions -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="flex shrink-0 cursor-move items-center justify-between space-y-0 text-xs font-semibold select-none"
					onmousedown={handleDragStart}
					ondblclick={togglePosition}
				>
					<GripVertical size={12} />{panelHeading}
					<button class="bg-muted p-1 hover:bg-accent" onclick={() => (isMinimal = !isMinimal)}>
						<ChevronRight size={12} />
					</button>
				</div>

				<!-- overflow-x-hidden: shadcn Switch's enlarged hit area (after:-inset-x-3) pokes past a flush-right edge. -->
				<div class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
					<PanelToRender {part} />
				</div>
			</div>
		</div>
	{/if}
{/if}
