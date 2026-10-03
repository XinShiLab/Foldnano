<script lang="ts">
	import { Group, Line, Text } from 'svelte-konva';
	import { getDimensionContext } from '../drawingContext';

	interface Props {
		id: string;
		x: number;
		y: number;
		count: number;
		isUp?: boolean;
		color?: string;
		strokeWidth?: number;
	}

	const { id, x, y, count, isUp = true, color, strokeWidth }: Props = $props();
	const d = getDimensionContext();
	const { dimensions } = d;
	const { sideLength, strokeWidth: strokeWidth_default } = dimensions;
	const textCenterY = $derived(isUp ? y - sideLength / 6 : y + sideLength);
	const points = $derived(
		isUp
			? [
					x,
					y + sideLength / 2,
					x - sideLength / 2,
					y - sideLength / 2,
					x + sideLength / 2,
					y - sideLength / 2,
				]
			: [
					x,
					y + sideLength / 2,
					x - sideLength / 2,
					y + 1.5 * sideLength,
					x + sideLength / 2,
					y + 1.5 * sideLength,
				]
	);
</script>

<Group>
	<Line
		{id}
		{points}
		width={sideLength}
		height={sideLength}
		stroke={color}
		lineCap="round"
		closed
		tension={0.5}
		strokeWidth={strokeWidth ?? strokeWidth_default}
	/>
	<Text
		{id}
		x={x - sideLength / 2}
		y={textCenterY - sideLength / 2}
		width={sideLength}
		height={sideLength}
		text={String(count)}
		fontSize={sideLength / 1.8}
		fontStyle="bold"
		fill={color}
		align="center"
		verticalAlign="middle"
	/>
</Group>
