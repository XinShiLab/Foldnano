import type { Tool, PointerEvt } from './index';
import type { ViewContext } from '$lib/canvasEditor/core/views';
import { paintOligoCmd, type PaintOligoParams } from '../../commands/strands';

export function PaintTool(): Tool {
	return {
		name: 'PAINT',
		onPointer(evt: PointerEvt, ctx: ViewContext) {
			if (evt.type === 'down' && evt.button === 0) {
				// console.log('DrawTool: pointer down at', evt.clientX, evt.clientY);
				const downWorld = ctx.camera.toWorld(evt.clientX, evt.clientY);
				const paintParams: PaintOligoParams[] = [];
				// check if selection is empty
				if (ctx.strandCtx.selected.ends.size > 0) {
					// if selection is not emplty, paint all selected oligos (get from the ends)
					const paintedOligos = new Set<string>();
					ctx.strandCtx.selected.ends.forEach((end) => {
						if (end.segment.oligo?.id && !paintedOligos.has(end.segment.oligo?.id)) {
							const oligo = ctx.part.getOligoById(end.segment.oligo?.id);
							if (!oligo) return;
							paintParams.push({
								oligo: oligo,
								color: ctx.strandCtx.colorContext.currentColor,
							});
							paintedOligos.add(oligo.id);
						}
					});
					paintOligoCmd(paintParams, ctx.history);
					ctx.strandCtx.selected.clear();
					// the reset doesn't work, the temporal red lines are still there. #TODO fix it
				} else {
					const filterKind = ['OLIGO'];
					const hit = ctx.hit
						.hitAt(downWorld, evt.directTargetId)
						.filter((h) => filterKind.includes(h.kind));
					// console.log('DrawTool: hit test result', hit);
					// const hitGrid = hit.find((h) => h.kind === 'VH_GRID');
					// const hitSegment = hit.find((h) => h.kind === 'SEGMENT');
					const hitOligo = hit.find((h) => h.kind === 'OLIGO');
					// if a segment is hit, break it
					if (hitOligo && hitOligo.id && evt.button === 0) {
						const oligo = ctx.part.getOligoById(hitOligo.id);
						if (!oligo) return;
						paintOligoCmd(
							{
								oligo: oligo,
								color: ctx.strandCtx.colorContext.currentColor,
							},
							ctx.history
						);
					}
				}
			}
		},
	};
}
