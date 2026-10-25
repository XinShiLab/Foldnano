<script lang="ts">
	import { Circle, Group, Line, Text, type KonvaPointerEvent } from 'svelte-konva';
	import type { Part } from '../../../model/Part';
	import { fillEmptyVhCmd } from '../../../commands/strands';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import { canvasTheme } from '$lib/canvasEditor/theme.svelte';
	interface Props {
		x: number;
		y: number;

		radius: number;
		strokeWidth: number;
		active?: boolean;
		vhIdx?: number;
		clickHandler?: (e: KonvaPointerEvent) => void;
		pointerDownHandler?: (e: KonvaPointerEvent) => void;
		text?: string | null;
		scafStartAngle?: number;
		scafBpAngle?: number;
		part?: Part;
		selected?: boolean;
		invalidPreview?: boolean;
		listening?: boolean;
	}

	let {
		x,
		y,
		radius,
		strokeWidth,
		clickHandler,
		text = null,
		active = false,
		vhIdx,
		scafStartAngle = 0,
		scafBpAngle = 34.3,
		part,
		pointerDownHandler,
		selected = false,
		invalidPreview = false,
		listening = true,
	}: Props = $props();

	let strokeColor = $derived(canvasTheme.colors.hxStroke);
	let fillColor = $derived(canvasTheme.colors.hxFill);
	let vhColor = $derived(canvasTheme.colors.hxVhFill);
	let occupiedVhColor = $derived(canvasTheme.colors.hxOccupiedVhFill);
	let vhStrokeColor = $derived(canvasTheme.colors.hxVhStroke);
	let hoverColor = $derived(canvasTheme.colors.hxHoverFill);
	let hoverStrokeColor = $derived(canvasTheme.colors.hxHoverStroke);
	let scafIndicatorColor = $derived(canvasTheme.colors.hxScafIndicator);

	let editorViewContext = getEditorViewContext();

	let history = $derived(editorViewContext.historyStack);
	let scafAngle = $derived(
		scafStartAngle + scafBpAngle * editorViewContext.strandViewContext.csCursorIdx
	);
	let hovered = $state(false);

	let lineEndXY = $derived.by(() => {
		const angleInRad = (scafAngle * Math.PI) / 180;
		const endX = x + 0.85 * radius * Math.cos(angleInRad);
		const endY = y + 0.85 * radius * Math.sin(angleInRad);
		return { x: endX, y: endY };
	});

	const isScafOccupied = $derived.by(() => {
		if (vhIdx === undefined) return false;
		const bpIdx = editorViewContext.strandViewContext.csCursorIdx;
		const vh = part?.getVhByIndex(vhIdx);
		if (!vh || !vh.latticeCoords) return false;
		return vh.strandSets[vh.scaffoldStrandIndex].isIndexOccupied(bpIdx);
	});

	// let hoverCircle = $state(false);

	let fillColorToSet = $derived(active ? (isScafOccupied ? occupiedVhColor : vhColor) : fillColor);
	let strokeColorToSet = $derived(active ? vhStrokeColor : strokeColor);
	const selectedStrokeColor = $derived(canvasTheme.colors.freeformDragColor);
	const invalidStrokeColor = '#dc2626';
	const invalidFillColor = '#fecaca';
	const finalFillColor = $derived.by(() => {
		if (invalidPreview) return hovered ? '#fca5a5' : invalidFillColor;
		if (hovered) return hoverColor;
		return fillColorToSet;
	});
	const finalStrokeColor = $derived.by(() => {
		if (invalidPreview) return invalidStrokeColor;
		if (selected) return selectedStrokeColor;
		if (hovered) return hoverStrokeColor;
		return strokeColorToSet;
	});
	const finalStrokeWidth = $derived.by(() => {
		if (invalidPreview) return 2.5;
		if (selected || hovered) return 2;
		return strokeWidth;
	});

	const hoverInHandler = (e: KonvaPointerEvent) => {
		e.target.getStage()?.container().style.setProperty('cursor', 'pointer');
		hovered = true;
	};
	const hoverOutHandler = (e: KonvaPointerEvent) => {
		e.target.getStage()?.container().style.setProperty('cursor', 'default');
		hovered = false;
	};

	// Native Konva pointerdblclick — more reliable than home-grown click-then-click detection.
	// Used for the existing-VH double-click-to-fill-default-strand UX. The grid-cell
	// path doesn't pass vhIdx/part, so it short-circuits and bubbles down to nothing.
	const doubleClickHandler = (e: KonvaPointerEvent) => {
		if (vhIdx === undefined || !part) return;
		e.cancelBubble = true;
		e.evt.stopPropagation();
		const vh = part.getVhByIndex(vhIdx);
		if (!vh || !vh.latticeCoords) return;
		const strandSetToCheck = vh.scaffoldStrandIndex;
		if (!vh.strandSets[strandSetToCheck].isEmpty) return;
		fillEmptyVhCmd({ part, vhIdx, strandIdx: strandSetToCheck }, history);
	};
</script>

<Group
	{listening}
	onpointerover={hoverInHandler}
	onpointerout={hoverOutHandler}
	onpointerdown={pointerDownHandler}
	onpointerclick={clickHandler ? (e) => clickHandler(e) : undefined}
	onpointerdblclick={doubleClickHandler}
>
	<Circle
		{x}
		{y}
		{radius}
		fill={finalFillColor}
		stroke={finalStrokeColor}
		strokeWidth={finalStrokeWidth}
	/>
	{#if active}
		<Line
			points={[x, y, lineEndXY.x, lineEndXY.y]}
			stroke={scafIndicatorColor}
			strokeWidth={2}
			opacity={isScafOccupied ? 0.8 : 0.3}
			lineCap="round"
		/>
	{/if}
	{#if text !== null}
		{@const textOffset = text.length > 1 ? -0.5 : 2}
		<Text
			x={x - radius / 2 + textOffset}
			y={y - radius / 2}
			{text}
			fontSize={10}
			fontStyle="bold"
			fill={canvasTheme.colors.hxText}
			align="center"
			verticalAlign="middle"
		/>
	{/if}

	<!-- {#if hoverCircle}
	<Circle
		{x}
		{y}
		{radius}
		fill='transparent'
		stroke={'red'}
		strokeWidth={2}
	/>
{/if} -->
</Group>
