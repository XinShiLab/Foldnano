<script lang="ts">
	import { Text, Rect, type KonvaPointerEvent, Group } from 'svelte-konva';
	import { getDimensionContext } from './drawingContext';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import { canvasTheme } from '$lib/canvasEditor/theme.svelte';

	interface Props {
		headerDisplayRow: number | null;
		firstVisibleVhDisplayRow: number | null;
		lastVisibleVhDisplayRow: number | null;
		numOfBPsPerHelix: number;
	}

	let {
		headerDisplayRow,
		firstVisibleVhDisplayRow,
		lastVisibleVhDisplayRow,
		numOfBPsPerHelix,
	}: Props = $props();
	const d = getDimensionContext();
	const { sideLength, strokeWidth } = d.dimensions;
	const { getXByBpIdx, getRowYByRowIdx } = d;

	const editorViewContext = getEditorViewContext();
	const editorMode = $derived(editorViewContext.editorMode);

	// let currentBp = $state<number>(10);
	const crossSectionCursor = $derived(editorViewContext.strandViewContext.csCursorIdx);
	const currentBp = $derived(crossSectionCursor);
	let selectorEl = $state<Rect>();
	let x = $derived(getXByBpIdx(currentBp));
	const label = $derived(`${currentBp}`);
	const labelY = $derived.by(() => {
		if (headerDisplayRow === null) return 0;
		return getRowYByRowIdx(headerDisplayRow) + sideLength + 8;
	});
	const rectY = $derived(
		firstVisibleVhDisplayRow === null ? 0 : getRowYByRowIdx(firstVisibleVhDisplayRow) - sideLength
	);
	const height = $derived.by(() => {
		if (firstVisibleVhDisplayRow === null || lastVisibleVhDisplayRow === null) return 0;
		const top = getRowYByRowIdx(firstVisibleVhDisplayRow) - sideLength;
		const bottom = getRowYByRowIdx(lastVisibleVhDisplayRow) + sideLength;
		return Math.max(bottom - top, 0);
	});

	const hoverInHandler = (e: KonvaPointerEvent) => {
		if (!selectorEl) return;
		e.target.getStage()?.container().style.setProperty('cursor', 'move');
	};
	const hoverOutHandler = (e: KonvaPointerEvent) => {
		if (!selectorEl) return;
		e.target.getStage()?.container().style.setProperty('cursor', 'default');
	};
</script>

{#if headerDisplayRow !== null && firstVisibleVhDisplayRow !== null && lastVisibleVhDisplayRow !== null && numOfBPsPerHelix}
	<Group>
		<Text
			{x}
			y={labelY}
			text={label}
			fontSize={10}
			fontStyle="bold"
			fill={canvasTheme.colors.csCursorText}
			align="centre"
			verticalAlign="middle"
		/>
		<Rect
			id="CS_CURSOR#01"
			bind:this={selectorEl}
			{x}
			y={rectY}
			width={sideLength}
			{height}
			fill={canvasTheme.colors.csCursorFill}
			opacity={0.3}
			stroke={canvasTheme.colors.csCursorStroke}
			{strokeWidth}
			onpointerover={hoverInHandler}
			onpointerout={hoverOutHandler}
			listening={editorMode === 'SELECT'}
			z-index={649}
		/>
	</Group>
{/if}
