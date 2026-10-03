<script lang="ts">
	import CVTerminus from './CVTerminus.svelte';
	import CVLine from './CVLine.svelte';
	// import { dimensions } from '../utils';
	export interface CrossoverProps {
		id: string;
		start: [number, number, 0 | 1]; // row, bp, strand
		end: [number, number, 0 | 1];
		isSelected?: boolean;
		isConstrained?: boolean;
		color?: string;
		strokeWidth?: number;
		opacity?: number;
	}
	const {
		id,
		start,
		end,
		isSelected = false,
		isConstrained = false,
		color = 'red',
		strokeWidth = 2,
		opacity,
	}: CrossoverProps = $props();
</script>

<CVTerminus
	rowIdx={start[0]}
	bpIdx={start[1]}
	strandIdx={start[2]}
	isStart={true}
	{strokeWidth}
	color={isSelected ? 'red' : color}
	{opacity}
/>
<CVLine {id} {start} {end} {strokeWidth} {opacity} {isConstrained} {color} {isSelected} />

<CVTerminus
	rowIdx={end[0]}
	bpIdx={end[1]}
	strandIdx={end[2]}
	isStart={false}
	{strokeWidth}
	{opacity}
	color={isSelected ? 'red' : color}
/>
