<script lang="ts">
	import { Group } from 'svelte-konva';
	import Terminus from '../Terminus.svelte';
	import CVTerminus from '../crossover/CVTerminus.svelte';
	import { getDimensionContext } from '../drawingContext';

	export interface SelectedEndBoxProps {
		id: string;
		rowIdx: number;
		fromBpIdx: number;
		strandIdx: 0 | 1;
		isFreeEnd: boolean;
		isThreePrime?: boolean;
	}

	let {
		id,
		rowIdx,
		fromBpIdx,
		strandIdx,
		isFreeEnd,
		isThreePrime = false,
	}: SelectedEndBoxProps = $props();
	const d = getDimensionContext();
	const { dimensions, getBpCoordsByRowAndBpIdx, withOffset } = d;

	const [x_o, y_o] = $derived(
		withOffset(getBpCoordsByRowAndBpIdx(rowIdx, fromBpIdx), [
			dimensions.sideLength / 2,
			dimensions.sideLength / 2,
		])[strandIdx]
	);
</script>

<Group {id}>
	{#if isFreeEnd}
		<Terminus x={x_o} y={y_o} strandSetIdx={strandIdx} {isThreePrime} color="red" />
	{:else}
		<CVTerminus {rowIdx} bpIdx={fromBpIdx} {strandIdx} isStart={isThreePrime} color="red" />
	{/if}
</Group>
