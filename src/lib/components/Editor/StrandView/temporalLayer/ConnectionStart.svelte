<script lang="ts">
	import { Rect } from 'svelte-konva';
	import Terminus from '../Terminus.svelte';
	import CVTerminus from '../crossover/CVTerminus.svelte';
	import { getDimensionContext } from '../drawingContext';

	export interface ConnectionStartProps {
		rowIdx: number;
		bpIdx: number;
		strandSetIdx: 0 | 1;
	}
	let { rowIdx, bpIdx, strandSetIdx }: ConnectionStartProps = $props();

	const d = getDimensionContext();
	const { dimensions, getBpCoordsByRowAndBpIdx } = d;
	const [x, y] = getBpCoordsByRowAndBpIdx(rowIdx, bpIdx)[strandSetIdx];
</script>

<Rect
	x={strandSetIdx === 0 ? x : x - dimensions.sideLength}
	{y}
	width={dimensions.sideLength * 2}
	height={dimensions.sideLength}
	fill="white"
	stroke="black"
	opacity={1}
/>

<!-- <Terminus {x} {y} {strandSetIdx} isThreePrime={true} /> -->
<CVTerminus {rowIdx} {bpIdx} strandIdx={strandSetIdx} isStart={true} />
<Terminus
	x={strandSetIdx === 0 ? x + dimensions.sideLength * 1.5 : x - dimensions.sideLength * 0.5}
	y={y + dimensions.sideLength / 2}
	{strandSetIdx}
	isThreePrime={false}
/>
