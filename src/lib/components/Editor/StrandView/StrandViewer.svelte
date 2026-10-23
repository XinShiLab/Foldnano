<script lang="ts">
	import { Stage, Layer, type KonvaMouseEvent, Group, Rect } from 'svelte-konva';
	import { handleWheel } from '../mouseHandler';
	import { KonvaCamera } from '$lib/canvasEditor/services/cameraKonva';
	import { onMount } from 'svelte';
	import { DrawTool } from '$lib/canvasEditor/tools/draw';
	import { BreakTool } from '$lib/canvasEditor/tools/break';
	import { SelectTool } from '$lib/canvasEditor/tools/select';
	import { modeAllowedInView } from '$lib/canvasEditor/core/capabilities';
	import { ToolController, type PointerEventType } from '$lib/canvasEditor/tools';
	import StrandRoutes from './StrandRoutes.svelte';
	import Grid from './Grid';
	import { Part } from '$lib/model/Part';
	import { createDrawingDimensions } from './drawingDimensions';
	import { setDimensionContext } from './drawingContext';
	import { createStrandRowLayout } from './strandRowLayout';
	import { makeETMHitTester } from '$lib/canvasEditor/services/hitEventToModel';
	import Accessories from './Accessories.svelte';
	import Konva from 'konva';
	import TemporalParts from './temporalLayer/TemporalParts.svelte';
	import DuplicatePreview from './temporalLayer/DuplicatePreview.svelte';
	import SelectionOverlay from './temporalLayer/SelectionOverlay.svelte';
	import CrossSectionSelector from './CrossSectionSelector.svelte';
	import type { ViewContext } from '$lib/canvasEditor/core/views';
	import XoverSitesAround from './CrossoverSite/XoverSitesAround.svelte';
	import Highlights from './Highlights.svelte';
	import MismatchMarkers from './MismatchMarkers.svelte';
	import { SkipTool } from '$lib/canvasEditor/tools/skip';
	import { InsertTool } from '$lib/canvasEditor/tools/insert';
	import { PaintTool } from '$lib/canvasEditor/tools/paint';
	import ContextMenu from './ContextMenu.svelte';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import { SequenceTool } from '../../../canvasEditor/tools/sequence';
	import { ModificationTool } from '$lib/canvasEditor/tools/modification';
	import { SplitRegionTool } from '$lib/canvasEditor/tools/splitRegion';
	import { DuplicateTool } from '$lib/canvasEditor/tools/duplicate';
	import { createHoverInfoBehavior } from '../../../canvasEditor/tools/behaviors/hoverInfo';
	import { createContextMenuBehavior } from '../../../canvasEditor/tools/behaviors/contextMenu';
	import BlockLayer from './BlockLayer.svelte';
	import { help } from '$lib/components/help/help';

	interface Props {
		part: Part;
	}
	let { part }: Props = $props();

	const editorViewContext = getEditorViewContext();
	let viewerWidth = $state(1000);
	let viewerHeight = $state(800);
	const strandToolbarController = $state({
		part,
		stage: undefined as Stage | undefined,
		updateViewportBounds,
		updateViewportScale,
		panBy,
	});

	let stage = $state<Stage>();
	let overlay = $state<Layer>();
	let world = $state<Group>();
	let camera = $state<KonvaCamera | undefined>();
	let controller: ToolController;
	let ctx: ViewContext;
	let activeAreaAround = $derived(editorViewContext.strandViewContext.activeAround);

	const radius = 16;
	const sideLength = 12;
	const strokeWidth = 1;

	let collapsedRegionIds = $derived(editorViewContext.strandViewContext.collapsedRegionIds);
	let activeCsRegionId = $derived(editorViewContext.strandViewContext.activeCsRegionId);
	let rowLayout = $derived.by(() => {
		void collapsedRegionIds.join('|');
		void activeCsRegionId;
		void part.regions.map((region) => region.id).join('|');
		void part.virtualHelices.length;
		for (const vh of part.virtualHelices) {
			void vh.listRow;
			void vh.regionId;
		}
		return createStrandRowLayout(part, collapsedRegionIds, radius, sideLength, strokeWidth);
	});
	const d = createDrawingDimensions(radius, sideLength, strokeWidth, () => rowLayout);
	const { dimensions, getBpCoordsByRowAndBpIdx } = d;
	setDimensionContext(d);

	onMount(() => {
		editorViewContext.registerStrandToolbarController(strandToolbarController);
		if (!controller && stage && world && overlay) {
			camera = new KonvaCamera(stage);
			const hit = makeETMHitTester(d, part);

			ctx = {
				id: 'routing',
				kind: 'ROUTING',
				part,
				drawingDimensions: d,
				camera,
				hit,
				overlay: overlay.node,
				strandCtx: editorViewContext.strandViewContext,
				history: editorViewContext.historyStack,
				editorCtx: editorViewContext,
			};

			const allTools = [
				SelectTool(),
				DrawTool(),
				BreakTool(),
				SkipTool(),
				InsertTool(),
				PaintTool(),
				ModificationTool(),
				SequenceTool(),
				SplitRegionTool(),
				DuplicateTool(),
			];
			const tools = allTools.filter((t) => modeAllowedInView('ROUTING', t.name));

			const hoverBehavior = createHoverInfoBehavior(
				new Set(['SELECT', 'PAINT', 'DRAW', 'INSERT', 'SKIP', 'MODIFICATION', 'SEQUENCE'])
			);
			const contextMenuBehavior = createContextMenuBehavior(); // Apply to all modes
			const behaviors = [hoverBehavior, contextMenuBehavior];
			controller = new ToolController(tools, ctx, () => editorViewContext.editorMode, behaviors);

			Konva.dragButtons = [0, 1];

			// Initialize viewport bounds
			updateViewportBounds();
		}

		return () => {
			editorViewContext.registerStrandToolbarController(null);
		};
	});

	function updateViewportBounds() {
		if (!camera) return;
		const bounds = camera.currentBounds;
		editorViewContext.strandViewContext.viewportBounds = {
			x: bounds.x,
			y: bounds.y,
			width: bounds.width,
			height: bounds.height,
		};
	}

	function panBy(dx: number, dy: number) {
		const node = stage?.node;
		if (!node) return;
		node.position({ x: node.x() + dx, y: node.y() + dy });
		updateViewportBounds();
	}

	function updateViewportScale() {
		if (!camera) return;
		editorViewContext.strandViewContext.viewportScale = camera.scale;
	}

	$effect(() => {
		strandToolbarController.part = part;
		strandToolbarController.stage = stage;
	});

	$effect(() => {
		if (ctx) {
			ctx.part = part;
			ctx.hit = makeETMHitTester(d, part);
			ctx.history = editorViewContext.historyStack;
			ctx.strandCtx = editorViewContext.strandViewContext;
		}
	});

	$effect(() => {
		void editorViewContext.editorMode;
		if (controller) {
			controller.syncMode(editorViewContext.editorMode);
		}
	});

	function forward(type: PointerEventType, e: KonvaMouseEvent) {
		if (editorViewContext.editorMode === 'PAN') return;

		const dom = e.evt as MouseEvent;
		if (type === 'down' && dom.button !== 0) {
			return;
		}
		// console.log('Forwarding event', type, 'at', e.target.getAttr('id'));
		const p = stage?.node.getPointerPosition() || { x: 0, y: 0 };
		// Any pointer-down inside a region's row band activates that region.
		// Region-header clicks already activate via onRegionHeader; this covers
		// the more common "I edited a strand" case.
		if (type === 'down') {
			const displayRow = d.getRowIdxByY(p.y);
			const row = d.getRowAtDisplayRow(displayRow);
			if (row && row.regionId && row.regionId !== editorViewContext.activeRegionId) {
				editorViewContext.setActiveRegion(row.regionId);
			}
		}
		controller.handlePointer({
			directTargetId: (e.target as Konva.Node).getAttr('id'),
			type,
			button: dom.button,
			altKey: dom.altKey,
			shiftKey: dom.shiftKey,
			ctrlKey: dom.ctrlKey,
			metaKey: dom.metaKey,
			clientX: p.x,
			clientY: p.y,
		});
	}

	$effect(() => {
		const activeRow = editorViewContext.strandViewContext.activeAround.rowIdx;
		if (activeRow !== -1 && !d.getVisibleVhByDisplayRow(activeRow)) {
			editorViewContext.strandViewContext.activeAround = { rowIdx: -1, bpIdx: -1 };
		}
	});

	let firstVisibleVhDisplayRow = $derived.by(() => {
		const rows = d
			.getVisibleVhRows()
			.filter((row) => activeCsRegionId !== null && row.regionId === activeCsRegionId);
		return rows.length > 0 ? rows[0].displayRow : null;
	});
	let lastVisibleVhDisplayRow = $derived.by(() => {
		const rows = d
			.getVisibleVhRows()
			.filter((row) => activeCsRegionId !== null && row.regionId === activeCsRegionId);
		return rows.length > 0 ? rows[rows.length - 1].displayRow : null;
	});
	let activeCsRegionHeaderDisplayRow = $derived.by(() => {
		if (!activeCsRegionId) return null;
		const row = d
			.getVisibleStrandRows()
			.find(
				(candidate) => candidate.kind === 'REGION_HEADER' && candidate.regionId === activeCsRegionId
			);
		return row?.displayRow ?? null;
	});
	let numberOfDisplayRows = $derived(d.getVisibleStrandRows().length);
	// Each region carries its own maxBase; the canvas must be wide enough for the
	// widest region.
	// NOTE: DesignRegion.maxBase is a plain (non-$state) field, so Svelte won't
	// track it directly. We read vh.length (reactive $state) and
	// virtualHelices.length so this re-derives after increaseVhsLengthBy mutates
	// maxBase in the same synchronous transaction.
	let numberOfBps = $derived.by(() => {
		void part.virtualHelices.length;
		for (const vh of part.virtualHelices) void vh.length;
		const regionMax =
			part.regions.length > 0 ? Math.max(...part.regions.map((r) => r.maxBase)) : part.maxBase;
		// Keep a Duplicate preview that runs past the region end on the clickable canvas.
		const dup = editorViewContext.strandViewContext.duplicateState;
		if (!dup) return regionMax;
		const previewMax = Math.max(
			...dup.oligos.flatMap((o) => [...o.segments].map((s) => s.highIndex + dup.delta + 1))
		);
		return Math.max(regionMax, previewMax);
	});
	let lastNtPosition = $derived(
		getBpCoordsByRowAndBpIdx(Math.max(numberOfDisplayRows - 1, 0), Math.max(numberOfBps - 1, 0))
	);
	let clickableWidth = $derived(lastNtPosition[0][0] + dimensions.sideLength);
	let clickableHeight = $derived(
		numberOfDisplayRows > 0
			? d.getRowYByRowIdx(numberOfDisplayRows - 1) + dimensions.sideLength * 2
			: dimensions.sideLength * 2
	);

	// Forwards keyboard events into the active tool (e.g. SplitRegionTool's
	// Escape-to-cancel). Editor.svelte's global handler covers mode switches and
	// selection clearing; this only reaches per-tool `onKey` behavior.
	function handleKeydown(e: KeyboardEvent) {
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
			return;
		}
		if (controller) {
			controller.handleKey(e);
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div
	class="relative m-2 h-full w-full overflow-hidden"
	{@attach help({
		area: true,
		title: 'Strand viewer',
		text: 'The routing canvas: one row per helix, grouped by region. Draw, break and connect strands here.',
		doc: 'editing-tools',
	})}
	bind:clientWidth={viewerWidth}
	bind:clientHeight={viewerHeight}
	style={editorViewContext.editorMode === 'PAN' ? 'cursor: grab' : ''}
	onpointerdown={() => editorViewContext.setActiveViewer('STRAND')}
	onfocusin={() => editorViewContext.setActiveViewer('STRAND')}
>
	<Stage
		draggable={editorViewContext.editorMode === 'PAN'}
		width={viewerWidth || 1000}
		height={viewerHeight || 800}
		bind:this={stage}
		onwheel={(e) => {
			handleWheel(e, stage);
			updateViewportBounds();
			updateViewportScale();
		}}
		ondragend={() => updateViewportBounds()}
	>
		<Layer listening={false}>
			<Group bind:this={world}>
				{#if part}
					<Grid {part} />
					<MismatchMarkers {part} />
					<StrandRoutes {part} />
					{#if editorViewContext.strandViewContext.showBlocks}
						<BlockLayer {part} />
					{/if}
				{/if}
				<!-- // draw an Rect for camera.currentBounds -->
				<!-- <Rect 
          x={camera ? camera.currentBounds.x : 0} 
          y={camera ? camera.currentBounds.y : 0} 
          width={camera ? camera.currentBounds.width : 0} 
          height={camera ? camera.currentBounds.height : 0} 
          stroke="red"
          strokeWidth={1} 
          fill="red"
          opacity={0.1}
          listening={false}
          perfectDrawEnabled={false}
          ></Rect> -->
			</Group>
		</Layer>

		<Layer
			bind:this={overlay}
			listening={true}
			onmousedown={(e) => forward('down', e)}
			onmousemove={(e) => forward('move', e)}
			onmouseup={(e) => forward('up', e)}
			onmouseleave={(e) => forward('cancel', e)}
			oncontextmenu={(e) => {
				e.evt.preventDefault();
				forward('contextmenu', e);
			}}
		>
			<Rect
				id="EMPTY"
				x={-100}
				y={-100}
				width={clickableWidth + 300}
				height={clickableHeight + 400}
				perfectDrawEnabled={false}
				fill="transparent"
				listening={true}
			/>
			<Accessories {part} />
			<Highlights {part} />
			{#if editorViewContext.activeRegion?.supportsConstrainedXoverSites}
				<XoverSitesAround {part} activeAround={activeAreaAround} />
			{/if}
			<CrossSectionSelector
				headerDisplayRow={activeCsRegionHeaderDisplayRow}
				numOfBPsPerHelix={editorViewContext.activeRegion?.maxBase ?? part.maxBase}
				{firstVisibleVhDisplayRow}
				{lastVisibleVhDisplayRow}
			/>
		</Layer>

		<Layer listening={false}>
			<SelectionOverlay selected={editorViewContext.strandViewContext.selected} />
			<TemporalParts temporalParts={editorViewContext.strandViewContext.tempParts} />
			<DuplicatePreview />
		</Layer>
	</Stage>
	<ContextMenu bind:contextMenu={editorViewContext.strandViewContext.contextMenu} />
</div>
