import type { ToolBehavior, PointerEvt } from '../index';
import type { EditorMode } from '$lib/canvasEditor/core/modes';
import type { ViewContext } from '$lib/canvasEditor/core/views';

export function createHoverInfoBehavior(modes: Set<EditorMode>): ToolBehavior {
	return {
		name: 'HoverInfoBehavior',
		appliesTo(mode) {
			return modes.has(mode);
		},
		onPointer(evt: PointerEvt, ctx: ViewContext) {
			if (evt.type !== 'move') return;
			const world = ctx.camera.toWorld(evt.clientX, evt.clientY);
			const hitRsp = ctx.hit.hitRsp(world);
			if (hitRsp) {
				const vh = ctx.drawingDimensions.getVisibleVhByDisplayRow(hitRsp.rowIdx);
				if (!vh) {
					ctx.strandCtx.footnote = '';
					return;
				}
				const targets = ctx.part.getEntitiesAtVh(vh.id, hitRsp.strandIdx, hitRsp.bpIdx);
				const vhIdx = targets.vh?.index ?? null;
				if (vhIdx !== null) {
					ctx.strandCtx.footnote = `VH ${vhIdx} - BP ${hitRsp.bpIdx}`;
				}
				if (targets.oligo) {
					ctx.strandCtx.footnote += ` | Oligo ${targets.oligo.id.slice(0, 6)}`;
				}
				const slotSeq = targets.segment?.slotForBp(hitRsp.bpIdx)?.seq;
				if (slotSeq && slotSeq.length > 2 && !/^N+$/.test(slotSeq)) {
					ctx.strandCtx.footnote += ` | Insert sequence ${slotSeq}`;
				}
				return;
			}
			// clear when no hit
			ctx.strandCtx.footnote = '';
		},
	};
}
