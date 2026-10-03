<script lang="ts">
	import { Group } from 'svelte-konva';
	import X from './X.svelte';
	import { getDimensionContext } from '../drawingContext';
	import { getEditorViewContext } from '../../context/EditorViewContext.svelte';

	// let footnoteContext = getFootnoteContext();
	const editorViewContext = getEditorViewContext();

	interface Props {
		id: string;
		rowIdx: number;
		bpIdx: number;
		strandIdx: 0 | 1;
	}
	let { id, rowIdx, bpIdx, strandIdx }: Props = $props();
	const d = getDimensionContext();
	const { dimensions, getBpCoordsByRowAndBpIdx } = d;
	const [[x1, y1], [x2, y2]] = $derived(getBpCoordsByRowAndBpIdx(rowIdx, bpIdx));

	const { strokeWidth } = dimensions;

	let bpEl = $state<Group>();

	const hoverInHandler = () => {
		if (!bpEl) return;
		// console.log('hover in basepair:', vhIdx, bpIdx);
		const note = `${rowIdx}[${bpIdx}], skip`;
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
		<X {id} x={x1} y={y1} color="red" strokeWidth={strokeWidth * 1.5} />
	{:else}
		<X {id} x={x2} y={y2} color="red" strokeWidth={strokeWidth * 1.5} />
	{/if}
</Group>
