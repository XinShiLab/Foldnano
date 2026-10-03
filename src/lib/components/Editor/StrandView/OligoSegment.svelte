<script lang="ts">
	import { Group, Line, Text } from 'svelte-konva';
	import Terminus from './Terminus.svelte';
	import { getDimensionContext } from './drawingContext';
	export interface OligoSegmentProps {
		id?: string;
		rowIdx: number;
		start: number;
		end: number;
		sequence?: string;
		strandSetIdxIfEqual?: 0 | 1; // only effective if start == end
		color?: string;
		opacity?: number;
		strokeWidth?: number;
		marks?: [boolean, boolean];
		isSelected?: boolean;
		listening?: boolean;
		dash?: number[];
	}

	let el = $state<Line>();
	let {
		id,
		rowIdx,
		start,
		end,
		sequence = '',
		listening = true,
		color = 'red',
		opacity = 1,
		strandSetIdxIfEqual = 0,
		strokeWidth = 2,
		marks = [true, true],
		isSelected = false,
		dash,
	}: OligoSegmentProps = $props();
	let strandIdx = $derived(end === start ? strandSetIdxIfEqual : end > start ? 0 : 1);
	// $inspect(sequence, 'sequence in OligoSegment');

	const d = getDimensionContext();
	const { sideLength } = d.dimensions;
	const { getBpCoordsByRowAndBpIdx, withOffset } = d;

	const offset: [number, number] = [sideLength / 2, sideLength / 2];

	const start_bp = $derived(withOffset(getBpCoordsByRowAndBpIdx(rowIdx, start), offset));
	const end_bp = $derived(withOffset(getBpCoordsByRowAndBpIdx(rowIdx, end), offset));
	const points_line = $derived([start_bp[strandIdx], end_bp[strandIdx]].flat());

	// const breakOligo = (rowIdx: number, strandIdx: 0 | 1, bpIndex: number) => {
	// 	const { oligo, segment } =
	// 		foldnanoDoc.parts[0].getOligoByIndices(rowIdx, strandIdx, bpIndex) || {};
	// 	console.log('Breaking oligo:', { oligo, strandIdx, segment, rowIdx, bpIndex });
	// 	if (!oligo || !segment) {
	// 		console.log('No oligo or segment found at the specified indices.');
	// 		return;
	// 	}
	// 	foldnanoDoc.parts[0].breakOligoAt(oligo, segment, bpIndex);
	// 	console.log('oligo broken!!');
	// };
</script>

<Group>
	<Line
		{id}
		kind="SEGMENT-line"
		category="STAP"
		bind:this={el}
		points={points_line}
		stroke={isSelected ? 'red' : color}
		lineCap="round"
		lineJoin="round"
		{opacity}
		{strokeWidth}
		{dash}
	/>

	{#if marks[0]}
		<Terminus
			x={points_line[0]}
			y={points_line[1]}
			strandSetIdx={strandIdx}
			isThreePrime={false}
			color={isSelected ? 'red' : color}
			{opacity}
			{listening}
		/>
	{/if}

	{#if marks[1]}
		<Terminus
			x={end_bp[strandIdx][0]}
			y={end_bp[strandIdx][1]}
			strandSetIdx={strandIdx}
			isThreePrime={true}
			color={isSelected ? 'red' : color}
			{opacity}
			{listening}
		/>
	{/if}

	{#if sequence.length > 0}
		{@const sequenceArray = sequence.split('')}
		{#each sequenceArray as nucleotide, index (index)}
			{@const t = start < end ? index : -index}
			{@const bpIndex = start + t}
			{@const [x_nuc, y_nuc] = withOffset(getBpCoordsByRowAndBpIdx(rowIdx, bpIndex), offset)[
				strandIdx
			]}
			<!-- <Circle
        x={x_nuc}
        y={y_nuc + sideLength / 2}
        radius={sideLength / 4}
        fill={isSelected? 'pink' : 'white'}
        stroke={isSelected? 'red' : 'black'}
        strokeWidth={1}
        opacity={0.8}
        pointerEvents="none"
        ></Circle> -->
			<Text
				x={x_nuc - 1}
				y={y_nuc + 1}
				text={nucleotide}
				fontSize={5}
				opacity={0.7}
				textAnchor="middle"
				pointerEvents="none"
			></Text>
		{/each}
	{/if}
</Group>
