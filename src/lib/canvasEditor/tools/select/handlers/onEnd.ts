import type { SegmentEnd } from '$lib/model/Oligo';
import type { HandlerInstance } from '../../types';
import { filterEndsByStrandType } from '../selectUtils';

// create EndMoving handler
export function createEndHandler(): HandlerInstance {
	return {
		kind: 'END',
		predicate: ({ filters }) => filters.has('END'),
		down(evt, ctx, hit) {
			if (!hit.id) return false;
			const isThreePrime = hit.id.endsWith('#3#FREE') || hit.id.endsWith('#3#CONN');
			const segmentId = hit.id.slice(0, -7);
			const segment = ctx.part.getSegmentById(segmentId);
			if (!segment) return false;
			const endToMove = isThreePrime ? segment.threePrime : segment.fivePrime;
			let selectedEnds: SegmentEnd[] = [endToMove];
			if (ctx.strandCtx.selectAllMode === 'SAME_MODI' && endToMove.modification !== null) {
				const targetModi = endToMove.modification;
				const allEnds: Set<SegmentEnd> = new Set();
				ctx.part.oligos.forEach((oligo) => {
					if (!oligo || !oligo.threePrime || !oligo.fivePrime) return;
					[oligo.threePrime, oligo.fivePrime].forEach((end) => {
						if (end.modification === targetModi) {
							allEnds.add(end);
						}
					});
				});

				selectedEnds.push(...Array.from(allEnds));
				selectedEnds = filterEndsByStrandType(selectedEnds, ctx.strandCtx.selectionFilter);
			}

			if (selectedEnds.length === 0) return false;
			if (!evt.shiftKey) {
				if (!ctx.strandCtx.selected.includesAll(selectedEnds)) {
					ctx.strandCtx.selected.clear();
					ctx.strandCtx.selected.set(selectedEnds);
				}
			} else {
				if (ctx.strandCtx.selected.includesAll(selectedEnds)) {
					ctx.strandCtx.selected.remove(selectedEnds);
				} else {
					ctx.strandCtx.selected.add(selectedEnds);
				}
			}
			return true; // handled; tool will delegate to WITH_SELECTION
		},
		// movement handled by WITH_SELECTION
		reset() {
			/* no local state */
		},
	};
}
