import type { Tool, PointerEvt } from './index';
import type { ViewContext } from '$lib/canvasEditor/core/views';
import {
	clearOligoSequenceCmd,
	clearSegmentSequenceCmd,
	fillRandomSequenceToOligoCmd,
	fillRandomSequenceToSegmentCmd,
	fillSequenceToOligoCmd,
	fillSequenceToSegmentCmd,
} from '../../commands/strands';

// import { Segment } from '../../model/domain';
// import type { Command } from '../services/tx';
// import { parseRspString } from './utils';
// import { breakOligoCmd } from '$lib/commands/strands';

export function SequenceTool(): Tool {
	return {
		name: 'SEQUENCE',
		onPointer(evt: PointerEvt, ctx: ViewContext) {
			if (evt.type === 'down' && evt.button === 0) {
				const downWorld = ctx.camera.toWorld(evt.clientX, evt.clientY);
				const filterKind = ['SEGMENT', 'VH_GRID'];
				const hit = ctx.hit
					.hitAt(downWorld, evt.directTargetId)
					.filter((h) => filterKind.includes(h.kind));
				// console.log('DrawTool: hit test result', hit);
				// const hitGrid = hit.find((h) => h.kind === 'VH_GRID');
				const hitSegment = hit.find((h) => h.kind === 'SEGMENT');
				// if a segment is hit, break it
				if (hitSegment && evt.button === 0 && hitSegment.id) {
					// console.log('SequenceTool: segment hit - do nothing for now');
					const segment = ctx.part.getSegmentById(hitSegment.id);
					const oligo = segment?.oligo;
					if (!segment || !oligo) return;
					const mode = ctx.strandCtx.sequenceContext.mode;
					const onOligo = ctx.strandCtx.selectionFilter.has('OLIGO');
					const onlyEmpty = ctx.strandCtx.sequenceContext.fillType === 'ONLY_EMPTY';

					if (!onOligo) {
						if (mode === 'RANDOM') {
							ctx.strandCtx.sequenceContext.fillResults = [];
							fillRandomSequenceToSegmentCmd(
								{
									segment,
									gcContent: ctx.strandCtx.sequenceContext.gcContent,
									onlyEmpty,
								},
								ctx.history
							);
						} else if (mode === 'SEQ' && ctx.strandCtx.sequenceContext.sequence.length > 0) {
							ctx.strandCtx.sequenceContext.fillResults = [];
							const fillInfo = fillSequenceToSegmentCmd(
								{
									segment,
									sequence: ctx.strandCtx.sequenceContext.sequence,
									lockSequence: true,
									onlyEmpty,
								},
								ctx.history
							);
							ctx.strandCtx.sequenceContext.fillResults = fillInfo;
						} else if (mode === 'REMOVE') {
							clearSegmentSequenceCmd(
								{
									segment,
								},
								ctx.history
							);
						}
						return;
					}

					if (mode === 'RANDOM') {
						fillRandomSequenceToOligoCmd(
							{
								oligo: oligo,
								gcContent: ctx.strandCtx.sequenceContext.gcContent,
								onlyEmpty,
							},
							ctx.history
						);
					} else if (mode === 'SEQ' && ctx.strandCtx.sequenceContext.sequence.length > 0) {
						ctx.strandCtx.sequenceContext.fillResults = [];

						const fillInfo = fillSequenceToOligoCmd(
							{
								oligo: oligo,
								sequence: ctx.strandCtx.sequenceContext.sequence,
								lockSequence: true,
								onlyEmpty,
							},
							ctx.history
						);
						ctx.strandCtx.sequenceContext.fillResults = fillInfo;
					} else if (mode === 'REMOVE') {
						ctx.strandCtx.sequenceContext.fillResults = [];
						clearOligoSequenceCmd(
							{
								oligo: oligo,
							},
							ctx.history
						);
					}

					// const filledSequence = segment?.fillRandomSequence();
					return;
				}
			}
		},
	};
}
