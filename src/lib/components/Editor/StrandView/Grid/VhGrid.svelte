<script lang="ts">
	import { Line, Rect, Shape } from 'svelte-konva';
	import type VirtualHelix from '$lib/model/VirtualHelix';

	import type { Context } from 'konva/lib/Context';
	import type { Shape as KonvaShape } from 'konva/lib/Shape';
	import { stageViewRect } from '../renderWindow';
	import type { CrossoverSite } from '../../../../model/Part/Part.svelte';
	import { getDimensionContext } from '../drawingContext';

	import { canvasTheme } from '$lib/canvasEditor/theme.svelte';

	interface Props {
		vh: VirtualHelix;
		displayRow: number;
		subStepSize: number;
	}
	const { vh, displayRow, subStepSize }: Props = $props();

	const d = getDimensionContext();
	const { dimensions, getRowYByRowIdx, getXByBpIdx } = d;
	const { radius, sideLength, strokeWidth } = dimensions;

	let [, y] = $derived([2 * radius, getRowYByRowIdx(displayRow)]);
	let [x_grid, y_grid] = $derived([getXByBpIdx(0), y - sideLength]);

	export const isStartOfXover = (xoverInfo: CrossoverSite, strandSet: 0 | 1): boolean => {
		return (strandSet === 0) !== xoverInfo.right;
	};

	/** Below this many device pixels between base lines they merge into a grey band, so skip them. */
	const MIN_BP_LINE_SPACING_PX = 2.5;

	// Draw the vertical grid lines (thin per-bp + thick per-subStep) in one canvas pass, limited
	// at draw time to what the stage shows: this runs on every redraw of the layer, and an
	// unclipped pass costs VHs x length path calls.
	const drawGridLines = (ctx: Context, shape: KonvaShape, gridLineColor: string) => {
		const stage = shape.getStage();
		if (!stage) return;
		const view = stageViewRect(stage);
		const top = y_grid;
		const bottom = y_grid + 2 * sideLength;
		if (bottom < view.y || top > view.y + view.height) return;
		const firstBp = Math.max(0, Math.floor((view.x - x_grid) / sideLength));
		const lastBp = Math.min(vh.length, Math.ceil((view.x + view.width - x_grid) / sideLength));
		if (firstBp > lastBp) return;

		// Thin per-bp lines. The canvas transform includes the export pixel ratio, so an image
		// export of a zoomed-out view still gets them.
		const pxPerBp = sideLength * Math.abs(ctx._context.getTransform().a);
		if (pxPerBp >= MIN_BP_LINE_SPACING_PX) {
			ctx.beginPath();
			for (let i = firstBp; i <= lastBp; i++) {
				const x = x_grid + i * sideLength + 0.5; // crisp 1px vertical line
				ctx.moveTo(x, top);
				ctx.lineTo(x, bottom);
			}
			ctx.strokeStyle = gridLineColor;
			ctx.lineWidth = 1;
			ctx.stroke();
		}

		// Thick sub-step lines (every subStepSize)
		if (subStepSize > 0) {
			ctx.beginPath();
			const firstStep = Math.ceil(firstBp / subStepSize);
			const lastStep = Math.min(
				Math.floor(lastBp / subStepSize),
				Math.floor(vh.length / subStepSize) - 1
			);
			for (let idx = firstStep; idx <= lastStep; idx++) {
				const x = x_grid + idx * subStepSize * sideLength; // integer x for crisp 2px line
				ctx.moveTo(x, top);
				ctx.lineTo(x, bottom);
			}
			ctx.strokeStyle = gridLineColor;
			ctx.lineWidth = 2;
			ctx.stroke();
		}
	};

	let themeKey = $derived(canvasTheme.isDark ? 'dark' : 'light');
	let themeColors = $derived(canvasTheme.colors);
</script>

<!-- Draw circle and index for each virtual helix -->
<!-- <VhTag {vh}/> -->
<!-- <Group id="vh-circle-{vh.index}" kind="VH_TAG" category="VH" class="pickable">
	<Circle
		{x}
		{y}
		{radius}
		fill="oklch(95.4% 0.038 75.164)"
		stroke="oklch(66.6% 0.179 58.318)"
		{strokeWidth}
		perfectDrawEnabled={false}
	/>
	<Text
		x={x - radius / 2 - 1}
		y={y - radius / 2}
		text={vh.index.toString().padStart(2, '0')}
		fontSize={radius}
		fontStyle="bold"
		fill="oklch(37.3% 0.034 259.733)"
		align="center"
		verticalAlign="middle"
		perfectDrawEnabled={false}
	/>
</Group> -->

<!-- Draw grid for each base pair in the virtual helix -->

<!-- <BasepairGrid {rowIdx} {vhIdx} {bpIdx} /> -->
<Rect
	id="vh-grid-{vh.index}"
	kind="VH_GRID"
	category="VH"
	class="pickable"
	x={x_grid}
	y={y_grid}
	width={sideLength * vh.length}
	height={sideLength * 2}
	fill="transparent"
	stroke={themeColors.gridLine}
	{strokeWidth}
	perfectDrawEnabled={false}
/>
<Line
	points={[x_grid, y_grid + sideLength, x_grid + sideLength * vh.length, y_grid + sideLength]}
	stroke={themeColors.gridLine}
	{strokeWidth}
	perfectDrawEnabled={false}
/>

<!-- Replace many Lines with one Shape -->
<Shape
	key={themeKey}
	listening={false}
	perfectDrawEnabled={false}
	shadowForStrokeEnabled={false}
	sceneFunc={(ctx, shape) => {
		drawGridLines(ctx, shape, themeColors.gridLine);
	}}
/>
