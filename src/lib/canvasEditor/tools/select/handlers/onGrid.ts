import type { HandlerInstance } from '../../types';

export function createGridHandler(): HandlerInstance {
	return {
		kind: 'VH_GRID',
		// no predicate, always on eligible for VH_GRID hits, but return false to not "activate" the handler

		down(evt, ctx, _hit) {
			const downWorld = ctx.camera.toWorld(evt.clientX, evt.clientY);
			const hitRsp = ctx.hit.hitRsp(downWorld);
			if (hitRsp) {
				ctx.strandCtx.activeAround.rowIdx = hitRsp.rowIdx;
				ctx.strandCtx.activeAround.bpIdx = hitRsp.bpIdx;
				const activeVh = ctx.drawingDimensions.getVisibleVhByDisplayRow(hitRsp.rowIdx);
				ctx.strandCtx.activeCsRegionId = activeVh?.regionId ?? null;
			}
			return false;
		},
		move(_evt, _ctx, _hit) {
			// hover footnote now handled by HoverInfoBehavior
			return false;
		},
	};
}
