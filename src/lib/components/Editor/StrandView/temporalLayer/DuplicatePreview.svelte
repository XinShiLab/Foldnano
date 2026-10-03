<script lang="ts">
	import { Group, Line, Text } from 'svelte-konva';
	import OligoSegment from '../OligoSegment.svelte';
	import { getDimensionContext } from '../drawingContext';
	import { getEditorViewContext } from '../../context/EditorViewContext.svelte';
	import type { SegmentEnd } from '$lib/model/Oligo';

	const INVALID_COLOR = 'red';

	const editorViewContext = getEditorViewContext();
	const d = getDimensionContext();
	const { sideLength } = d.dimensions;

	const state = $derived(editorViewContext.strandViewContext.duplicateState);

	const rowOf = (vhId: string): number | null => {
		const r = d.getEffectiveDisplayRowForVh(vhId);
		return r && !r.isCollapsed ? r.displayRow : null;
	};

	const centerOf = (end: SegmentEnd, delta: number): [number, number] | null => {
		const row = rowOf(end.inVirtualHelix.id);
		if (row === null) return null;
		const [x, y] = d.getBpCoordsByRowAndBpIdx(row, end.index + delta)[end.inStrandIndex];
		return [x + sideLength / 2, y + sideLength / 2];
	};

	const segments = $derived(
		state
			? state.oligos.flatMap((oligo) =>
					[...oligo.segments].flatMap((seg) => {
						const row = rowOf(seg.inVirtualHelix.id);
						return row === null ? [] : [{ seg, row, color: oligo.color }];
					})
				)
			: []
	);

	const crossovers = $derived(
		state
			? segments.flatMap(({ seg }) => {
					const to = seg.threePrime.connectedEnd;
					if (!to) return [];
					const a = centerOf(seg.threePrime, state.delta);
					const b = centerOf(to, state.delta);
					return a && b ? [[...a, ...b]] : [];
				})
			: []
	);

	const label = $derived.by(() => {
		if (!state || segments.length === 0) return null;
		const first = segments[0];
		const [x, y] = d.getBpCoordsByRowAndBpIdx(first.row, first.seg.lowIndex + state.delta)[0];
		const offset = `${state.linked ? 'Mirror ' : ''}${state.delta > 0 ? '+' : ''}${state.delta} bp`;
		return {
			x,
			y: y - sideLength * 1.5,
			text: state.check.ok ? offset : `${offset}: ${state.check.reason}`,
		};
	});
</script>

<!-- @component
  DuplicatePreview
  Ghost of the copies being placed in DUPLICATE mode: every source segment and crossover
  shifted by `duplicateState.delta`, in the oligo color (red when the offset is invalid,
  dashed for mirror copies), with the offset and any rejection reason as a label.
-->

{#if state}
	{@const invalid = !state.check.ok}
	<Group listening={false} opacity={0.55}>
		{#each segments as { seg, row, color } (seg.id)}
			<OligoSegment
				rowIdx={row}
				start={seg.fivePrime.index + state.delta}
				end={seg.threePrime.index + state.delta}
				strandSetIdxIfEqual={seg.inStrandIndex}
				color={invalid ? INVALID_COLOR : color}
				strokeWidth={3}
				dash={state.linked ? [6, 4] : undefined}
				listening={false}
			/>
		{/each}
		{#each crossovers as points, i (i)}
			<Line
				{points}
				stroke={invalid ? INVALID_COLOR : '#666'}
				strokeWidth={2}
				dash={[4, 3]}
				listening={false}
			/>
		{/each}
	</Group>
	{#if label}
		<Text
			x={label.x}
			y={label.y}
			text={label.text}
			fontSize={11}
			fill={invalid ? INVALID_COLOR : '#555'}
			listening={false}
		/>
	{/if}
{/if}
