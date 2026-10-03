<script lang="ts">
	// Start is the 5' end, end is the 3' end
	import { Rect, Line } from 'svelte-konva';
	import { getDimensionContext } from './drawingContext';
	// import { dimensions } from './utils';

	interface Props {
		id?: string;
		x: number;
		y: number;
		strandSetIdx: 0 | 1;
		isThreePrime: boolean;
		listening?: boolean;
		color?: string;
		opacity?: number;
	}

	let {
		id,
		x,
		y,
		strandSetIdx,
		isThreePrime,
		listening = true,
		color = 'red',
		opacity = 1,
	}: Props = $props();
	const d = getDimensionContext();

	const { strokeWidth: strokeWidth_default } = d.dimensions;

	const three_direction = $derived(strandSetIdx === 0 ? 'RIGHT' : 'LEFT');

	const getTrianglePoints = (
		x: number,
		y: number,
		size: number,
		direction: 'RIGHT' | 'LEFT' = 'RIGHT'
	): number[] => {
		if (direction === 'RIGHT') {
			return [x + size / 2 + 1, y, x - size / 2 + 1, y - size / 2, x - size / 2 + 1, y + size / 2];
		} else {
			return [x - size / 2 - 1, y, x + size / 2 - 1, y - size / 2, x + size / 2 - 1, y + size / 2];
		}
	};
	let points_triangle = $derived(getTrianglePoints(x, y, strokeWidth_default * 8, three_direction));
</script>

{#if !isThreePrime}
	<Rect
		{id}
		{x}
		{y}
		offsetX={(strokeWidth_default * 6) / 2}
		offsetY={(strokeWidth_default * 6) / 2}
		width={strokeWidth_default * 6}
		height={strokeWidth_default * 6}
		fill={color}
		{opacity}
		{listening}
	/>
{:else}
	<Line points={points_triangle} fill={color} closed {listening} z-index={600} {opacity} />
{/if}
