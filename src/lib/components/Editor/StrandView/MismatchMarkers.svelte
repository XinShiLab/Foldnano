<script lang="ts">
	import { Group, Line } from 'svelte-konva';
	import type { Part } from '../../../model/Part';
	import { getDimensionContext } from './drawingContext';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import type OligoSegment from '../../../model/Oligo/OligoSegment.svelte';

	interface Props {
		part: Part;
	}

	let { part }: Props = $props();

	const editorViewContext = getEditorViewContext();
	const d = getDimensionContext();
	const { dimensions, getBpCoordsByRowAndBpIdx } = d;
	const { sideLength, strokeWidth } = dimensions;

	const MISMATCH_COLOR = 'red';

	// mismatchedBps() finds the opposite strand through the non-reactive spatial index, so read
	// that strand's occupancy and extents too: a strand placed or moved opposite an unchanged
	// segment (e.g. a new mirror copy) then re-runs just the segments on that helix.
	const trackedMismatchedBps = (segment: OligoSegment): number[] => {
		const opposite = segment.inVirtualHelix.strandSets[1 - segment.inStrandIndex];
		for (const id of opposite.segmentIds) {
			const other = part.getSegmentById(id);
			void other?.fivePrime.index;
			void other?.threePrime.index;
		}
		return segment.mismatchedBps();
	};
</script>

<!-- @component
  MismatchMarkers
  Flags base pairs whose assigned sequence no longer matches its complementary strand
  (e.g. after a translate carried sequence to a position whose partner didn't move), by
  drawing a short red rung connecting the two strands' grid boxes at that bp — distinct
  from Skip's red-X glyph so the two aren't confused. Mounted below StrandRoutes (in the
  same non-interactive layer) so sequence letters stay legible on top of the rung.
-->

{#if editorViewContext.strandViewContext.warningContext.mismatch}
	<Group listening={false}>
		{#each part.oligos as oligo (oligo.id)}
			{#each oligo.segments as segment (segment.id)}
				{#if segment.inStrandIndex === 0}
					{@const segmentResult = d.getEffectiveDisplayRowForVh(segment.inVirtualHelix.id)}
					{#if segmentResult !== null && !segmentResult.isCollapsed}
						{@const segmentRow = segmentResult.displayRow}
						{#each trackedMismatchedBps(segment) as bpIdx (`${segment.id}#mismatch#${bpIdx}`)}
							{@const [c1, c2] = getBpCoordsByRowAndBpIdx(segmentRow, bpIdx)}
							<Line
								id={`MISMATCH#${segment.id}#at#${bpIdx}`}
								points={[
									c1[0] + sideLength / 2,
									c1[1] + sideLength / 2,
									c2[0] + sideLength / 2,
									c2[1] + sideLength / 2,
								]}
								stroke={MISMATCH_COLOR}
								strokeWidth={strokeWidth * 2}
								lineCap="round"
							/>
						{/each}
					{/if}
				{/if}
			{/each}
		{/each}
	</Group>
{/if}
