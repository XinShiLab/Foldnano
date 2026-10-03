<script lang="ts">
	import { Group } from 'svelte-konva';

	import InsertMark from './InsertMark.svelte';
	import { getDimensionContext } from '../drawingContext';
	import { getEditorViewContext } from '../../context/EditorViewContext.svelte';

	const editorViewContext = getEditorViewContext();

	interface Props {
		id: string;
		rowIdx: number;
		bpIdx: number;
		strandIdx: 0 | 1;
		count: number;
		sequence?: string;
		oligoId?: string;
		color?: string;
	}
	let { id, rowIdx, bpIdx, strandIdx, count, sequence, oligoId, color }: Props = $props();
	const d = getDimensionContext();
	const { dimensions, getBpCoordsByRowAndBpIdx } = d;
	const { strokeWidth } = dimensions;

	const [[x1, y1], [x2, y2]] = $derived(getBpCoordsByRowAndBpIdx(rowIdx, bpIdx));

	let bpEl = $state<Group>();

	// TODO: this should be moved to tool handler
	const hoverInHandler = () => {
		if (!bpEl) return;
		// console.log('hover in basepair:', vhIdx, bpIdx);
		const vh = d.getVisibleVhByDisplayRow(rowIdx);
		let note = vh ? `VH ${vh.index} - BP ${bpIdx}` : `${rowIdx}[${bpIdx}], insert`;
		if (oligoId) note += ` | Oligo ${oligoId.slice(0, 6)}`;
		if (sequence && sequence.length > 2 && !/^N+$/.test(sequence)) {
			note += ` | Insert sequence ${sequence}`;
		}
		editorViewContext.strandViewContext.footnote = note;
	};
	const hoverOutHandler = () => {
		if (!bpEl) return;
		editorViewContext.strandViewContext.footnote = 'nothing';
	};
</script>

<Group
	{id}
	bind:this={bpEl}
	onpointerover={(_e) => hoverInHandler()}
	onpointerout={(_e) => hoverOutHandler()}
>
	{#if strandIdx === 0}
		<InsertMark
			{id}
			x={x1 + dimensions.sideLength / 2}
			y={y1}
			{count}
			color={color ? color : 'red'}
			strokeWidth={strokeWidth * 1.5}
		/>
	{:else}
		<InsertMark
			{id}
			x={x2 + dimensions.sideLength / 2}
			y={y2}
			{count}
			isUp={false}
			color={color ? color : 'red'}
			strokeWidth={strokeWidth * 1.5}
		/>
	{/if}
</Group>
