import type { Tool, PointerEvt } from './index';
import type { ViewContext } from '$lib/canvasEditor/core/views';
// import { Segment } from '../../model/domain';
// import type { Command } from '../services/tx';
import { parseRspString } from './utils';
import { breakOligoCmd } from '$lib/commands/strands';

export function BreakTool(): Tool {
	return {
		name: 'BREAK',
		onPointer(evt: PointerEvt, ctx: ViewContext) {
			if (evt.type === 'down' && evt.button === 0) {
				const downWorld = ctx.camera.toWorld(evt.clientX, evt.clientY);
				const filterKind = ['SEGMENT', 'VH_GRID'];
				const hit = ctx.hit
					.hitAt(downWorld, evt.directTargetId)
					.filter((h) => filterKind.includes(h.kind));
				// console.log('DrawTool: hit test result', hit);
				const hitGrid = hit.find((h) => h.kind === 'VH_GRID');
				const hitSegment = hit.find((h) => h.kind === 'SEGMENT');
				// if a segment is hit, break it
				if (hitSegment && evt.button === 0 && hitGrid && hitGrid.id) {
					const rsp = parseRspString(hitGrid.id);
					if (!rsp) return;
					const vh = ctx.drawingDimensions.getVisibleVhByDisplayRow(rsp.rowIdx);
					if (!vh) return;
					const oligoSegment = ctx.part.getOligoByVh(vh.id, rsp.strandIdx, rsp.bpIdx);
					if (!oligoSegment) return;
					breakOligoCmd(
						{
							part: ctx.part,
							oligo: oligoSegment.oligo,
							segment: oligoSegment.segment,
							atIndex: rsp.bpIdx,
						},
						ctx.history
					);
					return;
				}
			}
		},
	};
}
