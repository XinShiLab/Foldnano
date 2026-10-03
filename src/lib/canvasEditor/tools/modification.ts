import type { Tool, PointerEvt } from './index';
import type { ViewContext } from '$lib/canvasEditor/core/views';
import { setModificationCmd } from '../../commands/strands';

export function ModificationTool(): Tool {
	return {
		name: 'MODIFICATION',
		onPointer(evt: PointerEvt, ctx: ViewContext) {
			if (evt.type !== 'down' || evt.button !== 0) return;

			const modiCtx = ctx.strandCtx.modificationContext;
			const modiName = modiCtx.currentModification?.name ?? null;

			// Path A: selection exists → apply to all selected free ends
			if (ctx.strandCtx.selected.ends.size > 0) {
				const ends = [...ctx.strandCtx.selected.ends].filter((e) => e.isFree);
				if (ends.length > 0) {
					setModificationCmd(
						ends.map((end) => ({ end, modification: modiName })),
						ctx.history
					);
				}
				ctx.strandCtx.selected.clear();
				return;
			}

			// Path B: click on an end → apply to that end if free
			const downWorld = ctx.camera.toWorld(evt.clientX, evt.clientY);
			const hit = ctx.hit.hitAt(downWorld, evt.directTargetId).filter((h) => h.kind === 'END');
			const hitEnd = hit.find((h) => h.kind === 'END');
			if (!hitEnd || !hitEnd.id) return;

			// Parse hit ID: format is `${segmentId}#${3|5}#${FREE|CONN}`
			const isThreePrime = hitEnd.id.endsWith('#3#FREE') || hitEnd.id.endsWith('#3#CONN');
			const segmentId = hitEnd.id.slice(0, -7);
			const segment = ctx.part.getSegmentById(segmentId);
			if (!segment) return;

			const end = isThreePrime ? segment.threePrime : segment.fivePrime;
			if (!end.isFree) return;

			setModificationCmd({ end, modification: modiName }, ctx.history);
		},
	};
}
