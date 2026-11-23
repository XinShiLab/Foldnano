<script lang="ts">
	import { Stage, Layer, type KonvaPointerEvent, Group, Rect } from 'svelte-konva';
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
	import RecentFillMarkers from './RecentFillMarkers.svelte';
	import DesignIssueMarkers from './DesignIssueMarkers.svelte';
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
	import Crossover from './crossover';
	import ConnectionMarks from './crossover/ConnectionMarks.svelte';
	import {
		buildConnectionMarks,
		findConnectionMark,
		hitConnectionMark,
		NO_CONNECTION_MARKS,
		selectedConnectionMarks,
	} from './crossover/connectionMarks';
	import { help } from '$lib/components/help/help';
	import { registerStrandCanvasHelp } from './strandCanvasHelp';
	import { nextRenderWindow } from './renderWindow';
	import { firstPressActivates } from '../context/firstPressActivates';
	import { fitTransform, unionBounds, type ContentBounds } from './fitView';
	import { regionHeaderGeometry } from './Grid/regionHeaderGeometry';

	interface Props {
		part: Part;
	}
	let { part }: Props = $props();

	const editorViewContext = getEditorViewContext();
	// The first left press on an inactive strand view only activates it (keeps a 3D selection).
	const activation = firstPressActivates(
		() => editorViewContext.activeViewer === 'STRAND',
		() => editorViewContext.setActiveViewer('STRAND')
	);
	let viewerEl = $state<HTMLDivElement>();
	let viewerWidth = $state(1000);
	let viewerHeight = $state(800);
	const strandToolbarController = $state({
		part,
		stage: undefined as Stage | undefined,
		updateViewportBounds,
		updateViewportScale,
		panBy,
		centerOn,
		revealVh,
		fitView,
		resetView,
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
	const FIT_PADDING_PX = 24;
	const FIT_MIN_SCALE = 0.02;

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

	let hideContext = $derived(editorViewContext.strandViewContext.hideContext);
	let crossoversHidden = $derived(hideContext.crossovers || hideContext.unconstrained_crossovers);
	let connectionMarks = $derived(
		crossoversHidden ? buildConnectionMarks(part, d, hideContext) : NO_CONNECTION_MARKS
	);
	let selectedMarks = $derived(
		selectedConnectionMarks(connectionMarks, editorViewContext.strandViewContext.selected.ends)
	);
	// Held by key so an edit under the pointer drops the preview instead of leaving a stale arc.
	let hoveredMarkKey = $state<string | null>(null);
	let hoveredMark = $derived(
		hoveredMarkKey ? findConnectionMark(connectionMarks, hoveredMarkKey) : null
	);

	function connectionMarkUnderPointer() {
		if (!crossoversHidden || !camera) return null;
		const world = camera.toWorld();
		return hitConnectionMark(connectionMarks, d.getRowIdxByY(world.y), world.x, world.y);
	}

	function jumpToConnectionTarget(e: KonvaPointerEvent) {
		if (editorViewContext.editorMode === 'PAN') return;
		if ((e.target as Konva.Node).getAttr('id') !== 'EMPTY') return;
		const markHit = connectionMarkUnderPointer();
		if (!markHit?.onLabel) return;
		hoveredMarkKey = null;
		centerOn(markHit.mark.targetVhId, markHit.mark.targetBpIdx);
	}

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
		const strandCtx = editorViewContext.strandViewContext;
		strandCtx.viewportBounds = {
			x: bounds.x,
			y: bounds.y,
			width: bounds.width,
			height: bounds.height,
		};
		const renderBounds = nextRenderWindow(strandCtx.renderBounds, bounds);
		if (renderBounds !== strandCtx.renderBounds) strandCtx.renderBounds = renderBounds;
	}

	function panBy(dx: number, dy: number) {
		const node = stage?.node;
		if (!node) return;
		node.position({ x: node.x() + dx, y: node.y() + dy });
		updateViewportBounds();
	}

	function shownDisplayRow(vhId: string): number | null {
		const vh = part.getVhById(vhId);
		if (!vh) return null;
		const strandCtx = editorViewContext.strandViewContext;
		if (vh.regionId && strandCtx.collapsedRegionIds.includes(vh.regionId)) {
			strandCtx.collapsedRegionIds = strandCtx.collapsedRegionIds.filter(
				(id) => id !== vh.regionId
			);
		}
		const row = d.getEffectiveDisplayRowForVh(vhId);
		return row === null || row.isCollapsed ? null : row.displayRow;
	}

	function centerOn(vhId: string, bp: number, opts?: { onlyIfOffscreen?: boolean }): boolean {
		const node = stage?.node;
		if (!node) return false;
		const displayRow = shownDisplayRow(vhId);
		if (displayRow === null) return false;
		const [top, bottom] = getBpCoordsByRowAndBpIdx(displayRow, bp);
		const scale = node.scaleX() || 1;
		if (opts?.onlyIfOffscreen) {
			const left = top[0] * scale + node.x();
			const right = (top[0] + sideLength) * scale + node.x();
			const rowTop = top[1] * scale + node.y();
			const rowBottom = (bottom[1] + sideLength) * scale + node.y();
			if (left >= 0 && right <= viewerWidth && rowTop >= 0 && rowBottom <= viewerHeight)
				return true;
		}
		const x = top[0] + sideLength / 2;
		const y = (top[1] + bottom[1] + sideLength) / 2;
		node.position({ x: viewerWidth / 2 - x * scale, y: viewerHeight / 2 - y * scale });
		updateViewportBounds();
		return true;
	}

	function revealVh(vhId: string): boolean {
		const node = stage?.node;
		if (!node) return false;
		const displayRow = shownDisplayRow(vhId);
		if (displayRow === null) return false;
		const [top, bottom] = getBpCoordsByRowAndBpIdx(displayRow, 0);
		const scale = node.scaleX() || 1;
		const rowTop = top[1] * scale + node.y();
		const rowBottom = (bottom[1] + sideLength) * scale + node.y();
		// Already fully on screen: leave the view alone so repeated clicks don't make it twitch.
		if (rowTop >= 0 && rowBottom <= viewerHeight) return true;
		const y = (top[1] + bottom[1] + sideLength) / 2;
		node.y(viewerHeight / 2 - y * scale);
		updateViewportBounds();
		return true;
	}

	function selectionBounds(): ContentBounds | null {
		const boxes: ContentBounds[] = [];
		for (const end of editorViewContext.strandViewContext.selected.ends) {
			const displayRow = shownDisplayRow(end.inVirtualHelix.id);
			if (displayRow === null) continue;
			const [top, bottom] = getBpCoordsByRowAndBpIdx(displayRow, end.index);
			boxes.push({
				minX: top[0],
				minY: top[1],
				maxX: top[0] + sideLength,
				maxY: bottom[1] + sideLength,
			});
		}
		return unionBounds(boxes);
	}

	// Fits the selection (or the whole design), only ever zooming out from the current scale.
	function fitView() {
		const node = stage?.node;
		if (!node) return;
		const selection = selectionBounds();
		const content = selection ?? { minX: 0, minY: 0, maxX: clickableWidth, maxY: clickableHeight };
		const scale = node.scaleX() || 1;
		const t = fitTransform(
			content,
			{ width: viewerWidth, height: viewerHeight },
			{
				paddingPx: FIT_PADDING_PX,
				minScale: FIT_MIN_SCALE,
				maxScale: selection ? scale : Math.min(scale, 1),
			}
		);
		node.scale({ x: t.scale, y: t.scale });
		node.position({ x: t.x, y: t.y });
		updateViewportBounds();
		updateViewportScale();
	}

	/** Top of a region's header row, or of the first header when `regionId` is omitted. */
	function regionHeaderTop(regionId?: string): number | null {
		const row = d
			.getVisibleStrandRows()
			.find(
				(r) => r.kind === 'REGION_HEADER' && (regionId === undefined || r.regionId === regionId)
			);
		return row ? regionHeaderGeometry(d, row.displayRow, 0).top : null;
	}

	// Default zoom at base 0, scrolled so the active region's header sits where the first one does.
	function resetView() {
		const node = stage?.node;
		if (!node) return;
		const regionId = editorViewContext.activeRegionId;
		const activeTop = regionId ? regionHeaderTop(regionId) : null;
		const firstTop = regionHeaderTop();
		const dy = activeTop !== null && firstTop !== null ? activeTop - firstTop : 0;
		node.scale({ x: 1, y: 1 });
		node.position({ x: 0, y: -dy });
		updateViewportBounds();
		updateViewportScale();
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

	function forward(type: PointerEventType, e: KonvaPointerEvent) {
		if (editorViewContext.editorMode === 'PAN') {
			hoveredMarkKey = null;
			return;
		}

		const dom = e.evt;
		const markHit = connectionMarkUnderPointer();
		if (type === 'cancel') hoveredMarkKey = null;
		if (type === 'move') hoveredMarkKey = dom.buttons === 0 ? (markHit?.mark.key ?? null) : null;

		if (type === 'down' && dom.button !== 0) {
			return;
		}
		// Keep the drag's events coming when it leaves the canvas, so release outside still ends it.
		if (type === 'down' && dom.target instanceof Element)
			dom.target.setPointerCapture(dom.pointerId);
		// console.log('Forwarding event', type, 'at', e.target.getAttr('id'));
		const p = stage?.node.getPointerPosition() || { x: 0, y: 0 };
		// Any pointer-down inside a region's row band activates that region.
		// Region-header clicks already activate via onRegionHeader; this covers
		// the more common "I edited a strand" case.
		if (type === 'down') {
			// p is in screen space; rows are laid out in world space (pan/zoom).
			const worldY = camera ? camera.toWorld().y : p.y;
			const displayRow = d.getRowIdxByY(worldY);
			const row = d.getRowAtDisplayRow(displayRow);
			if (row && row.regionId && row.regionId !== editorViewContext.activeRegionId) {
				editorViewContext.setActiveRegion(row.regionId);
			}
		}
		// Marks have no Konva nodes; a label acts as the crossover line it stands in for.
		// Bare canvas past the content (zoomed out) is empty space too.
		const konvaTargetId =
			e.target === stage?.node ? 'EMPTY' : (e.target as Konva.Node).getAttr('id');
		controller.handlePointer({
			directTargetId:
				konvaTargetId === 'EMPTY' && markHit?.onLabel ? markHit.mark.xoverId : konvaTargetId,
			type,
			// pointermove reports -1 ("no button change") where mousemove reported 0; tools expect 0.
			button: dom.button === -1 ? 0 : dom.button,
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

	// Canvas help notes exist only while help is open; header and tag gestures are Select-only.
	$effect(() => {
		const node = stage?.node;
		if (!editorViewContext.showShortcuts || editorViewContext.editorMode !== 'SELECT') return;
		if (!viewerEl || !node) return;
		return registerStrandCanvasHelp(viewerEl, node, d, part);
	});

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
	bind:this={viewerEl}
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
	{...activation}
	onpointerdown={() => editorViewContext.setActiveViewer('STRAND')}
	onfocusin={() => editorViewContext.setActiveViewer('STRAND')}
>
	<Stage
		draggable={editorViewContext.editorMode === 'PAN'}
		width={viewerWidth || 1000}
		height={viewerHeight || 800}
		bind:this={stage}
		onwheel={(e) => {
			handleWheel(e, stage, editorViewContext.editorMode === 'PAN');
			updateViewportBounds();
			updateViewportScale();
		}}
		ondragmove={(e) => {
			// Without this, a pan past the render window shows blank canvas until release.
			if (e.target === stage?.node) updateViewportBounds();
		}}
		ondragend={() => updateViewportBounds()}
		onpointerdown={(e) => forward('down', e)}
		onpointermove={(e) => forward('move', e)}
		onpointerup={(e) => forward('up', e)}
		onpointerleave={(e) => {
			// A drag keeps the pointer captured, so it ends with `up` wherever it is released.
			if (e.evt.buttons === 0) forward('cancel', e);
		}}
		onpointercancel={(e) => forward('cancel', e)}
		oncontextmenu={(e) => {
			e.evt.preventDefault();
			forward('contextmenu', e);
		}}
	>
		<Layer listening={false}>
			<Group bind:this={world}>
				{#if part}
					<Grid {part} />
					<MismatchMarkers {part} />
					<RecentFillMarkers />
					<StrandRoutes {part} />
					<DesignIssueMarkers />
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

		<Layer bind:this={overlay} listening={true} onpointerdblclick={jumpToConnectionTarget}>
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
			{#if crossoversHidden}
				<ConnectionMarks marks={connectionMarks} />
				{#each selectedMarks as mark (mark.key)}
					{#if mark.arc}
						<Crossover
							id={mark.xoverId}
							start={mark.arc.start}
							end={mark.arc.end}
							isConstrained={mark.arc.isConstrained}
							color={mark.color}
							opacity={mark.opacity}
							strokeWidth={2}
						/>
					{/if}
				{/each}
			{/if}
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
			{#if hoveredMark?.arc}
				<Crossover
					id="CONNECTION_PREVIEW"
					start={hoveredMark.arc.start}
					end={hoveredMark.arc.end}
					isConstrained={hoveredMark.arc.isConstrained}
					color={hoveredMark.color}
					opacity={hoveredMark.opacity}
					strokeWidth={2}
				/>
			{/if}
			<SelectionOverlay selected={editorViewContext.strandViewContext.selected} />
			<TemporalParts temporalParts={editorViewContext.strandViewContext.tempParts} />
			<DuplicatePreview />
		</Layer>
	</Stage>
	<ContextMenu bind:contextMenu={editorViewContext.strandViewContext.contextMenu} />
</div>
