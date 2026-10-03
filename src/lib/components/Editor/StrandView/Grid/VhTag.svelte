<script lang="ts">
	import { Group, Circle, Text } from 'svelte-konva';
	import type VirtualHelix from '$lib/model/VirtualHelix';

	import { getDimensionContext } from '../drawingContext';
	import { canvasTheme } from '$lib/canvasEditor/theme.svelte';

	interface Props {
		vh: VirtualHelix;
		displayRow: number;
	}
	const { vh, displayRow }: Props = $props();

	const d = getDimensionContext();
	const { dimensions, getRowYByRowIdx } = d;
	const { radius, strokeWidth } = dimensions;

	let [x, y] = $derived([2 * radius, getRowYByRowIdx(displayRow)]);
</script>

<Group id="VH_TAG#{vh.index}" kind="VH_TAG" category="VH" class="pickable" listening={true}>
	<Circle
		id="VH_TAG#{vh.index}"
		{x}
		{y}
		{radius}
		fill={canvasTheme.colors.vhFill}
		stroke={canvasTheme.colors.vhStroke}
		{strokeWidth}
		perfectDrawEnabled={false}
	/>
	<Text
		id="VH_TAG#{vh.index}"
		x={x - radius / 2 - 1}
		y={y - radius / 2}
		text={vh.index.toString().padStart(2, '0')}
		fontSize={radius}
		fontStyle="bold"
		fill={canvasTheme.colors.vhText}
		align="center"
		verticalAlign="middle"
		perfectDrawEnabled={false}
	/>
</Group>
