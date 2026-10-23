import type { TemporalPartInfo } from '$lib/components/Editor/context/types';
import type { SegmentEnd } from '$lib/model/Oligo';
import type { ViewContext } from '$lib/canvasEditor/core/views';
import type { HandlerInstance, WorldPt, WorldRect } from '../../types';
import {
	allowedByUserFilter,
	filterEndsByStrandType,
	isDefined,
	strandCategoryOf,
} from '../selectUtils';
import { clearAllTempParts, removeTempPartsByType } from './drawTempPartsOps';
import { parseEndSelectId, rectFrom } from './utils';

// I leave Marquee drawing functions here because they are currently only used in EMPTY handler
function ensureMarquee(ctx: ViewContext) {
	const tempParts = ctx.strandCtx.tempParts;
	const m = tempParts.find((p) => p.type === 'Marquee');
	if (m) return m;
	const newM: TemporalPartInfo = {
		type: 'Marquee',
		props: { x: 0, y: 0, width: 0, height: 0, visible: false },
	};
	tempParts.push(newM);
	return newM;
}
function showMarquee(ctx: ViewContext, r: WorldRect) {
	const m = ensureMarquee(ctx);
	m.props.x = r.x;
	m.props.y = r.y;
	m.props.width = r.width;
	m.props.height = r.height;
	m.props.visible = true;
}
export function hideMarquee(ctx: ViewContext) {
	// ensureMarquee(ctx).props.visible = false;
	removeTempPartsByType(ctx, 'Marquee');
}

/**  rules to include and potentially add more ends to selection (Selection only holds Ends)
 * if 'SEGMENT' is in filter, select all ends of the segments of selected ends,
 * if 'OLIGO' is in filter, select all ends of the oligos of selected ends,
 * only ends whose oligo type ('SCAF' = isScaffold, 'STAP' = not) is in filter are kept
 * if 'XOVER' is in filter, select all ends connected by crossovers to selected ends (check end's .connectedEnd)
 * if only 'END' is in filter, only select free ends (isFree === true)*/
function fromHitsCandsToSelectedEnds(
	parsedEnds: { segmentId: string; isThreePrime: boolean; isFree: boolean }[],
	ctx: ViewContext
): SegmentEnd[] {
	const endsToSelect: SegmentEnd[] = [];
	parsedEnds.forEach(({ segmentId, isThreePrime, isFree }) => {
		const segment = ctx.part.getSegmentById(segmentId);
		if (!segment) return;
		const end = isThreePrime ? segment.threePrime : segment.fivePrime;
		if (!end) return;
		if (!ctx.strandCtx.selectionFilter.has(strandCategoryOf(end))) return;

		// if only 'END' is in filter, only select free ends
		if (allowedByUserFilter('END', () => ctx.strandCtx.selectionFilter)) {
			if (isFree) {
				endsToSelect.push(end);
			}
		}
		// console.log('allow SEGMENT?', allowedByUserFilter('SEGMENT', ctx.getSelectFilter));
		// check for 'SEGMENT' filter
		if (allowedByUserFilter('SEGMENT', () => ctx.strandCtx.selectionFilter)) {
			endsToSelect.push(segment.fivePrime, segment.threePrime);
		}

		// check for 'OLIGO' filter
		if (allowedByUserFilter('OLIGO', () => ctx.strandCtx.selectionFilter)) {
			const oligo = segment.oligo;
			if (oligo) {
				oligo.segments.forEach((seg) => {
					endsToSelect.push(seg.fivePrime, seg.threePrime);
				});
			}
		}

		// check for 'XOVER' filter
		if (allowedByUserFilter('XOVER', () => ctx.strandCtx.selectionFilter)) {
			const connectedEnd = end.connectedEnd;
			if (connectedEnd) {
				endsToSelect.push(connectedEnd);
			}
		}
	});
	return filterEndsByStrandType(endsToSelect, ctx.strandCtx.selectionFilter);
}

export function createEmptyHandler(): HandlerInstance {
	let downWorld: WorldPt | null = null;
	let isMarquee = false;

	return {
		kind: 'EMPTY',
		// No predicate → always eligible fallback when kind is EMPTY

		down(evt, ctx) {
			// clear selection
			if (!evt.shiftKey) {
				ctx.strandCtx.selected.clear();
			}

			downWorld = ctx.camera.toWorld(evt.clientX, evt.clientY);
			isMarquee = false;

			return true;
		},

		move(evt, ctx) {
			const rsp = ctx.hit.hitRsp(ctx.camera.toWorld(evt.clientX, evt.clientY));
			if (!rsp) ctx.strandCtx.footnote = 'nothing';
			if (!downWorld) return true;
			const curWorld = ctx.camera.toWorld(evt.clientX, evt.clientY);
			const w = Math.abs(curWorld.x - downWorld.x);
			const h = Math.abs(curWorld.y - downWorld.y);
			if (!isMarquee && (w > 0 || h > 0)) {
				isMarquee = true;
			}
			if (!isMarquee) return true;
			showMarquee(ctx, rectFrom(downWorld, curWorld));

			return true;
		},

		up(evt, ctx) {
			const upWorld = ctx.camera.toWorld(evt.clientX, evt.clientY);
			// const selection = ctx.strandCtx.selected;
			if (isMarquee && downWorld) {
				// commit marquee selection
				const rect = rectFrom(downWorld, upWorld);
				const cands = ctx.hit.queryRect(rect);
				const ends = cands.filter((h) => h.kind === 'END');
				const endIds = ends.map((h) => h.id).filter(isDefined);
				// ctx.selection.set(endIds);
				const parsedEndsInfo = endIds.map((id) => parseEndSelectId(id)).filter(isDefined);
				const selectedEnds = fromHitsCandsToSelectedEnds(parsedEndsInfo, ctx);
				if (!evt.shiftKey) {
					if (!ctx.strandCtx.selected.includesAll(selectedEnds)) {
						ctx.strandCtx.selected.clear();
						ctx.strandCtx.selected.set(selectedEnds);
					}
				} else {
					ctx.strandCtx.selected.add(selectedEnds);
				}
			} else {
				// single click on empty space: clear selection
				ctx.strandCtx.selected.clear();
				clearAllTempParts(ctx);
			}

			isMarquee = false;
			downWorld = null;
			hideMarquee(ctx);
			return true;
		},

		// contextmenu handler removed - now handled by ContextMenuBehavior

		reset() {
			isMarquee = false;
			downWorld = null;
		},
	};
}
