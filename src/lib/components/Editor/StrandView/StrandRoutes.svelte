<script lang="ts">
	import type { Part } from '../../../model/Part';
	// import { dimensions, getBpCoordsByRowAndBpIdx } from './utils';
	import OligoSegmentInPart from './OligoSegmentInPart.svelte';
	import { getDimensionContext, MIRROR_OPACITY } from './drawingContext';

	interface Props {
		part: Part;
		// activeAreaAround: { rowIdx: number; bpIdx: number };
	}

	let { part }: Props = $props();
	const d = getDimensionContext();
	const { dimensions } = d;
</script>

<!-- @component
  StrandRoutes
  Renders the routes (strands) on the StrandViewer
  This is a view-only component and does not handle any user interaction.
  Grid is mounted separately by the caller (below this) so this draws sequence
  letters on top of both the grid and the mismatch-marker rungs.
-->
{#each part.oligos as oligo (oligo.id)}
	{#each oligo.segments as segment (segment.id)}
		<!-- <OligoSegment
			id={segment.id}
			rowIdx={segment.inVirtualHelix.listRow}
			start={segment.fivePrime.index}
			end={segment.threePrime.index}
			marks={[segment.fivePrime.isFree, segment.threePrime.isFree]}
      sequence={segment.sequence}
			color={oligo.color}
			opacity={1}
			strokeWidth={dimensions.strokeWidth * 2}
		/> -->
		<OligoSegmentInPart
			id={segment.id}
			opacity={oligo.isMirror ? MIRROR_OPACITY : 1}
			strokeWidth={dimensions.strokeWidth * 2}
		/>
	{/each}
{/each}
