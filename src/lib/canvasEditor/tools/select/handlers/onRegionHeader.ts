import type { HandlerInstance } from '../../types';
import type { ViewContext } from '../../../core/views';
import { moveRegionCmd } from '$lib/commands/regions';

function clearHiddenTransientState(ctx: ViewContext): void {
	const activeAround = ctx.strandCtx.activeAround;
	if (activeAround.rowIdx !== -1) {
		const activeVh = ctx.drawingDimensions.getVisibleVhByDisplayRow(activeAround.rowIdx);
		if (!activeVh) {
			ctx.strandCtx.activeAround = { rowIdx: -1, bpIdx: -1 };
		}
	}

	if (ctx.strandCtx.contextMenu.visible) {
		ctx.strandCtx.contextMenu.visible = false;
	}

	if (
		ctx.strandCtx.hoverSegment &&
		ctx.drawingDimensions.getDisplayRowForVh(ctx.strandCtx.hoverSegment.inVirtualHelix.id) === null
	) {
		ctx.strandCtx.hoverSegment = null;
	}

	if (
		ctx.strandCtx.hoverOligo &&
		![...ctx.strandCtx.hoverOligo.segments].some(
			(segment) => ctx.drawingDimensions.getDisplayRowForVh(segment.inVirtualHelix.id) !== null
		)
	) {
		ctx.strandCtx.hoverOligo = null;
	}
}

type ParsedRegionHeaderHit = {
	regionId: string;
	zone: 'body' | 'plane' | 'up' | 'down';
};

function parseHitId(id: string): ParsedRegionHeaderHit | null {
	// Element ids in the Konva tree look like REGION_HEADER#<...>, but the
	// dispatcher (hitEventToModel) splits off the leading kind, so the id we
	// receive here is the suffix after the first '#'. Possibilities:
	//   <regionId>            (body click)
	//   plane#<regionId>      (plane gizmo icon)
	//   up#<regionId>, down#<regionId>  (move buttons on the active header)
	for (const zone of ['plane', 'up', 'down'] as const) {
		if (id.startsWith(`${zone}#`)) return { regionId: id.slice(zone.length + 1), zone };
	}
	return { regionId: id, zone: 'body' };
}

function headerWorldY(ctx: ViewContext, regionId: string): number | null {
	const row = ctx.drawingDimensions
		.getVisibleStrandRows()
		.find((r) => r.kind === 'REGION_HEADER' && r.regionId === regionId);
	return row ? ctx.drawingDimensions.getRowYByRowIdx(row.displayRow) : null;
}

/** Moves the region one slot and pans so its header stays under the pointer for repeat clicks. */
function moveRegionByOne(ctx: ViewContext, regionId: string, step: -1 | 1): void {
	const from = ctx.part.regions.findIndex((r) => r.id === regionId);
	if (from < 0) return;
	const before = headerWorldY(ctx, regionId);
	moveRegionCmd(ctx.history, ctx.part, regionId, from + step);
	const after = headerWorldY(ctx, regionId);
	const controller = ctx.editorCtx.strandToolbarController;
	const scale = controller?.stage?.node.scaleY() ?? 1;
	if (before !== null && after !== null && after !== before) {
		controller?.panBy(0, (before - after) * scale);
	}
}

const DOUBLE_CLICK_MS = 350;

export function createRegionHeaderHandler(): HandlerInstance {
	let lastClickRegionId: string | null = null;
	let lastClickAt = 0;

	return {
		kind: 'REGION_HEADER',
		down(_evt, ctx, hit) {
			if (!hit.id) return true;
			const parsed = parseHitId(hit.id);
			if (!parsed) return true;
			const { regionId, zone } = parsed;
			const editorCtx = ctx.editorCtx;

			if (zone === 'plane') {
				editorCtx.setActiveRegion(regionId);
				editorCtx.show3D = true;
				editorCtx.activateHelixPane();
				const ctrl = editorCtx.view3DToolbarController;
				if (ctrl) ctrl.showPlanes = true;
				editorCtx.view3DToolbarController?.onFrameActivePlane?.();
				return true;
			}

			if (zone === 'up' || zone === 'down') {
				moveRegionByOne(ctx, regionId, zone === 'up' ? -1 : 1);
				lastClickRegionId = null;
				return true;
			}

			// Body: single-click activates, double-click toggles collapse.
			const now = Date.now();
			const isDoubleClick = lastClickRegionId === regionId && now - lastClickAt < DOUBLE_CLICK_MS;
			lastClickRegionId = regionId;
			lastClickAt = now;

			editorCtx.setActiveRegion(regionId);

			if (isDoubleClick) {
				const collapsed = new Set(ctx.strandCtx.collapsedRegionIds);
				if (collapsed.has(regionId)) collapsed.delete(regionId);
				else collapsed.add(regionId);
				ctx.strandCtx.collapsedRegionIds = [...collapsed];
				clearHiddenTransientState(ctx);
				// Reset so a third click in rapid succession isn't another double.
				lastClickRegionId = null;
			}
			return true;
		},
	};
}
