<script>
	import { Group, Line } from 'svelte-konva';
	import { getDimensionContext } from '../drawingContext';
	// import { dimensions } from '../utils';
	const { id, x, y, color, strokeWidth } = $props();
	const d = getDimensionContext();
	const { sideLength, strokeWidth: strokeWidth_default } = d.dimensions;
</script>

<Group {id}>
	<Line
		{id}
		points={[x, y, x + sideLength, y + sideLength]}
		width={sideLength}
		height={sideLength}
		stroke={color}
		lineCap="round"
		strokeWidth={strokeWidth ?? strokeWidth_default}
	/>
	<Line
		{id}
		points={[x + sideLength, y, x, y + sideLength]}
		width={sideLength}
		height={sideLength}
		stroke={color}
		lineCap="round"
		strokeWidth={strokeWidth ?? strokeWidth_default}
	/>
</Group>
