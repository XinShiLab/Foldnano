<script lang="ts">
	import { Circle, Line } from 'svelte-konva';
	import { getDimensionContext } from '../drawingContext';

	export interface VhDragPreviewProps {
		targetRowIdx: number;
		maxBpIdx: number;
	}

	let { targetRowIdx, maxBpIdx }: VhDragPreviewProps = $props();

	const d = getDimensionContext();
	const { dimensions, getRowYByRowIdx, getXByBpIdx } = d;
	const { radius, sideLength } = dimensions;

	// Calculate the Y position for the target row
	const y = $derived(getRowYByRowIdx(targetRowIdx));

	// Draw a horizontal line at the target position
	// The line spans across the VH grid area
	const x_start = $derived(4 * radius); // Start at the VH circle position
	const x_end = $derived(getXByBpIdx(maxBpIdx)); // End at the max bp index

	// Line position: slightly above the target row to show where it will be inserted
	const line_y = $derived(y - sideLength - 12); // 4px above the grid

	const points = $derived([x_start, line_y, x_end, line_y]);
</script>

<!-- Visual cue showing where the VH will be positioned -->
<Circle
	x={2 * radius}
	{y}
	radius={radius + 4}
	fill="oklch(80% 0.1 200)"
	stroke="oklch(60% 0.2 200)"
	strokeWidth={3}
	opacity={0.5}
	listening={false}
	perfectDrawEnabled={false}
/>
<Line
	{points}
	stroke="oklch(64.6% 0.222 41.116)"
	strokeWidth={2}
	dash={[10, 5]}
	opacity={0.8}
	listening={false}
	perfectDrawEnabled={false}
/>
