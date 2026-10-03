<script lang="ts">
	import { Circle, Line, type KonvaMouseEvent } from 'svelte-konva';
	// import { getBpCoordsByRowAndBpIdx, dimensions } from '../utils';
	import { bulgePoint, getAttachmentPoints } from './utils';
	import { getDimensionContext } from '../drawingContext';
	interface Props {
		id: string;
		start: [number, number, 0 | 1]; // row, bp, strand
		end: [number, number, 0 | 1];
		strokeWidth?: number;
		color?: string;
		opacity?: number;
		isConstrained?: boolean;
		isSelected?: boolean;
	}

	const {
		id,
		start,
		end,
		strokeWidth = 2,
		opacity,
		color = 'red',
		isConstrained = false,
		isSelected = false,
	}: Props = $props();
	const d = getDimensionContext();

	const { sideLength, strokeWidth: defaultStrokeWidth } = d.dimensions;
	const { getBpCoordsByRowAndBpIdx } = d;

	const strokeColor = $derived(color ?? 'oklch(86.9% 0.022 252.894)');

	// const getAttachmentPoints = (x: number, y: number, strand: 0 | 1): [number, number] => {
	// 	//  strand 0
	// 	if (strand === 0) return [x + l, y];
	// 	//  strand 1
	// 	return [x + l, y + 2 * l];
	// };

	const [x1_o, y1_o] = $derived(getBpCoordsByRowAndBpIdx(start[0], start[1])[start[2]]);
	const [x1, y1] = $derived(getAttachmentPoints(x1_o, y1_o, sideLength, start[2]));
	const [x2_o, y2_o] = $derived(getBpCoordsByRowAndBpIdx(end[0], end[1])[end[2]]);
	const [x2, y2] = $derived(getAttachmentPoints(x2_o, y2_o, sideLength, end[2]));
	const direction = $derived((start: [number, number, number], end: [number, number, number]) => {
		if (start[2] === 0 && end[0] <= start[0]) return -1;
		if (start[2] === 1 && end[0] >= start[0]) return -1;
		else return 1;
	});
	const [bpx, bpy] = $derived(bulgePoint(x1, y1, x2, y2, direction(start, end)));

	let isHovered = $state();
	const onmouseoverLine = (_e: KonvaMouseEvent) => {
		isHovered = true;
		// if (!isConstrained) {
		//   const container = _e.target.getStage()?.container();
		//   if (container) {
		//     console.log('not allowed cursor on crossover line');
		//     container.style.cursor = 'not-allowed';
		//   }
		// }
	};
	const onmouseleaveLine = (_e: KonvaMouseEvent) => {
		isHovered = false;
		// const container = _e.target.getStage()?.container();
		// if (container) {
		//   container.style.cursor = 'default';
		// }
	};
</script>

<Line
	{id}
	points={[x1, y1, bpx, bpy, x2, y2]}
	stroke={strokeColor}
	{strokeWidth}
	opacity={opacity ? opacity : isConstrained || isSelected ? 1 : 0.5}
	lineCap="round"
	lineJoin="round"
	tension={0.4}
/>

<Line
	{id}
	points={[x1, y1, bpx, bpy, x2, y2]}
	stroke={isHovered ? strokeColor : 'transparent'}
	strokeWidth={8}
	opacity={0.2}
	lineCap="round"
	lineJoin="round"
	tension={0.4}
	onmouseover={onmouseoverLine}
	onmouseleave={onmouseleaveLine}
/>
{#if isConstrained}
	<Circle
		x={bpx}
		y={bpy}
		radius={defaultStrokeWidth * 1.6}
		fill="white"
		stroke={strokeColor}
		strokeWidth={defaultStrokeWidth}
	/>
	<Circle x={bpx} y={bpy} radius={defaultStrokeWidth * 0.3} fill={strokeColor} strokeWidth={0} />
{/if}
<!-- 
{#if isHovered}
<Rect
  x={Math.min(x1, x2) - sideLength / 2}
  y={Math.min(y1, y2) }
  width={sideLength}
  height={Math.abs(y2 - y1)}
  fill={color}
  opacity={0.5}
  />
{/if} -->
