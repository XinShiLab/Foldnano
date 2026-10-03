<script lang="ts">
	import { Rect } from 'svelte-konva';
	import Terminus from '../Terminus.svelte';
	import { getDimensionContext } from '../drawingContext';

	export interface MoveEndBoxProps {
		id: string;
		rowIdx: number;
		fromBpIdx: number;
		toBpIdx: number;
		strandIdx: 0 | 1;
		isThreePrime?: boolean;
	}

	let {
		id,
		rowIdx,
		fromBpIdx,
		toBpIdx,
		strandIdx,
		isThreePrime = false,
	}: MoveEndBoxProps = $props();

	const d = getDimensionContext();
	const { dimensions, getBpCoordsByRowAndBpIdx, withOffset } = d;

	const [x_o, y_o] = $derived(
		withOffset(getBpCoordsByRowAndBpIdx(rowIdx, fromBpIdx), [
			dimensions.sideLength / 2,
			dimensions.sideLength / 2,
		])[strandIdx]
	);
	const [x_t, y_t] = $derived(
		withOffset(getBpCoordsByRowAndBpIdx(rowIdx, toBpIdx), [
			dimensions.sideLength / 2,
			dimensions.sideLength / 2,
		])[strandIdx]
	);
</script>

<Terminus
	id={id + '_origin'}
	x={x_o}
	y={y_o}
	strandSetIdx={strandIdx}
	{isThreePrime}
	color="blue"
/>

<Rect
	id={id + '_to'}
	x={x_t - dimensions.sideLength / 2}
	y={y_t - dimensions.sideLength / 2}
	width={dimensions.sideLength}
	height={dimensions.sideLength}
	fill="transparent"
	stroke="blue"
/>
