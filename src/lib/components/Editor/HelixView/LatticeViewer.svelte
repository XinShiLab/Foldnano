<script lang="ts">
	import { Group, Rect } from 'svelte-konva';
	import type { KonvaPointerEvent } from 'svelte-konva';

	import HelixCircle from './HelixCircle.svelte';
	import HelixGrid from './HelixGrid.svelte';
	import {
		getCanvasPositionByIndex,
		getLatticeCircleBounds,
		getNearestLatticeCell,
		type LatticeType,
	} from './utils';
	import {
		expandConstrainedLatticeSelection,
		previewLatticeMove,
		type LatticeMovePreview,
	} from './latticeSelection';
	import { moveLatticeVirtualHelicesCmd } from '$lib/commands/virtualHelix';
	import type { Part } from '$lib/model/Part/Part.svelte';
	import type { LatticedDesignRegion } from '$lib/model/Part/DesignRegion';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';

	interface Props {
		part: Part;
		region: LatticedDesignRegion;
		canvasWidth: number;
		canvasHeight: number;
		onIdleClick?: () => void;
	}

	const { part, region, canvasWidth, canvasHeight, onIdleClick }: Props = $props();

	const numOfCols = 32;
	const numOfRows = 30;
	const radius = 10;
	const strokeWidth = 1;
	const dragThresholdPx = 4;

	const editorViewContext = getEditorViewContext();
	const editorMode = $derived(editorViewContext.editorMode);
	const history = $derived(editorViewContext.historyStack);
	const selectedVhIndices = $derived(editorViewContext.selectedLatticeVhIndices);
	const latticeType = $derived(region.kind as LatticeType);

	type LayerPoint = { x: number; y: number };

	let activeMarquee = $state<{
		startLayer: LayerPoint;
		currentLayer: LayerPoint;
		additive: boolean;
	} | null>(null);

	let activeDrag = $state<{
		startLayer: LayerPoint;
		anchorVhIdx: number;
		anchorCell: { col: number; row: number };
		vhIndices: number[];
		preview: LatticeMovePreview;
	} | null>(null);

	const regionVhs = $derived(
		part.virtualHelices.filter((vh) => vh.regionId === region.id && vh.latticeCoords != null)
	);

	function hasSelectionModifier(e: KonvaPointerEvent): boolean {
		return e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey;
	}

	function toLayerCoords(
		stage: { x(): number; y(): number; scaleX(): number; scaleY(): number },
		raw: { x: number; y: number }
	): LayerPoint {
		return {
			x: (raw.x - stage.x()) / stage.scaleX(),
			y: (raw.y - stage.y()) / stage.scaleY(),
		};
	}

	function normalizedRect(a: LayerPoint, b: LayerPoint) {
		return {
			x: Math.min(a.x, b.x),
			y: Math.min(a.y, b.y),
			width: Math.abs(b.x - a.x),
			height: Math.abs(b.y - a.y),
		};
	}

	function boundsIntersect(
		a: { minX: number; minY: number; maxX: number; maxY: number },
		b: { minX: number; minY: number; maxX: number; maxY: number }
	): boolean {
		return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
	}

	function toggleConstraintGroup(seedIndex: number): void {
		const group = expandConstrainedLatticeSelection(part, region, [seedIndex]);
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const next = new Set(selectedVhIndices);
		const allSelected = group.every((index) => next.has(index));
		for (const index of group) {
			if (allSelected) next.delete(index);
			else next.add(index);
		}
		editorViewContext.setSelectedLatticeVhs(next);
	}

	function selectConstraintGroup(seedIndex: number): number[] {
		const group = expandConstrainedLatticeSelection(part, region, [seedIndex]);
		editorViewContext.setSelectedLatticeVhs(group);
		return group;
	}

	function previewForSelection(
		vhIndices: number[],
		delta = { col: 0, row: 0 }
	): LatticeMovePreview {
		return previewLatticeMove(part, region, vhIndices, delta, {
			cols: numOfCols,
			rows: numOfRows,
		});
	}

	function onBackgroundPointerDown(e: KonvaPointerEvent) {
		if (editorMode !== 'SELECT') return;
		if (e.target !== e.currentTarget) return;
		const stage = e.target.getStage();
		const raw = stage?.getPointerPosition();
		if (!stage || !raw) return;
		activeMarquee = {
			startLayer: toLayerCoords(stage, raw),
			currentLayer: toLayerCoords(stage, raw),
			additive: hasSelectionModifier(e),
		};
	}

	function onVhPointerDown(e: KonvaPointerEvent, vhIdx: number) {
		if (editorMode !== 'SELECT') return;
		e.cancelBubble = true;
		const stage = e.target.getStage();
		const raw = stage?.getPointerPosition();
		const vh = part.getVhByIndex(vhIdx);
		if (!stage || !raw || !vh?.latticeCoords) return;

		if (hasSelectionModifier(e)) {
			toggleConstraintGroup(vhIdx);
			return;
		}

		const nextSelection = selectedVhIndices.has(vhIdx)
			? Array.from(selectedVhIndices)
			: selectConstraintGroup(vhIdx);
		activeDrag = {
			startLayer: toLayerCoords(stage, raw),
			anchorVhIdx: vhIdx,
			anchorCell: { ...vh.latticeCoords },
			vhIndices: nextSelection,
			preview: previewForSelection(nextSelection),
		};
	}

	function onPointerMove(e: KonvaPointerEvent) {
		const stage = e.target.getStage();
		const raw = stage?.getPointerPosition();
		if (!stage || !raw) return;
		const layer = toLayerCoords(stage, raw);

		if (activeMarquee) {
			activeMarquee.currentLayer = layer;
			return;
		}

		if (!activeDrag) return;
		const nearestCell = getNearestLatticeCell(
			layer.x,
			layer.y,
			numOfCols,
			numOfRows,
			radius,
			strokeWidth,
			latticeType
		);
		if (!nearestCell) return;
		const delta = {
			col: nearestCell.col - activeDrag.anchorCell.col,
			row: nearestCell.row - activeDrag.anchorCell.row,
		};
		activeDrag.preview = previewForSelection(activeDrag.vhIndices, delta);
	}

	function onPointerUp(e: KonvaPointerEvent) {
		const stage = e.target.getStage();
		const raw = stage?.getPointerPosition();
		const layer = stage && raw ? toLayerCoords(stage, raw) : null;

		if (activeMarquee) {
			const distancePx = layer
				? Math.hypot(
						activeMarquee.currentLayer.x - activeMarquee.startLayer.x,
						activeMarquee.currentLayer.y - activeMarquee.startLayer.y
					)
				: 0;
			if (distancePx < dragThresholdPx) {
				if (!activeMarquee.additive) {
					if (selectedVhIndices.size === 0) onIdleClick?.();
					editorViewContext.clearSelectedLatticeVhs();
				}
			} else {
				const rect = normalizedRect(activeMarquee.startLayer, activeMarquee.currentLayer);
				const marqueeBounds = {
					minX: rect.x,
					minY: rect.y,
					maxX: rect.x + rect.width,
					maxY: rect.y + rect.height,
				};
				const matched = regionVhs
					.filter((vh) =>
						boundsIntersect(
							getLatticeCircleBounds(
								vh.latticeCoords!.col,
								vh.latticeCoords!.row,
								radius,
								strokeWidth,
								latticeType
							),
							marqueeBounds
						)
					)
					.map((vh) => vh.index);
				const expanded = expandConstrainedLatticeSelection(part, region, matched);
				if (activeMarquee.additive) {
					editorViewContext.addSelectedLatticeVhs(expanded);
				} else {
					editorViewContext.setSelectedLatticeVhs(expanded);
				}
			}
			activeMarquee = null;
			return;
		}

		if (!activeDrag) return;
		const movedPx = layer
			? Math.hypot(layer.x - activeDrag.startLayer.x, layer.y - activeDrag.startLayer.y)
			: 0;
		if (movedPx >= dragThresholdPx && activeDrag.preview.valid) {
			moveLatticeVirtualHelicesCmd(
				{
					part,
					region,
					vhIndices: activeDrag.vhIndices,
					fromTo: activeDrag.preview.moves,
					bounds: { cols: numOfCols, rows: numOfRows },
				},
				history
			);
		}
		activeDrag = null;
	}
</script>

<Group onpointermove={onPointerMove} onpointerup={onPointerUp}>
	<Rect
		x={0}
		y={0}
		width={canvasWidth}
		height={canvasHeight}
		fill="transparent"
		onpointerdown={onBackgroundPointerDown}
	/>

	<HelixGrid {part} {region} {numOfCols} {numOfRows} {radius} {strokeWidth} />

	<Group>
		{#each regionVhs as vh (vh.index)}
			{@const previewMove =
				activeDrag?.preview.moves.find((move) => move.vh.index === vh.index) ?? null}
			{@const displayCell = previewMove ? previewMove.to : vh.latticeCoords!}
			{@const { x, y } = getCanvasPositionByIndex(
				displayCell.col,
				displayCell.row,
				radius,
				strokeWidth,
				latticeType
			)}
			<HelixCircle
				{x}
				{y}
				{radius}
				{strokeWidth}
				vhIdx={vh.index}
				{part}
				text={`${vh.index}`}
				active
				selected={selectedVhIndices.has(vh.index)}
				invalidPreview={Boolean(previewMove && activeDrag && !activeDrag.preview.valid)}
				pointerDownHandler={(e) => onVhPointerDown(e, vh.index)}
				scafStartAngle={(vh.isEvenParity ? 0 : 180) + region.twistOffsetInDeg}
				scafBpAngle={region.twistPerBaseInDeg}
			/>
		{/each}
	</Group>

	{#if activeMarquee}
		{@const marquee = normalizedRect(activeMarquee.startLayer, activeMarquee.currentLayer)}
		<Rect
			x={marquee.x}
			y={marquee.y}
			width={marquee.width}
			height={marquee.height}
			fill={editorViewContext.editorMode === 'SELECT' ? 'rgba(59, 130, 246, 0.16)' : 'transparent'}
			listening={false}
		/>
		<Rect
			x={marquee.x}
			y={marquee.y}
			width={marquee.width}
			height={marquee.height}
			stroke="#3b82f6"
			strokeWidth={1.5}
			dash={[6, 4]}
			listening={false}
		/>
	{/if}
</Group>
