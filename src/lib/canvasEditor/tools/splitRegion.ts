import type { Tool, PointerEvt } from './index';
import type { ViewContext } from '$lib/canvasEditor/core/views';
import { splitRegionAtBpCmd, splitRegionCmd } from '$lib/commands/regions';
import type { VisibleStrandRow } from '$lib/components/Editor/StrandView/strandRowLayout';
import type { SplitPreview } from '$lib/components/Editor/context/EditorViewContext.svelte';
import { analyzeBpSplit } from '$lib/model/Part/splitRegionAtBp';
import { notify } from '$lib/notifications/notify.svelte';
import { EditorError } from '$lib/errors';

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

/** On a helix's strands: a cut along the helix axis at the nearest bp boundary. The previous
 * preview is reused while the pointer stays on the same column. */
function bpCutPreview(
	world: { x: number; y: number },
	ctx: ViewContext,
	previous: SplitPreview | null
): SplitPreview | null {
	const d = ctx.drawingDimensions;
	const hit = d.getHitGridByXY(world.x, world.y);
	if (!hit) return null;
	const row = d.getRowAtDisplayRow(hit.rowIdx);
	if (row?.kind !== 'VH') return null;
	const region = ctx.part.getRegionById(row.regionId);
	if (!region) return null;
	const { radius, sideLength } = d.dimensions;
	const cut = Math.round((world.x - 4 * radius) / sideLength);
	if (cut <= region.minBase || cut >= region.maxBase) return null;
	if (previous?.kind === 'bp' && previous.regionId === region.id && previous.cut === cut) {
		return previous;
	}
	const check = analyzeBpSplit(ctx.part, region.id, cut);
	return {
		kind: 'bp',
		regionId: region.id,
		cut,
		newRegionName: ctx.part.nextRegionName(region.kind),
		ok: check.ok,
		shift: check.ok ? check.shift : 0,
		reason: check.ok ? '' : check.reason,
		blockingSegmentIds: check.ok ? [] : check.blockingSegmentIds,
	};
}

function applySplit(preview: SplitPreview, ctx: ViewContext): void {
	if (preview.kind === 'rows') {
		splitRegionCmd(ctx.history, ctx.part, preview.regionId, preview.gapAfterVhId);
		return;
	}
	try {
		const { detachedGroupNames } = splitRegionAtBpCmd(
			ctx.history,
			ctx.part,
			preview.regionId,
			preview.cut
		);
		if (detachedGroupNames.length > 0) {
			notify.info(
				`Detached ${detachedGroupNames.join(', ')}: its copies now sit on both sides of the split, so they are plain oligos.`
			);
		}
	} catch (err) {
		if (!(err instanceof EditorError)) throw err;
		notify.error(err.message);
	}
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
				const svc = ctx.editorCtx.strandViewContext;
				const bpCut = bpCutPreview(world, ctx, svc.splitPreviewState);
				if (bpCut) {
					svc.splitPreviewState = bpCut;
					return;
				}
				const rows = ctx.drawingDimensions.getVisibleStrandRows();
				const gap = findSplitGap(world.y, rows, (row) =>
					ctx.drawingDimensions.getRowYByRowIdx(row)
				);

				if (gap) {
					const region = ctx.part.getRegionById(gap.regionId);
					const newRegionName = region ? ctx.part.nextRegionName(region.kind) : '';
					ctx.editorCtx.strandViewContext.splitPreviewState = {
						kind: 'rows',
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

				if (preview.kind === 'bp' && !preview.ok) {
					notify.warning(preview.reason);
					return;
				}
				applySplit(preview, ctx);
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
