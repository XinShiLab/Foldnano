<script lang="ts">
	import { Line } from 'svelte-konva';
	import { getDimensionContext } from '../drawingContext';
	// import { getBpCoordsByRowAndBpIdx, dimensions } from '../utils';
	interface Props {
		rowIdx: number;
		bpIdx: number;
		strandIdx: 0 | 1;
		isStart: boolean;
		strokeWidth?: number;
		color?: string;
		opacity?: number;
	}
	const {
		rowIdx,
		bpIdx,
		strandIdx: strand,
		isStart,
		strokeWidth = 2,
		color = 'red',
		opacity,
	}: Props = $props();

	const d = getDimensionContext();
	const { sideLength } = d.dimensions;
	const { getBpCoordsByRowAndBpIdx } = d;
	const l = sideLength / 2;
	const [x, y] = $derived(getBpCoordsByRowAndBpIdx(rowIdx, bpIdx)[strand]);

	const getPoints = (isStart: boolean, strand: 0 | 1): number[] => {
		const pointsVariants = [
			// start && strand 0
			[x + l, y, x + l, y + l, x, y + l],
			// end && strand 0
			[x + l, y, x + l, y + l, x + 2 * l, y + l],
			// start && strand 1
			[x + 2 * l, y + l, x + l, y + l, x + l, y + 2 * l],
			// end && strand 1
			[x, y + l, x + l, y + l, x + l, y + 2 * l],
		];
		const index = (isStart ? 0 : 1) + (strand === 0 ? 0 : 2);
		return pointsVariants[index];
	};

	const strokeColor = $derived(color ?? 'oklch(86.9% 0.022 252.894)');
</script>

<Line
	points={getPoints(isStart, strand)}
	stroke={strokeColor}
	{strokeWidth}
	lineCap="round"
	lineJoin="round"
	{opacity}
/>
