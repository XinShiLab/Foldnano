import type { HandlerInstance } from '../../types';

export function createSegmentHandler(): HandlerInstance {
	return {
		kind: 'SEGMENT',

		predicate: ({ filters }) => filters.has('SEGMENT'),

		down(evt, ctx, hit) {
			if (!hit.id) return true;

			const segment = ctx.part.getSegmentById(hit.id);
			if (!segment) return true;
			ctx.strandCtx.hoverSegment = segment;
			ctx.strandCtx.hoverOligo = null; // clear oligo hover if any

			const selectedEnds = [segment.fivePrime, segment.threePrime];

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

		// up(evt, ctx) { clearAllTempParts(ctx); return true; },

		reset() {
			/* no moving state now */
		},
	};
}
