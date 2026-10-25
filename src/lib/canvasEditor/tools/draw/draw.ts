import type { Tool, PointerEvt } from '../index';
import type { ViewContext } from '$lib/canvasEditor/core/views';
import type { RspCoord } from '$lib/model/Part/Part.svelte';
import { drawStrandEnd, drawStrandStart, drawStrandUpdate } from './drawUtils';
import { connectingEnd, connectingStart, connectingUpdate } from './connectUtils';
import { parseRspString } from '../utils';

export function DrawTool(): Tool {
	const drawingStatus = { isDrawing: false, isConnecting: false };
	const drawStartPoint: RspCoord = { rowIdx: -1, strandIdx: 0, bpIdx: -1 };

	return {
		name: 'DRAW',
		onPointer(evt: PointerEvt, ctx: ViewContext) {
			if (evt.type === 'down' && evt.button === 0) {
				const downWorld = ctx.camera.toWorld(evt.clientX, evt.clientY);
				const filterKind = ['END', 'SEGMENT', 'VH_GRID'];
				const hit = ctx.hit
					.hitAt(downWorld, evt.directTargetId)
					.filter((h) => filterKind.includes(h.kind));

				// if it is an empty grid, start drawing
				if (hit.length === 1 && hit[0].kind === 'VH_GRID') {
					const rsp = parseRspString(hit[0].id);
					if (!rsp) return;
					drawStrandStart(rsp, drawingStatus, drawStartPoint, ctx);
					return;
				}

				// if it is a free 3' end, start connecting
				const hitGrid = hit.find((h) => h.kind === 'VH_GRID');
				const hitEnd = hit.find((h) => h.kind === 'END' && h.id.endsWith('#3#FREE'));
				if (hitGrid && hitGrid.id && hitEnd && hitEnd.id) {
					const rsp = parseRspString(hitGrid.id);
					if (!rsp) return;
					connectingStart(rsp, drawingStatus, ctx);
					return;
				}

				return;
			}

			if (evt.type === 'move' && evt.button === 0) {
				if (drawingStatus.isDrawing) {
					const moveWorld = ctx.camera.toWorld(evt.clientX, evt.clientY);
					const hitBp = ctx.hit.hitXAsBpPos(moveWorld);
					const vh = ctx.drawingDimensions.getVisibleVhByDisplayRow(drawStartPoint.rowIdx);
					if (!vh || hitBp < 0 || hitBp > vh.length - 1) return;
					if (
						!vh.strandSets[drawStartPoint.strandIdx]?.isRangeOccupied(drawStartPoint.bpIdx, hitBp)
					) {
						drawStrandUpdate(hitBp, drawingStatus, drawStartPoint, ctx);
					}
					return;
				}

				if (drawingStatus.isConnecting) {
					const moveWorld = ctx.camera.toWorld(evt.clientX, evt.clientY);
					const filterKind = ['END', 'SEGMENT', 'VH_GRID'];
					const hit = ctx.hit
						.hitAt(moveWorld, evt.directTargetId)
						.filter((h) => filterKind.includes(h.kind));
					connectingUpdate({ x: moveWorld.x, y: moveWorld.y }, drawingStatus, ctx, hit);
				}
				return;
			}

			if (evt.type === 'up') {
				if (drawingStatus.isDrawing) {
					drawStrandEnd(drawingStatus, drawStartPoint, ctx);
				}
				if (drawingStatus.isConnecting) {
					const upWorld = ctx.camera.toWorld(evt.clientX, evt.clientY);
					const filterKind = ['END', 'SEGMENT', 'VH_GRID'];
					const hit = ctx.hit
						.hitAt(upWorld, evt.directTargetId)
						.filter((h) => filterKind.includes(h.kind));
					connectingEnd(drawingStatus, ctx, hit);
				}
				return;
			}
		},
	};
}
