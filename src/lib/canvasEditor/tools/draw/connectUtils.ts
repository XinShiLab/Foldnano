import type { ConnectionInProgressProps } from '$lib/components/Editor/StrandView/temporalLayer/ConnectionInProgress.svelte';
import type { HitResult } from '$lib/canvasEditor/core/modes';
import { createCrossoverCmd } from '$lib/commands/strands';
import type { RspCoord } from '$lib/model/Part/Part.svelte';
import type { ViewContext } from '$lib/canvasEditor/core/views';
import { parseRspString } from '../utils';
import { toast } from 'svelte-sonner';

// Helpers
type ConnectingTemp = { type: 'Connecting'; props: ConnectionInProgressProps };

const getConnectingTemp = (ctx: ViewContext) =>
	ctx.strandCtx.tempParts.find((p) => p.type === 'Connecting') as ConnectingTemp | undefined;

const ensureConnectingTemp = (ctx: ViewContext) => {
	let temp = getConnectingTemp(ctx);
	if (!temp) {
		const newTemp: ConnectingTemp = {
			type: 'Connecting',
			props: {
				start: [0, 0, 0],
				waypoint: [0, 0],
				end: null,
			},
		};
		ctx.strandCtx.tempParts.push(newTemp);
		temp = newTemp;
	}
	return temp;
};

const cleanupConnecting = (
	ctx: ViewContext,
	temp: ConnectingTemp,
	drawingStatus: { isDrawing: boolean; isConnecting: boolean }
) => {
	const idx = ctx.strandCtx.tempParts.indexOf(temp);
	if (idx >= 0) ctx.strandCtx.tempParts.splice(idx, 1);
	drawingStatus.isConnecting = false;
};

const setStartFromRsp = (temp: ConnectingTemp, rsp: RspCoord, ctx: ViewContext) => {
	temp.props.start = [rsp.rowIdx, rsp.bpIdx, rsp.strandIdx];
	temp.props.waypoint = ctx.drawingDimensions.getBpCoordsByRowAndBpIdx(rsp.rowIdx, rsp.bpIdx)[
		rsp.strandIdx
	];
	temp.props.end = null;
};

export const connectingStart = (
	rsp: RspCoord,
	drawingStatus: { isDrawing: boolean; isConnecting: boolean },
	ctx: ViewContext
) => {
	if (drawingStatus.isConnecting) return;
	drawingStatus.isDrawing = false;
	drawingStatus.isConnecting = true;

	const temp = ensureConnectingTemp(ctx);
	setStartFromRsp(temp, rsp, ctx);
};

export const connectingUpdate = (
	p: { x: number; y: number },
	drawingStatus: { isDrawing: boolean; isConnecting: boolean },
	ctx: ViewContext,
	hitAt?: HitResult[]
) => {
	if (!drawingStatus.isConnecting) return;

	const temp = getConnectingTemp(ctx);
	if (!temp) return;

	temp.props.waypoint = [p.x, p.y];

	const hitSeg = hitAt?.find((h) => h.kind === 'SEGMENT');
	const hitGridId = hitAt?.find((h) => h.kind === 'VH_GRID')?.id ?? '';
	const rsp = parseRspString(hitGridId);

	temp.props.end = hitSeg && rsp ? [rsp.rowIdx, rsp.bpIdx, rsp.strandIdx] : null;
};

export const connectingEnd = (
	drawingStatus: { isDrawing: boolean; isConnecting: boolean },
	ctx: ViewContext,
	hitAt?: HitResult[]
) => {
	const temp = getConnectingTemp(ctx);
	if (!temp) {
		drawingStatus.isConnecting = false;
		return;
	}
	if (!hitAt || hitAt.length === 0) {
		cleanupConnecting(ctx, temp, drawingStatus);
		return;
	}

	const hitSeg = hitAt.find((h) => h.kind === 'SEGMENT');
	const hitGridId = hitAt.find((h) => h.kind === 'VH_GRID')?.id ?? '';
	const rsp = parseRspString(hitGridId);

	if (!hitSeg || !rsp) {
		cleanupConnecting(ctx, temp, drawingStatus);
		return;
	}

	const [startRowIdx, startBpIdx, startStrandIdx] = temp.props.start;
	if (rsp.rowIdx === startRowIdx && rsp.bpIdx === startBpIdx && rsp.strandIdx === startStrandIdx) {
		// Pointer released where it went down — a click, not a drag. Not an attempted crossover.
		cleanupConnecting(ctx, temp, drawingStatus);
		return;
	}

	const fromVh = ctx.drawingDimensions.getVisibleVhByDisplayRow(temp.props.start[0]);
	const toVh = ctx.drawingDimensions.getVisibleVhByDisplayRow(rsp.rowIdx);
	const resolvedFrom = fromVh
		? ctx.part.getOligoByVh(fromVh.id, temp.props.start[2], temp.props.start[1])
		: null;
	const to = toVh ? ctx.part.getOligoByVh(toVh.id, rsp.strandIdx, rsp.bpIdx) : null;

	if (!resolvedFrom || !to) {
		cleanupConnecting(ctx, temp, drawingStatus);
		return;
	}

	const targetSlot = to.segment.slotForBp(rsp.bpIdx);
	if (targetSlot !== undefined && targetSlot.seq.length === 0) {
		toast.warning('Cannot connect to a skip position');
		cleanupConnecting(ctx, temp, drawingStatus);
		return;
	}
	if (targetSlot !== undefined && targetSlot.seq.length > 1) {
		toast.warning('Cannot connect to an insert position');
		cleanupConnecting(ctx, temp, drawingStatus);
		return;
	}

	try {
		const result = createCrossoverCmd(
			{
				part: ctx.part,
				fromOligo: resolvedFrom.oligo,
				toOligo: to.oligo,
				toSegment: to.segment,
				atIndexTarget: rsp.bpIdx,
			},
			ctx.history
		);
		if (result.droppedModifications.length > 0) {
			toast.warning(
				`Crossover dropped modification${result.droppedModifications.length === 1 ? '' : 's'}: ${result.droppedModifications.join(', ')}`
			);
		}
	} finally {
		cleanupConnecting(ctx, temp, drawingStatus);
	}
};
