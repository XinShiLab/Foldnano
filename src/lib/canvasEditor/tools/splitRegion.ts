import type { Tool, PointerEvt } from './index';
import type { ViewContext } from '$lib/canvasEditor/core/views';
import { splitRegionCmd } from '$lib/commands/regions';
import type { VisibleStrandRow } from '$lib/components/Editor/StrandView/strandRowLayout';

function findSplitGap(
	worldY: number,
	rows: VisibleStrandRow[],
	getRowY: (row: number) => number
): { gapAfterVhId: string; regionId: string; gapDisplayRow: number } | null {
	const snapPx = 20;
	let best: { dist: number; gapAfterVhId: string; regionId: string; gapDisplayRow: number } | null =
		null;

	for (let i = 0; i < rows.length - 1; i++) {
		const rowA = rows[i];
		const rowB = rows[i + 1];
		if (rowA.kind !== 'VH' || rowB.kind !== 'VH') continue;
		if (rowA.regionId !== rowB.regionId) continue;

		const gapY = (getRowY(rowA.displayRow) + getRowY(rowB.displayRow)) / 2;
		const dist = Math.abs(worldY - gapY);
		if (dist < snapPx && (!best || dist < best.dist)) {
			best = {
				dist,
				gapAfterVhId: rowA.vh.id,
				regionId: rowA.regionId,
				gapDisplayRow: rowA.displayRow,
			};
		}
	}

	return best
		? {
				gapAfterVhId: best.gapAfterVhId,
				regionId: best.regionId,
				gapDisplayRow: best.gapDisplayRow,
			}
		: null;
}

export function SplitRegionTool(): Tool {
	return {
		name: 'SPLIT_REGION',

		onEnter(ctx: ViewContext) {
			ctx.editorCtx.strandViewContext.splitPreviewState = null;
		},

		onExit(ctx: ViewContext) {
			ctx.editorCtx.strandViewContext.splitPreviewState = null;
		},

		onPointer(evt: PointerEvt, ctx: ViewContext) {
			const world = ctx.camera.toWorld(evt.clientX, evt.clientY);

			if (evt.type === 'move') {
				const rows = ctx.drawingDimensions.getVisibleStrandRows();
				const gap = findSplitGap(world.y, rows, (row) =>
					ctx.drawingDimensions.getRowYByRowIdx(row)
				);

				if (gap) {
					const region = ctx.part.getRegionById(gap.regionId);
					const newRegionName = region ? ctx.part.nextRegionName(region.kind) : '';
					ctx.editorCtx.strandViewContext.splitPreviewState = {
						...gap,
						newRegionName,
					};
				} else {
					ctx.editorCtx.strandViewContext.splitPreviewState = null;
				}
				return;
			}

			if (evt.type === 'down' && evt.button === 0) {
				const preview = ctx.editorCtx.strandViewContext.splitPreviewState;
				if (!preview) return;

				splitRegionCmd(ctx.history, ctx.part, preview.regionId, preview.gapAfterVhId);
				ctx.editorCtx.strandViewContext.splitPreviewState = null;
				ctx.editorCtx.editorMode = 'SELECT';
			}
		},

		onKey(e: KeyboardEvent, ctx: ViewContext) {
			if (e.key === 'Escape') {
				ctx.editorCtx.strandViewContext.splitPreviewState = null;
				ctx.editorCtx.editorMode = 'SELECT';
			}
		},
	};
}
