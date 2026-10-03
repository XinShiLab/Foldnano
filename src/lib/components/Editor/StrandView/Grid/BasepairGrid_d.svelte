<script lang="ts">
	import { Group, Rect } from 'svelte-konva';
	import { getDimensionContext } from '../drawingContext';
	import { canvasTheme } from '$lib/canvasEditor/theme.svelte';

	// let footnoteContext = getFootnoteContext();

	interface Props {
		rowIdx: number;
		bpIdx: number;
	}
	let { rowIdx, bpIdx }: Props = $props();

	const d = getDimensionContext();
	const { dimensions, getBpCoordsByRowAndBpIdx } = d;

	const [[x1, y1], [x2, y2]] = getBpCoordsByRowAndBpIdx(rowIdx, bpIdx);
	const { sideLength, strokeWidth } = dimensions;

	let bpEl = $state<Group>();
</script>

<!--   -->

<Group bind:this={bpEl} z-index={1}>
	<Rect
		x={x1}
		y={y1}
		width={sideLength}
		height={sideLength}
		fill="transparent"
		stroke={canvasTheme.colors.gridLine}
		{strokeWidth}
		perfectDrawEnabled={false}
	/>
	<Rect
		x={x2}
		y={y2}
		width={sideLength}
		height={sideLength}
		fill="transparent"
		stroke={canvasTheme.colors.gridLine}
		{strokeWidth}
		perfectDrawEnabled={false}
	/>
</Group>
