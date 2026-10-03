import type { HandlerInstance } from '../../types';
import type { ViewContext } from '../../../core/views';

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
	zone: 'body' | 'plane';
};

function parseHitId(id: string): ParsedRegionHeaderHit | null {
	// Element ids in the Konva tree look like REGION_HEADER#<...>, but the
	// dispatcher (hitEventToModel) splits off the leading kind, so the id we
	// receive here is the suffix after the first '#'. Possibilities:
	//   <regionId>            (body click)
	//   plane#<regionId>      (plane gizmo icon)
	if (id.startsWith('plane#')) return { regionId: id.slice('plane#'.length), zone: 'plane' };
	return { regionId: id, zone: 'body' };
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
