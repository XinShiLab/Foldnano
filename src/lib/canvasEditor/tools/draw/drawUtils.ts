import { drawStrandCmd } from '$lib/commands/strands';
import type { OligoSegmentProps } from '$lib/components/Editor/StrandView/OligoSegment.svelte';
import { generateRandomOKLCHColor } from '$lib/model/colorGenerator';
import type { RspCoord } from '$lib/model/Part/Part.svelte';
import type { ViewContext } from '$lib/canvasEditor/core/views';

// Helpers
const getTempOligoSegment = (ctx: ViewContext) =>
	ctx.strandCtx.tempParts.find((p) => p.type === 'OligoSegment') as
		{ type: 'OligoSegment'; props: OligoSegmentProps } | undefined;

const ensureTempOligoSegment = (ctx: ViewContext) => {
	let seg = getTempOligoSegment(ctx);
	if (!seg) {
		const newSeg = {
			type: 'OligoSegment' as const,
			props: {
				rowIdx: -1,
				start: 0,
				end: 0,
				strandSetIdxIfEqual: 0,
			} as OligoSegmentProps,
		};
		ctx.strandCtx.tempParts.push(newSeg);
		seg = newSeg;
	}
	return seg;
};

const resetDrawStartPoint = (pt: RspCoord) => {
	pt.rowIdx = -1;
	pt.strandIdx = 0;
	pt.bpIdx = -1;
};

const resetDrawing = (
	drawingStatus: { isDrawing: boolean; isConnecting: boolean },
	pt: RspCoord
) => {
	drawingStatus.isDrawing = false;
	resetDrawStartPoint(pt);
};

const rangeForStrand = (a: number, b: number, strandIdx: 0 | 1): [number, number] =>
	strandIdx === 0 ? [Math.min(a, b), Math.max(a, b)] : [Math.max(a, b), Math.min(a, b)];

export const drawStrandStart = (
	rsp: RspCoord,
	drawingStatus: { isDrawing: boolean; isConnecting: boolean },
	drawStartPoint: RspCoord,
	ctx: ViewContext
) => {
	if (drawingStatus.isDrawing) return;

	// set start state
	drawStartPoint.rowIdx = rsp.rowIdx;
	drawStartPoint.strandIdx = rsp.strandIdx;
	drawStartPoint.bpIdx = rsp.bpIdx;
	drawingStatus.isDrawing = true;
	drawingStatus.isConnecting = false;

	// prepare temp segment
	const seg = ensureTempOligoSegment(ctx);
	seg.props.rowIdx = rsp.rowIdx;
	seg.props.start = rsp.bpIdx;
	seg.props.end = rsp.bpIdx;
	seg.props.strandSetIdxIfEqual = rsp.strandIdx;
};

export const drawStrandUpdate = (
	bpIdx: number,
	drawingStatus: { isDrawing: boolean; isConnecting: boolean },
	drawStartPoint: RspCoord,
	ctx: ViewContext
) => {
	if (!drawingStatus.isDrawing) return;

	const seg = getTempOligoSegment(ctx);
	if (!seg) return;

	const [start, end] = rangeForStrand(drawStartPoint.bpIdx, bpIdx, drawStartPoint.strandIdx);
	seg.props.start = start;
	seg.props.end = end;
};

export const drawStrandEnd = (
	drawingStatus: { isDrawing: boolean; isConnecting: boolean },
	drawStartPoint: RspCoord,
	ctx: ViewContext
) => {
	const seg = getTempOligoSegment(ctx);
	if (!seg) {
		resetDrawing(drawingStatus, drawStartPoint);
		return;
	}

	if (seg.props.start === seg.props.end) {
		// do not create single nucleotide strand
		resetDrawing(drawingStatus, drawStartPoint);
		ctx.strandCtx.tempParts.splice(ctx.strandCtx.tempParts.indexOf(seg), 1);
		return;
	}

	const vh = ctx.drawingDimensions.getVisibleVhByDisplayRow(drawStartPoint.rowIdx);
	if (!vh) {
		resetDrawing(drawingStatus, drawStartPoint);
		ctx.strandCtx.tempParts.splice(ctx.strandCtx.tempParts.indexOf(seg), 1);
		return;
	}

	const color = generateRandomOKLCHColor();
	try {
		drawStrandCmd(
			{
				part: ctx.part,
				vhIdx: vh.index,
				startIdx: seg.props.start,
				endIdx: seg.props.end,
				color,
			},
			ctx.history
		);
	} finally {
		resetDrawing(drawingStatus, drawStartPoint);
		ctx.strandCtx.tempParts.splice(ctx.strandCtx.tempParts.indexOf(seg), 1);
	}
	return;
};
