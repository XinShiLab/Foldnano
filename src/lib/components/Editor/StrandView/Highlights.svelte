<script lang="ts">
	import { Group } from 'svelte-konva';
	import type { Part } from '../../../model/Part';
	import OligoSegment from './OligoSegment.svelte';
	import Crossover from './crossover';

	import { getDimensionContext } from './drawingContext';
	import type Oligo from '../../../model/Oligo';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';

	interface Props {
		part: Part;
		// activeAreaAround: { rowIdx: number; bpIdx: number };
	}

	let { part }: Props = $props();
	const d = getDimensionContext();
	const { dimensions } = d;

	// let highlightTypes  = getHighlightContext();
	const editorViewContext = getEditorViewContext();
	let highlightTypes = $derived(editorViewContext.strandViewContext.highlightContext);

	const isOligoHighlighted = (oligo: Oligo) => {
		if (highlightTypes.scaffold === true && oligo.isScaffold) return true;
		if (highlightTypes.circular_strand === true && oligo.isCircular) return true;
		if (highlightTypes.longer_than_90 === true && oligo.length > 90) return true;
		if (highlightTypes.shorter_than_15 === true && oligo.length < 15) return true;
		if (
			highlightTypes.modification_site === true &&
			Array.from(oligo.allEnds).some((end) => end.modification !== null)
		)
			return true;
		return false;
	};
</script>

<!-- @component
  Highlights
  Renders the routes (strands) on the StrandViewer according to the highLightContext
  This is a view-only component and does not handle any user interaction.
-->

<Group listening={false}>
	{#each part.oligos as oligo (oligo.id)}
		{#if isOligoHighlighted(oligo)}
			{#each oligo.segments as segment (segment.id)}
				{@const segmentRow = d.getDisplayRowForVh(segment.inVirtualHelix.id)}
				{#if segmentRow !== null}
					<OligoSegment
						id={segment.id}
						rowIdx={segmentRow}
						start={segment.fivePrime.index}
						end={segment.threePrime.index}
						marks={[segment.fivePrime.isFree, segment.threePrime.isFree]}
						color={oligo.color}
						opacity={0.4}
						strokeWidth={dimensions.strokeWidth * 6}
					/>
					{#if segment.threePrime.connectedEnd}
						{@const connectedEnd = segment.threePrime.connectedEnd}
						{@const connectedRow = d.getDisplayRowForVh(connectedEnd.segment.inVirtualHelix.id)}
						{#if connectedRow !== null}
							<Crossover
								id={`XOVER#${segment.id}#to#${connectedEnd.segment.id}`}
								isConstrained={segment.threePrime.isConstrained && connectedEnd.isConstrained}
								start={[segmentRow, segment.threePrime.index, segment.inStrandIndex]}
								end={[connectedRow, connectedEnd.index, connectedEnd.segment.inStrandIndex]}
								color={oligo.color}
								strokeWidth={dimensions.strokeWidth * 6}
								opacity={0.4}
							/>
						{/if}
					{/if}
				{/if}
			{/each}
		{/if}
	{/each}
</Group>
