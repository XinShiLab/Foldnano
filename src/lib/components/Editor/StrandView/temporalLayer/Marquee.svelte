<script lang="ts">
	import { Rect } from 'svelte-konva';

	export interface MarqueeProps {
		x?: number;
		y?: number;
		width?: number;
		height?: number;
		visible?: boolean;
	}
	let { x = 0, y = 0, width = 0, height = 0, visible = false }: MarqueeProps = $props();
</script>

<Rect
	{x}
	{y}
	{width}
	{height}
	{visible}
	stroke="#3399ff"
	dash={[4, 3]}
	strokeWidth={1}
	fill="rgba(51,153,255,0.12)"
	listening={false}
/>
