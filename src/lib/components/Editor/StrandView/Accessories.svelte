<script lang="ts">
	import { Group, Line, Text } from 'svelte-konva';
	import type { Part } from '../../../model/Part';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import Crossover from './crossover';
	import { MIRROR_OPACITY } from './drawingContext';
	import CrossRegionArrow from './crossover/CrossRegionArrow.svelte';
	import { isCrossoverHidden } from './crossover/connectionMarks';
	import Insert from './Insert/Insert.svelte';
	import Skip from './Skip/Skip.svelte';
	import VhTag from './Grid/VhTag.svelte';
	import RegionHeader from './Grid/RegionHeader.svelte';
	import { getDimensionContext } from './drawingContext';
	import { rectsIntersect } from '$lib/utils/utils';

	interface Props {
		part: Part;
	}

	let { part }: Props = $props();

	const editorViewContext = getEditorViewContext();
	let hideTypes = $derived(editorViewContext.strandViewContext.hideContext);

	const d = getDimensionContext();
	const { getBpCoordsByRowAndBpIdx } = d;
	const { sideLength } = d.dimensions;

	const renderBounds = $derived(editorViewContext.strandViewContext.renderBounds);

	const SPLIT_OK_COLOR = '#d4af37';
	const SPLIT_BLOCKED_COLOR = '#e5484d';
	const splitPreview = $derived(editorViewContext.strandViewContext.splitPreviewState);

	/** Vertical cut line spanning the region's visible helices, plus the strands blocking it. */
	const bpCutLine = $derived.by(() => {
		if (splitPreview?.kind !== 'bp') return null;
		const rows = d
			.getVisibleStrandRows()
			.filter((row) => row.kind === 'VH' && row.regionId === splitPreview.regionId)
			.map((row) => row.displayRow);
		if (rows.length === 0) return null;
		const blocking = splitPreview.blockingSegmentIds.flatMap((id) => {
			const segment = part.getSegmentById(id);
			const row = segment ? d.getDisplayRowForVh(segment.inVirtualHelix.id) : null;
			if (!segment || row === null) return [];
			const y = d.getRowYByRowIdx(row);
			return segment.inStrandIndex === 0
				? [{ y1: y - sideLength, y2: y }]
				: [{ y1: y, y2: y + sideLength }];
		});
		const step = part.getRegionById(splitPreview.regionId)?.step ?? 0;
		return {
			x: d.getXByBpIdx(splitPreview.cut),
			onStepBoundary: step > 0 && splitPreview.cut % step === 0,
			y1: d.getRowYByRowIdx(Math.min(...rows)) - sideLength - 8,
			y2: d.getRowYByRowIdx(Math.max(...rows)) + sideLength + 8,
			blocking,
		};
	});
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
			{#if segment.threePrime.connectedEnd && !isCrossoverHidden(hideTypes, segment.threePrime, segment.threePrime.connectedEnd) && segmentResult !== null && !segmentResult.isCollapsed}
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
			{#if !segment.fivePrime.isFree && segmentResult !== null && !segmentResult.isCollapsed}
				{@const sourceEnd = segment.fivePrime.connectedEnd}
				{#if sourceEnd && !isCrossoverHidden(hideTypes, segment.fivePrime, sourceEnd)}
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
			<RegionHeader {row} {part} />
		{:else}
			<VhTag vh={row.vh} displayRow={row.displayRow} />
		{/if}
	{/each}
</Group>

<!-- Split region preview overlay -->
{#if splitPreview?.kind === 'rows'}
	{@const gapY =
		(d.getRowYByRowIdx(splitPreview.gapDisplayRow) +
			d.getRowYByRowIdx(splitPreview.gapDisplayRow + 1)) /
		2}
	{@const vb = editorViewContext.strandViewContext.viewportBounds}
	{@const lineX1 = vb.x - 200}
	{@const lineX2 = vb.x + vb.width + 200}
	<Group>
		<Line
			points={[lineX1, gapY, lineX2, gapY]}
			stroke={SPLIT_OK_COLOR}
			strokeWidth={1.5}
			dash={[8, 5]}
			listening={false}
		/>
		<Text
			x={lineX2 - 260}
			y={gapY + 4}
			text={`→ New: ${splitPreview.newRegionName}`}
			fontSize={11}
			fill={SPLIT_OK_COLOR}
			listening={false}
		/>
	</Group>
{:else if splitPreview?.kind === 'bp' && bpCutLine}
	{@const color = splitPreview.ok ? SPLIT_OK_COLOR : SPLIT_BLOCKED_COLOR}
	<Group>
		<Line
			points={[bpCutLine.x, bpCutLine.y1, bpCutLine.x, bpCutLine.y2]}
			stroke={color}
			strokeWidth={bpCutLine.onStepBoundary ? 3 : 1.5}
			dash={bpCutLine.onStepBoundary ? undefined : [8, 5]}
			listening={false}
		/>
		{#each bpCutLine.blocking as band, i (i)}
			<Line
				points={[bpCutLine.x, band.y1, bpCutLine.x, band.y2]}
				stroke={SPLIT_BLOCKED_COLOR}
				strokeWidth={4}
				listening={false}
			/>
		{/each}
		<Text
			x={bpCutLine.x + 6}
			y={bpCutLine.y1 - 14}
			text={(bpCutLine.onStepBoundary ? `Step boundary (bp ${splitPreview.cut}) · ` : '') +
				(splitPreview.ok
					? `→ New: ${splitPreview.newRegionName}` +
						(splitPreview.shift > 0 ? ` (renumbered from bp ${splitPreview.shift})` : '')
					: splitPreview.reason)}
			fontSize={11}
			fill={color}
			listening={false}
		/>
	</Group>
{/if}
