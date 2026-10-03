<script lang="ts">
	import { Group } from 'svelte-konva';
	import VhGrid from './VhGrid.svelte';
	import type { Part } from '$lib/model/Part';
	import { getDimensionContext } from '../drawingContext';

	export interface HighlightXover {
		vhIdx: number;
		bpIdx: number;
		strandIndex: 0 | 1;
	}

	interface Props {
		part: Part;
	}

	let { part }: Props = $props();
	const d = getDimensionContext();
</script>

<Group listening={false}>
	{#each d.getVisibleVhRows() as row (row.vh.id)}
		<VhGrid
			vh={row.vh}
			displayRow={row.displayRow}
			subStepSize={(row.vh.regionId ? part.getRegionById(row.vh.regionId)?.subStepSize : null) ??
				part.subStepSize}
		/>
	{/each}
</Group>
