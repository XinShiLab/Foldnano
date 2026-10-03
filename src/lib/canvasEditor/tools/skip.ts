import type { Tool, PointerEvt } from './index';
import type { ViewContext } from '$lib/canvasEditor/core/views';
import { parseRspString } from './utils';
import { addSkipOrInsertionCmd, removeSkipOrInsertionCmd } from '$lib/commands/strands';
import type { AddSkipOrInsertionParams } from '$lib/commands/strands';
import type { RspCoord } from '$lib/model/Part/Part.svelte';
import { createDoubleClickDetector } from './doubleClick';
import { resolveTargetBpIdx, collectRegionSegmentsAtBp } from './skipInsertUtils';
import { toast } from 'svelte-sonner';
import { InvalidOperationError } from '$lib/errors';

export function SkipTool(): Tool {
	const dbl = createDoubleClickDetector({ windowMs: 350, maxDistPx: 6 });

	function doSingleSkip(ctx: ViewContext, rsp: RspCoord) {
		const vh = ctx.drawingDimensions.getVisibleVhByDisplayRow(rsp.rowIdx);
		if (!vh) return;
		const { skipInsertContext } = ctx.strandCtx;

		if (skipInsertContext.applyToAllVh) {
			const region = ctx.editorCtx.activeRegion;
			if (!region) return;
			const segments = collectRegionSegmentsAtBp(ctx.part, region, rsp.strandIdx, rsp.bpIdx);
			const params: AddSkipOrInsertionParams[] = [];
			let blocked = 0;
			for (const segment of segments) {
				const atIndex = resolveTargetBpIdx(ctx.part, segment, rsp.bpIdx);
				if (atIndex === null) {
					blocked++;
					continue;
				}
				params.push({ segment, atIndex, count: -1 });
			}
			if (blocked > 0) {
				toast.warning(
					`${blocked} position${blocked > 1 ? 's' : ''} skipped — constrained crossover site`
				);
			}
			if (params.length === 0) return;
			addSkipOrInsertionCmd(params, ctx.history);
		} else {
			const oligoSegment = ctx.part.getOligoByVh(vh.id, rsp.strandIdx, rsp.bpIdx);
			if (!oligoSegment) return;
			const targetBpIdx = resolveTargetBpIdx(ctx.part, oligoSegment.segment, rsp.bpIdx);
			if (targetBpIdx === null) {
				toast.warning('Cannot place skip — constrained crossover site');
				return;
			}
			addSkipOrInsertionCmd(
				{ segment: oligoSegment.segment, atIndex: targetBpIdx, count: -1 },
				ctx.history
			);
		}
	}
	function removeSingleSkip(ctx: ViewContext, rsp: RspCoord) {
		const vh = ctx.drawingDimensions.getVisibleVhByDisplayRow(rsp.rowIdx);
		if (!vh) return;
		const oligoSegment = ctx.part.getOligoByVh(vh.id, rsp.strandIdx, rsp.bpIdx);
		if (!oligoSegment) return;
		removeSkipOrInsertionCmd(
			{
				segment: oligoSegment.segment,
				atIndex: rsp.bpIdx,
			},
			ctx.history
		);
	}

	return {
		name: 'SKIP',
		onPointer(evt: PointerEvt, ctx: ViewContext) {
			if (evt.type !== 'down' || evt.button !== 0) return;

			const downWorld = ctx.camera.toWorld(evt.clientX, evt.clientY);
			const filterKind = ['SEGMENT', 'VH_GRID', 'END'];
			const hit = ctx.hit
				.hitAt(downWorld, evt.directTargetId)
				.filter((h) => filterKind.includes(h.kind));
			if (hit.find((h) => h.kind === 'END')) {
				throw new InvalidOperationError('You cannot skip at an end');
			}
			const hitGrid = hit.find((h) => h.kind === 'VH_GRID');
			const hitSegment = hit.find((h) => h.kind === 'SEGMENT');
			if (!hitSegment || !hitGrid || !hitGrid.id) return;

			const rsp = parseRspString(hitGrid.id);
			if (!rsp) return;

			const fireSingle = () => doSingleSkip(ctx, rsp);
			const fireRemove = () => removeSingleSkip(ctx, rsp);

			// delegate double-click detection
			dbl.pushClick(evt.clientX, evt.clientY, fireSingle, fireRemove);
		},
	};
}
