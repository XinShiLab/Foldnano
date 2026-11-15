<script lang="ts">
	import { Group, Line, Text, Shape, Circle } from 'svelte-konva';
	import Terminus from './Terminus.svelte';
	import { getDimensionContext } from './drawingContext';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	// import Insert from './Insert';
	// import Skip from './Skip';
	import OligoSegment from '$lib/model/Oligo/OligoSegment.svelte';
	import { rectsIntersect } from '$lib/utils/utils';
	import { untrack } from 'svelte';
	import { stageViewRect } from './renderWindow';
	import type { Context } from 'konva/lib/Context';
	import type { Shape as KonvaShape } from 'konva/lib/Shape';
	import { getModificationColor, truncateModificationName } from '$lib/model/modifications';
	import type { TemporalPartInfo } from '../context/types';
	import { canvasTheme } from '$lib/canvasEditor/theme.svelte';

	const MOD_DOT_RADIUS = 3;
	const ALL_N = /^N+$/;

	export interface OligoSegmentProps {
		id: string;
		/** The owning oligo's colour, passed by the caller that already holds the oligo. */
		color?: string;
		opacity?: number;
		strokeWidth?: number;
		isSelected?: boolean;
	}

	const editorViewContext = getEditorViewContext();
	const foldnanoDoc = $derived(editorViewContext.currentDoc);

	let el = $state<Line>();

	let {
		id,
		color: colorProp,
		opacity = 1,
		strokeWidth = 2,
		isSelected = false,
	}: OligoSegmentProps = $props();

	const segmentToRender = $derived.by(() => {
		if (!foldnanoDoc) return null;
		const part = foldnanoDoc.parts[0];
		if (!part) return null;
		const oligoSegment = part.getSegmentById(id);
		return oligoSegment;
	});

	const d = getDimensionContext();
	const { sideLength } = d.dimensions;
	const { getBpCoordsByRowAndBpIdx, withOffset } = d;

	let strandIdx = $derived(segmentToRender?.inStrandIndex ?? 0);
	let rowIdx = $derived(
		segmentToRender ? d.getDisplayRowForVh(segmentToRender.inVirtualHelix.id) : null
	);
	let start = $derived(segmentToRender?.fivePrime.index ?? 0);
	let end = $derived(segmentToRender?.threePrime.index ?? 0);
	let color = $derived(colorProp ?? segmentToRender?.oligo?.color ?? 'red');
	let marks = $derived([
		segmentToRender?.fivePrime.isFree ?? false,
		segmentToRender?.threePrime.isFree ?? false,
	]);
	// let sequence = $derived(segmentToRender?.sequence ?? '');

	const offset: [number, number] = [sideLength / 2, sideLength / 2];

	const start_bp = $derived(
		rowIdx === null ? null : withOffset(getBpCoordsByRowAndBpIdx(rowIdx, start), offset)
	);
	const end_bp = $derived(
		rowIdx === null ? null : withOffset(getBpCoordsByRowAndBpIdx(rowIdx, end), offset)
	);
	const points_line = $derived(
		start_bp && end_bp ? [start_bp[strandIdx], end_bp[strandIdx]].flat() : []
	);

	const clickRect = $derived({
		x:
			start_bp && end_bp
				? Math.min(start_bp[strandIdx][0], end_bp[strandIdx][0]) - sideLength / 2
				: 0,
		y:
			start_bp && end_bp
				? Math.min(start_bp[strandIdx][1], end_bp[strandIdx][1]) - sideLength / 2
				: 0,
		width:
			start_bp && end_bp ? Math.abs(end_bp[strandIdx][0] - start_bp[strandIdx][0]) + sideLength : 0,
		height: start_bp && end_bp ? sideLength : 0,
	});

	// The render window and the zoom flag change rarely, so a pan or zoom step re-evaluates
	// nothing here; the sequence Shape narrows to the exact viewport when it draws.
	const isInRenderWindow = $derived(
		rectsIntersect(clickRect, editorViewContext.strandViewContext.renderBounds)
	);
	const showDetail = $derived(isInRenderWindow && editorViewContext.strandViewContext.isDetailZoom);

	// While a crossover-connect drag is in progress, dim any modification badge that
	// sits exactly at the candidate drop target — connecting there will drop it.
	const connectingTarget = $derived.by(() => {
		const temp = editorViewContext.strandViewContext.tempParts.find(
			(p): p is Extract<TemporalPartInfo, { type: 'Connecting' }> => p.type === 'Connecting'
		);
		return temp?.props.end ?? null;
	});
	const isConnectTargetAt = (bpIdx: number): boolean =>
		rowIdx !== null &&
		connectingTarget !== null &&
		connectingTarget[0] === rowIdx &&
		connectingTarget[1] === bpIdx &&
		connectingTarget[2] === strandIdx;

	// $inspect('viewport scale', editorViewContext.strandViewContext.viewportScale);

	// // TODO: dealing with hover globally instead of here later.
	// let isHovered = $state(false);
	// const onMouseEnterHandler = (e: KonvaMouseEvent) => {
	// 	isHovered = true;
	// };
	// const onMouseLeaveHandler = (e: KonvaMouseEvent) => {
	// 	isHovered = false;
	// };

	// One signal per segment (`seqVersion`) plus the slot count, not a subscription per base.
	const sequenceKey = $derived(
		segmentToRender ? `${segmentToRender.seqVersion}:${segmentToRender.slots.length}` : ''
	);

	const hasRenderableSequence = $derived.by(() => {
		void sequenceKey;
		const segment = segmentToRender;
		if (!segment) return false;
		return untrack(() => segment.slots.some((s) => s.seq.length > 0 && !ALL_N.test(s.seq)));
	});

	// Custom shape function to batch-render all sequence text in a single canvas pass
	const drawSequenceText = (ctx: Context, shape: KonvaShape, segmentToRender: OligoSegment) => {
		const stage = shape.getStage();
		if (!segmentToRender || rowIdx === null || !stage) return;
		const view = stageViewRect(stage);
		const xMin = view.x - sideLength;
		const xMax = view.x + view.width + sideLength;
		const y = getBpCoordsByRowAndBpIdx(rowIdx, 0)[strandIdx][1] + offset[1] + 1;
		const { seqInsertText, seqText } = canvasTheme.colors;

		ctx.save();
		ctx.textAlign = 'center';
		ctx.textBaseline = 'top';
		// Set once: assigning `font` per letter is slow in Firefox and Safari.
		ctx.font = '5px sans-serif';

		for (const slot of segmentToRender.slots) {
			const x = d.getXByBpIdx(slot.bpIndex) + offset[0];
			if (x < xMin || x > xMax) continue;
			const slotSeq = slot.seq;
			if (slotSeq.length === 0 || ALL_N.test(slotSeq)) continue;
			const isInsert = slotSeq.length > 1;

			const charToShow =
				slotSeq.length > 2
					? String(slotSeq.length)
					: isInsert && strandIdx === 1
						? slotSeq.split('').reverse().join('')
						: slotSeq;

			ctx.fillStyle = isInsert ? seqInsertText : seqText;
			ctx.fillText(charToShow, x, y);
		}

		ctx.restore();
	};
</script>

<!-- @component
  OligoSegment
  Renders a single oligo segment on the StrandViewer
  It should be only used for segments that is already in the Part model.
  It handles the display of sequences and insert/skip markers.
  (the other OligoSegment component is a more generic one that does not know about the Part model)
  This is a view-only component, and should not listen to any user interaction events directly,
-->

{#if segmentToRender && rowIdx !== null && start_bp && end_bp}
	<!-- Cull via Konva `visible` (a canvas attr), NOT `{#if}`: toggling mount/unmount on
	     pan/zoom churns svelte-konva's DOM anchor nodes, and Firefox burns ~40% of CPU in
	     RestyleManager reflowing them. `visible` skips draw without touching the DOM. -->
	<Group
		visible={isInRenderWindow}
		perfectDrawEnabled={false}
		listening={false}
		id={`OLIGO-SEGMENT-GROUP#${id}`}
	>
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
		/>

		{#if marks[0]}
			<Terminus
				x={points_line[0]}
				y={points_line[1]}
				strandSetIdx={strandIdx}
				isThreePrime={false}
				color={isSelected ? 'red' : color}
				{opacity}
			/>
			{#if segmentToRender.fivePrime.modification}
				{@const modColor = getModificationColor(
					segmentToRender.fivePrime.modification,
					segmentToRender.inPart.customModifications
				)}
				{@const dimmed = isConnectTargetAt(start)}
				<Circle
					x={points_line[0]}
					y={strandIdx === 0 ? points_line[1] - 14 : points_line[1] + 6}
					radius={MOD_DOT_RADIUS}
					fill={modColor}
					opacity={dimmed ? 0.35 : 1}
					visible={!showDetail}
					listening={false}
				/>
				<Text
					x={points_line[0] - 5}
					y={strandIdx === 0 ? points_line[1] - 14 : points_line[1] + 6}
					text={`• ${truncateModificationName(segmentToRender.fivePrime.modification)}`}
					fontSize={7}
					fill={modColor}
					opacity={dimmed ? 0.35 : 1}
					visible={showDetail}
					listening={false}
				/>
			{/if}
		{/if}

		{#if marks[1]}
			<Terminus
				x={end_bp[strandIdx][0]}
				y={end_bp[strandIdx][1]}
				strandSetIdx={strandIdx}
				isThreePrime={true}
				color={isSelected ? 'red' : color}
				{opacity}
			/>
			{#if segmentToRender.threePrime.modification}
				{@const modColor = getModificationColor(
					segmentToRender.threePrime.modification,
					segmentToRender.inPart.customModifications
				)}
				{@const dimmed = isConnectTargetAt(end)}
				<Circle
					x={end_bp[strandIdx][0]}
					y={strandIdx === 0 ? end_bp[strandIdx][1] - 14 : end_bp[strandIdx][1] + 6}
					radius={MOD_DOT_RADIUS}
					fill={modColor}
					opacity={dimmed ? 0.35 : 1}
					visible={!showDetail}
					listening={false}
				/>
				<Text
					x={end_bp[strandIdx][0] - 5}
					y={strandIdx === 0 ? end_bp[strandIdx][1] - 14 : end_bp[strandIdx][1] + 6}
					text={`• ${truncateModificationName(segmentToRender.threePrime.modification)}`}
					fontSize={7}
					fill={modColor}
					opacity={dimmed ? 0.35 : 1}
					visible={showDetail}
					listening={false}
				/>
			{/if}
		{/if}

		{#if hasRenderableSequence}
			<!-- Batch render all sequence text in a single Shape for performance. Viewport
			     gating is on `visible` (canvas attr), not `{#if}`, to avoid DOM churn on
			     pan/zoom — see the Group note above. -->
			<!-- `redrawKey` is not a Konva attr; changing it is what makes the layer redraw. -->
			<Shape
				visible={showDetail && !editorViewContext.strandViewContext.hideContext.sequence}
				redrawKey={`${sequenceKey}|${canvasTheme.isDark}`}
				listening={false}
				perfectDrawEnabled={false}
				shadowForStrokeEnabled={false}
				sceneFunc={(ctx, shape) => {
					drawSequenceText(ctx, shape, segmentToRender);
				}}
			/>
		{/if}

		<!-- {#each segmentToRender.skipsAndInserts as skipOrInsert (`${segmentToRender.id}#at#${skipOrInsert[0]}`)}
			{#if skipOrInsert[1] > 0}
        <Insert
          id={`INSERT#${segmentToRender.id}#at#${skipOrInsert[0]}`}
          rowIdx={segmentToRender.inVirtualHelix.listRow}
          bpIdx={skipOrInsert[0]}
          strandIdx={segmentToRender.inStrandIndex}
          {color}
        />
			{:else}
				<Skip
					id={`SKIP#${segmentToRender.id}#at#${skipOrInsert[0]}`}
					rowIdx={segmentToRender.inVirtualHelix.listRow}
					bpIdx={skipOrInsert[0]}
					strandIdx={segmentToRender.inStrandIndex}
				/>
			{/if}
		{/each} -->
	</Group>
{/if}
