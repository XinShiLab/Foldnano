<script lang="ts">
	import { Group, Line, Text } from 'svelte-konva';
	import type { Part } from '../../../model/Part';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import Crossover from './crossover';
	import { MIRROR_OPACITY } from './drawingContext';
	import CrossRegionArrow from './crossover/CrossRegionArrow.svelte';
	import Insert from './Insert/Insert.svelte';
	import Skip from './Skip/Skip.svelte';
	import VhTag from './Grid/VhTag.svelte';
	import RegionHeader from './Grid/RegionHeader.svelte';
	import { getDimensionContext } from './drawingContext';
	import { rectsIntersect, expandRect } from '$lib/utils/utils';

	interface Props {
		part: Part;
	}

	let { part }: Props = $props();

	const editorViewContext = getEditorViewContext();
	let hideTypes = $derived(editorViewContext.strandViewContext.hideContext);

	const d = getDimensionContext();
	const { getBpCoordsByRowAndBpIdx } = d;
	const { sideLength } = d.dimensions;

	const overscanPx = $derived(
		200 / Math.max(editorViewContext.strandViewContext.viewportScale, 0.1)
	);
	const renderBounds = $derived(
		expandRect(editorViewContext.strandViewContext.viewportBounds, overscanPx)
	);
</script>

<!-- @component
  CrossoverRoutes
  Renders the crossover, skips, delete markers on the StrandViewer
  This also listens for user interactions on these elements, as their locations are outside the data model. 
  Their identity is stored in their ids, which can be processed by the hit-testing system.
-->

<!-- Crossover arcs and skips/inserts render BELOW region headers in z-order -->
<Group>
	{#each part.oligos as oligo (oligo.id)}
		{#each oligo.segments as segment (segment.id)}
			{@const segmentResult = d.getEffectiveDisplayRowForVh(segment.inVirtualHelix.id)}

			<!-- Outgoing 3' connection -->
			{#if segment.threePrime.connectedEnd && !hideTypes.crossovers && segmentResult !== null && !segmentResult.isCollapsed}
				{@const connectedEnd = segment.threePrime.connectedEnd}
				{@const connectedResult = d.getEffectiveDisplayRowForVh(
					connectedEnd.segment.inVirtualHelix.id
				)}
				{#if connectedResult !== null}
					{#if !connectedResult.isCollapsed}
						<!-- Both visible: full crossover arc -->
						{@const segmentRow = segmentResult.displayRow}
						{@const connectedRow = connectedResult.displayRow}
						{@const sc = getBpCoordsByRowAndBpIdx(segmentRow, segment.threePrime.index)[
							segment.inStrandIndex
						]}
						{@const ec = getBpCoordsByRowAndBpIdx(connectedRow, connectedEnd.index)[
							connectedEnd.segment.inStrandIndex
						]}
						{@const xMin = Math.min(sc[0], ec[0]) - sideLength}
						{@const yMin = Math.min(sc[1], ec[1]) - sideLength}
						{@const xoverRect = {
							x: xMin,
							y: yMin,
							width: Math.abs(ec[0] - sc[0]) + 2 * sideLength,
							height: Math.abs(ec[1] - sc[1]) + 2 * sideLength,
						}}
						<!-- Viewport culling via Konva `visible` (canvas attr), not `{#if}`, so
						     panning doesn't mount/unmount DOM anchor nodes (Firefox restyle storm). -->
						<Group visible={rectsIntersect(xoverRect, renderBounds)}>
							<Crossover
								id={`XOVER#${segment.id}#to#${connectedEnd.segment.id}`}
								isConstrained={segment.threePrime.isConstrained && connectedEnd.isConstrained}
								start={[segmentRow, segment.threePrime.index, segment.inStrandIndex]}
								end={[connectedRow, connectedEnd.index, connectedEnd.segment.inStrandIndex]}
								color={oligo.color}
								opacity={oligo.isMirror ? MIRROR_OPACITY : undefined}
								strokeWidth={2}
							/>
						</Group>
					{:else}
						<!-- Target collapsed: arrow indicator at 3' end -->
						{@const targetRegionId = connectedEnd.segment.inVirtualHelix.regionId ?? ''}
						{@const targetRegionNumber = part.regions.findIndex((r) => r.id === targetRegionId) + 1}
						<CrossRegionArrow
							rowIdx={segmentResult.displayRow}
							bpIdx={segment.threePrime.index}
							strandIdx={segment.inStrandIndex}
							regionNumber={targetRegionNumber}
							endType="threePrime"
							color={oligo.color}
							strokeWidth={2}
						/>
					{/if}
				{/if}
			{/if}

			<!-- Incoming 5' connection from a collapsed source region -->
			{#if !segment.fivePrime.isFree && !hideTypes.crossovers && segmentResult !== null && !segmentResult.isCollapsed}
				{@const sourceEnd = segment.fivePrime.connectedEnd}
				{#if sourceEnd}
					{@const sourceResult = d.getEffectiveDisplayRowForVh(sourceEnd.segment.inVirtualHelix.id)}
					{#if sourceResult !== null && sourceResult.isCollapsed}
						{@const sourceRegionId = sourceEnd.segment.inVirtualHelix.regionId ?? ''}
						{@const sourceRegionNumber = part.regions.findIndex((r) => r.id === sourceRegionId) + 1}
						<CrossRegionArrow
							rowIdx={segmentResult.displayRow}
							bpIdx={segment.fivePrime.index}
							strandIdx={segment.inStrandIndex}
							regionNumber={sourceRegionNumber}
							endType="fivePrime"
							color={oligo.color}
							strokeWidth={2}
						/>
					{/if}
				{/if}
			{/if}

			{#if segmentResult !== null && !segmentResult.isCollapsed}
				{@const segmentRow = segmentResult.displayRow}
				{#each segment.skipsAndInserts as skipOrInsert (`${segment.id}#at#${skipOrInsert[0]}`)}
					{@const cellCoords = getBpCoordsByRowAndBpIdx(segmentRow, skipOrInsert[0])[
						segment.inStrandIndex
					]}
					{@const cellRect = {
						x: cellCoords[0] - sideLength,
						y: cellCoords[1] - sideLength,
						width: 2 * sideLength,
						height: 2 * sideLength,
					}}
					<Group visible={rectsIntersect(cellRect, renderBounds)}>
						{#if skipOrInsert[1] > 0}
							<Insert
								id={`INSERT#${segment.id}#at#${skipOrInsert[0]}`}
								rowIdx={segmentRow}
								bpIdx={skipOrInsert[0]}
								strandIdx={segment.inStrandIndex}
								count={skipOrInsert[1]}
								sequence={segment.slotForBp(skipOrInsert[0])?.seq}
								oligoId={oligo.id}
								color={oligo.color}
							/>
						{:else}
							<Skip
								id={`SKIP#${segment.id}#at#${skipOrInsert[0]}`}
								rowIdx={segmentRow}
								bpIdx={skipOrInsert[0]}
								strandIdx={segment.inStrandIndex}
							/>
						{/if}
					</Group>
				{/each}
			{/if}
		{/each}
	{/each}
</Group>

<!-- Region headers and VhTags render ABOVE crossover arcs in z-order -->
<Group>
	{#each d.getVisibleStrandRows() as row (`${row.kind}-${row.displayRow}`)}
		{#if row.kind === 'REGION_HEADER'}
			<RegionHeader {row} maxBpIdx={part.maxBase} {part} />
		{:else}
			<VhTag vh={row.vh} displayRow={row.displayRow} />
		{/if}
	{/each}
</Group>

<!-- Split region preview overlay -->
{#if editorViewContext.strandViewContext.splitPreviewState}
	{@const preview = editorViewContext.strandViewContext.splitPreviewState}
	{@const gapY =
		(d.getRowYByRowIdx(preview.gapDisplayRow) + d.getRowYByRowIdx(preview.gapDisplayRow + 1)) / 2}
	{@const vb = editorViewContext.strandViewContext.viewportBounds}
	{@const lineX1 = vb.x - 200}
	{@const lineX2 = vb.x + vb.width + 200}
	<Group>
		<Line
			points={[lineX1, gapY, lineX2, gapY]}
			stroke="#d4af37"
			strokeWidth={1.5}
			dash={[8, 5]}
			listening={false}
		/>
		<Text
			x={lineX2 - 260}
			y={gapY + 4}
			text={`→ New: ${preview.newRegionName}`}
			fontSize={11}
			fill="#d4af37"
			listening={false}
		/>
	</Group>
{/if}
