<script lang="ts">
	import { Shape } from 'svelte-konva';
	import type { Context } from 'konva/lib/Context';
	import { expandRect } from '$lib/utils/utils';
	import { getEditorViewContext } from '../../context/EditorViewContext.svelte';
	import { getDimensionContext } from '../drawingContext';
	import {
		CONNECTION_LABEL_FONT_SIZE,
		type ConnectionMark,
		type ConnectionMarksByRow,
	} from './connectionMarks';

	interface Props {
		marks: ConnectionMarksByRow;
	}

	let { marks }: Props = $props();

	const LABEL_ZOOM_THRESHOLD = 0.8;
	const ARROW_SIZE = 2.5;

	const d = getDimensionContext();
	const strandCtx = getEditorViewContext().strandViewContext;

	function drawArrow(ctx: Context, mark: ConnectionMark) {
		const { stemX, edgeY, elbowY, tipX, side, isThreePrime } = mark;
		ctx.moveTo(stemX, edgeY);
		ctx.lineTo(stemX, elbowY);
		ctx.lineTo(tipX, elbowY);
		if (isThreePrime) {
			// Outgoing: the head points away, toward the label.
			ctx.moveTo(tipX - side * ARROW_SIZE, elbowY - ARROW_SIZE);
			ctx.lineTo(tipX, elbowY);
			ctx.lineTo(tipX - side * ARROW_SIZE, elbowY + ARROW_SIZE);
		} else {
			// Incoming: the head points into the strand.
			const back = mark.strandIdx === 0 ? -ARROW_SIZE : ARROW_SIZE;
			ctx.moveTo(stemX - ARROW_SIZE, edgeY + back);
			ctx.lineTo(stemX, edgeY);
			ctx.lineTo(stemX + ARROW_SIZE, edgeY + back);
		}
	}

	const drawFn = $derived.by(() => {
		const scale = strandCtx.viewportScale;
		const bounds = expandRect(strandCtx.viewportBounds, 200 / Math.max(scale, 0.1));
		const firstRow = d.getRowIdxByY(bounds.y);
		const lastRow = d.getRowIdxByY(bounds.y + bounds.height) + 1;
		const showLabels = scale > LABEL_ZOOM_THRESHOLD;
		const rows = marks;

		return (ctx: Context) => {
			ctx.save();
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';
			ctx.lineWidth = 1.25;
			ctx.font = `bold ${CONNECTION_LABEL_FONT_SIZE}px Arial`;
			ctx.textBaseline = 'middle';
			for (let row = firstRow; row <= lastRow; row++) {
				for (const mark of rows.get(row) ?? []) {
					if (mark.labelBox.x1 < bounds.x || mark.labelBox.x0 > bounds.x + bounds.width) continue;
					ctx.globalAlpha = mark.opacity;
					ctx.strokeStyle = mark.color;
					ctx.beginPath();
					drawArrow(ctx, mark);
					ctx.stroke();
					if (showLabels) {
						ctx.fillStyle = mark.color;
						ctx.textAlign = mark.side > 0 ? 'left' : 'right';
						ctx.fillText(mark.label, mark.labelX, mark.elbowY);
					}
				}
			}
			ctx.restore();
		};
	});
</script>

<!-- @component
  ConnectionMarks
  One batched Shape standing in for the crossover arcs while they are hidden: an arrow and a
  VH[bp] label at each crossover end. A design can have thousands, too many for per-mark nodes.
  Not listening; StrandViewer resolves hover and clicks with hitConnectionMark.
-->
<Shape listening={false} perfectDrawEnabled={false} sceneFunc={drawFn} />
