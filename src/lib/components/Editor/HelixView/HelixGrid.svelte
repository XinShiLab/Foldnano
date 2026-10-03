<script lang="ts">
	import { Group } from 'svelte-konva';
	import { getCanvasPositionByIndex } from './utils';
	import HelixCircle from './HelixCircle.svelte';
	import type { Part } from '$lib/model/Part/Part.svelte';
	import { type LatticedDesignRegion } from '$lib/model/Part/DesignRegion';
	import { addNewVirtualHelixCmd } from '../../../commands/virtualHelix';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';

	interface Props {
		part: Part;
		region: LatticedDesignRegion;
		numOfCols: number;
		numOfRows: number;
		radius: number;
		strokeWidth: number;
		showCoords?: boolean;
	}

	const {
		part,
		region,
		numOfCols,
		numOfRows,
		radius,
		strokeWidth,
		showCoords = false,
	}: Props = $props();

	const latticeType = $derived(region.kind) as 'HONEYCOMB' | 'SQUARE';

	const editorViewContext = getEditorViewContext();
	let editorMode = $derived(editorViewContext.editorMode);
	let history = $derived(editorViewContext.historyStack);

	const circleClickHandler = (colIndex: number, rowIndex: number) => {
		if (editorMode === 'DRAW') {
			addNewVirtualHelixCmd({ part, region, col: colIndex, row: rowIndex }, history);
		}
	};
</script>

<Group>
	{#each Array(numOfCols) as _, colIndex (colIndex)}
		{#each Array(numOfRows) as _, rowIndex (rowIndex)}
			{@const { x, y } = getCanvasPositionByIndex(
				colIndex,
				rowIndex,
				radius,
				strokeWidth,
				latticeType
			)}
			<HelixCircle
				{x}
				{y}
				{radius}
				{strokeWidth}
				text={showCoords ? `${colIndex}, ${rowIndex}` : null}
				clickHandler={() => circleClickHandler(colIndex, rowIndex)}
				listening={editorMode === 'DRAW'}
			/>
		{/each}
	{/each}
</Group>
