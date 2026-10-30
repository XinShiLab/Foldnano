<script lang="ts">
	import { Group, Circle, Text } from 'svelte-konva';
	import type VirtualHelix from '$lib/model/VirtualHelix';

	import { getDimensionContext } from '../drawingContext';
	import { canvasTheme } from '$lib/canvasEditor/theme.svelte';
	import { getEditorViewContext } from '../../context/EditorViewContext.svelte';

	interface Props {
		vh: VirtualHelix;
		displayRow: number;
	}
	const { vh, displayRow }: Props = $props();

	const d = getDimensionContext();
	const { dimensions, getRowYByRowIdx } = d;
	const { radius, strokeWidth } = dimensions;

	const editorViewContext = getEditorViewContext();

	let [x, y] = $derived([2 * radius, getRowYByRowIdx(displayRow)]);
	const selected = $derived(
		!!vh.localFrame && editorViewContext.selectedFreeformVhIndices.has(vh.index)
	);
</script>

<Group id="VH_TAG#{vh.index}" kind="VH_TAG" category="VH" class="pickable" listening={true}>
	<Circle
		id="VH_TAG#{vh.index}"
		{x}
		{y}
		{radius}
		fill={canvasTheme.colors.vhFill}
		stroke={selected ? canvasTheme.colors.freeformDragColor : canvasTheme.colors.vhStroke}
		strokeWidth={selected ? 2 * strokeWidth : strokeWidth}
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
