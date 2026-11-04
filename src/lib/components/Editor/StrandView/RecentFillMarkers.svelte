<script lang="ts">
	import { Shape } from 'svelte-konva';
	import type { Context } from 'konva/lib/Context';
	import { getDimensionContext } from './drawingContext';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';

	const editorViewContext = getEditorViewContext();
	const d = getDimensionContext();
	const { sideLength } = d.dimensions;

	const FILL_COLOR = 'rgba(251, 191, 36, 0.45)';

	// Leaving Sequence mode ends the highlight for good, not just while away.
	$effect(() => {
		if (
			editorViewContext.editorMode !== 'SEQUENCE' &&
			editorViewContext.strandViewContext.recentFill
		) {
			editorViewContext.strandViewContext.recentFill = null;
		}
	});

	const cells = $derived.by(() => {
		const fill = editorViewContext.activeRecentFill;
		if (!fill) return [];
		const out: [number, number][] = [];
		for (const slot of fill.cells) {
			const row = d.getEffectiveDisplayRowForVh(slot.vhId);
			if (row === null || row.isCollapsed) continue;
			out.push(d.getBpCoordsByRowAndBpIdx(row.displayRow, slot.bpIndex)[slot.strandIdx]);
		}
		return out;
	});

	const drawCells = (ctx: Context, points: [number, number][]) => {
		ctx.fillStyle = FILL_COLOR;
		for (const [x, y] of points) ctx.fillRect(x, y, sideLength, sideLength);
	};
</script>

<!-- @component
  RecentFillMarkers
  Tints the grid cells whose nucleotides the last Sequence-tool "fill empty" assigned, on the
  filled strands and on opposite strands that received the complement. Shown until the next
  edit, undo or redo, or leaving Sequence mode (`EditorViewContext.activeRecentFill`). One Shape
  draws every cell because a whole-design fill can touch tens of thousands of them.
-->

{#if cells.length > 0}
	<Shape listening={false} perfectDrawEnabled={false} sceneFunc={(ctx) => drawCells(ctx, cells)} />
{/if}
