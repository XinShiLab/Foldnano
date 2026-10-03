<script lang="ts">
	import { Line } from 'svelte-konva';
	import { bulgePoint, direction, directionByX, getAttachmentPoints } from '../crossover/utils';
	import ConnectionStart from './ConnectionStart.svelte';
	import ConnectionEnd from './ConnectionEnd.svelte';
	import { getDimensionContext } from '../drawingContext';

	export interface ConnectionInProgressProps {
		start: [number, number, 0 | 1]; // row, bp, strand
		waypoint: [number, number]; // x, y
		end?: [number, number, 0 | 1] | null;
	}
	const { start, waypoint, end }: ConnectionInProgressProps = $props();

	const d = getDimensionContext();
	const { sideLength } = d.dimensions;
	const { getBpCoordsByRowAndBpIdx } = d;

	// const strokeColor = 'oklch(86.9% 0.022 252.894)';

	const [x1_o, y1_o] = getBpCoordsByRowAndBpIdx(start[0], start[1])[start[2]];
	const [x1, y1] = getAttachmentPoints(x1_o, y1_o, sideLength, start[2]);

	let [x2, y2] = $derived.by(() => {
		if (end) {
			const [x2_o, y2_o] = getBpCoordsByRowAndBpIdx(end[0], end[1])[end[2]];
			return getAttachmentPoints(x2_o, y2_o, sideLength, end[2] as 0 | 1);
		} else {
			return waypoint;
		}
	});

	let [bpx, bpy] = $derived.by(() => {
		if (end) {
			const [x2_o, y2_o] = getBpCoordsByRowAndBpIdx(end[0], end[1])[end[2]];
			const [x2, y2] = getAttachmentPoints(x2_o, y2_o, sideLength, end[2] as 0 | 1);
			return bulgePoint(x1, y1, x2, y2, direction(start, end));
		} else {
			return bulgePoint(x1, y1, waypoint[0], waypoint[1], directionByX(x1, waypoint[0], start[2]));
		}
	});
	// rowIdx={start[0]}
	// bpIdx={start[1]}
	// strandSetIdx={start[2]}
	// isThreePrime={true}
</script>

<!-- <CIPTerminus/> -->
<ConnectionStart rowIdx={start[0]} bpIdx={start[1]} strandSetIdx={start[2]} />

<!-- draw line in both cases to make sure the line is drawn the last, so show in front (not covered by the End mark) -->
{#if end}
	<ConnectionEnd rowIdx={end[0]} bpIdx={end[1]} strandSetIdx={end[2]} />
	<Line
		points={[x1, y1, bpx, bpy, x2, y2]}
		strokeWidth={2}
		lineCap="round"
		lineJoin="round"
		tension={0.4}
		stroke="red"
	/>
{:else}
	<Line
		points={[x1, y1, bpx, bpy, x2, y2]}
		strokeWidth={2}
		lineCap="round"
		lineJoin="round"
		tension={0.4}
		stroke="red"
	/>
{/if}
