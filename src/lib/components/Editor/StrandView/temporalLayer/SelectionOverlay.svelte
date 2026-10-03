<script lang="ts">
	import { Shape } from 'svelte-konva';
	import SelectedEndBox from './SelectedEndBox.svelte';
	import { getDimensionContext } from '../drawingContext';
	import type { EndSelection } from '../../context/EditorViewContext.svelte';
	import { bulgePoint, getAttachmentPoints, direction } from '../crossover/utils';
	import type { Context } from 'konva/lib/Context';

	function drawTerminus(
		ctx: Context,
		x: number,
		y: number,
		sl: number,
		strandIdx: 0 | 1,
		isStart: boolean
	) {
		const l = sl / 2;
		let pts: [number, number, number, number, number, number];
		if (isStart && strandIdx === 0) pts = [x + l, y, x + l, y + l, x, y + l];
		else if (!isStart && strandIdx === 0) pts = [x + l, y, x + l, y + l, x + 2 * l, y + l];
		else if (isStart && strandIdx === 1) pts = [x + 2 * l, y + l, x + l, y + l, x + l, y + 2 * l];
		else pts = [x, y + l, x + l, y + l, x + l, y + 2 * l];
		ctx.moveTo(pts[0], pts[1]);
		ctx.lineTo(pts[2], pts[3]);
		ctx.lineTo(pts[4], pts[5]);
	}

	let { selected }: { selected: EndSelection } = $props();
	const d = getDimensionContext();
	const { getBpCoordsByRowAndBpIdx, withOffset, dimensions } = d;
	const { sideLength, strokeWidth: baseStrokeWidth } = dimensions;
	const halfSide: [number, number] = [sideLength / 2, sideLength / 2];

	let ends = $derived(selected.ends);
	let freeEnds = $derived([...ends].filter((e) => e.isFree));

	// Returns a new draw function whenever selection size changes.
	// The returned closure iterates `ends` at draw time (always current state).
	const drawFn = $derived.by(() => {
		const _size = ends.size; // reactive dependency — recompute on any add/remove
		return (ctx: Context) => {
			if (_size === 0) return;

			ctx.save();
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';

			// Builds and begins the path for all fully-selected segments.
			const buildSegmentPath = () => {
				// eslint-disable-next-line svelte/prefer-svelte-reactivity
				const drawn = new Set<string>();
				ctx.beginPath();
				for (const end of ends) {
					const segment = end.segment;
					if (drawn.has(segment.id)) continue;
					if (!ends.has(segment.fivePrime) || !ends.has(segment.threePrime)) continue;
					const rowIdx = d.getDisplayRowForVh(segment.inVirtualHelix.id);
					if (rowIdx === null) continue;
					drawn.add(segment.id);
					const strandIdx = segment.inStrandIndex as 0 | 1;
					const [sx, sy] = withOffset(
						getBpCoordsByRowAndBpIdx(rowIdx, segment.fivePrime.index),
						halfSide
					)[strandIdx];
					const [ex, ey] = withOffset(
						getBpCoordsByRowAndBpIdx(rowIdx, segment.threePrime.index),
						halfSide
					)[strandIdx];
					ctx.moveTo(sx, sy);
					ctx.lineTo(ex, ey);
				}
			};

			// Builds and begins the path for all selected crossovers (arc + terminus hooks).
			const buildCrossoverPath = () => {
				// eslint-disable-next-line svelte/prefer-svelte-reactivity
				const drawn = new Set<string>();
				ctx.beginPath();
				for (const end of ends) {
					const connectedEnd = end.connectedEnd;
					if (!connectedEnd || !ends.has(connectedEnd)) continue;
					const xoverId = end.isThreePrime
						? `${end.segment.id}#${connectedEnd.segment.id}`
						: `${connectedEnd.segment.id}#${end.segment.id}`;
					if (drawn.has(xoverId)) continue;
					drawn.add(xoverId);

					const startEnd = end.isThreePrime ? end : connectedEnd;
					const endEnd = end.isThreePrime ? connectedEnd : end;
					const startRow = d.getDisplayRowForVh(startEnd.segment.inVirtualHelix.id);
					const endRow = d.getDisplayRowForVh(endEnd.segment.inVirtualHelix.id);
					if (startRow === null || endRow === null) continue;
					const sr = { ...startEnd.modelCoord, rowIdx: startRow };
					const er = { ...endEnd.modelCoord, rowIdx: endRow };

					const [x1o, y1o] = getBpCoordsByRowAndBpIdx(sr.rowIdx, sr.bpIdx)[sr.strandIdx];
					const [x1, y1] = getAttachmentPoints(x1o, y1o, sideLength, sr.strandIdx);
					const [x2o, y2o] = getBpCoordsByRowAndBpIdx(er.rowIdx, er.bpIdx)[er.strandIdx];
					const [x2, y2] = getAttachmentPoints(x2o, y2o, sideLength, er.strandIdx);
					const dir = direction(
						[sr.rowIdx, sr.bpIdx, sr.strandIdx],
						[er.rowIdx, er.bpIdx, er.strandIdx]
					);
					const [bpx, bpy] = bulgePoint(x1, y1, x2, y2, dir);

					// Match Konva Line tension=0.4: two quadratic bezier curves through bpx,bpy
					const dx = x2 - x1,
						dy = y2 - y1;
					ctx.moveTo(x1, y1);
					ctx.quadraticCurveTo(bpx - dx * 0.2, bpy - dy * 0.2, bpx, bpy);
					ctx.quadraticCurveTo(bpx + dx * 0.2, bpy + dy * 0.2, x2, y2);
					drawTerminus(ctx, x1o, y1o, sideLength, sr.strandIdx, true);
					drawTerminus(ctx, x2o, y2o, sideLength, er.strandIdx, false);
				}
			};

			// Wide semi-transparent gold halo only — the underlying strand color shows through.
			ctx.strokeStyle = 'rgba(255, 215, 0, 0.4)';
			ctx.lineWidth = baseStrokeWidth * 6;
			buildSegmentPath();
			ctx.stroke();
			buildCrossoverPath();
			ctx.stroke();

			ctx.restore();
		};
	});
</script>

<!--
  @component SelectionOverlay
  Draws all selected segments and crossovers as a single batched canvas Shape,
  avoiding per-segment Svelte component instantiation.
  Single pass per frame: a wide semi-transparent gold halo over selected segments
  and crossovers, leaving the underlying strand color intact.
  Free ends (termini) are still rendered as individual SelectedEndBox components
  since there are very few of them.
-->
{#if ends.size > 0}
	<Shape listening={false} perfectDrawEnabled={false} sceneFunc={drawFn} />
	{#each freeEnds as end (`${end.segment.id}-${end.isThreePrime ? '3' : '5'}`)}
		{@const rowIdx = d.getDisplayRowForVh(end.segment.inVirtualHelix.id)}
		{#if rowIdx !== null}
			<SelectedEndBox
				id={`SelectedEndBox-${end.segment.id}-${end.isThreePrime ? '3' : '5'}`}
				{rowIdx}
				fromBpIdx={end.index}
				strandIdx={end.segment.inStrandIndex as 0 | 1}
				isThreePrime={end.isThreePrime}
				isFreeEnd={true}
			/>
		{/if}
	{/each}
{/if}
