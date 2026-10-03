import type { HandlerInstance } from '../../types';

export function createXoverHandler(): HandlerInstance {
	return {
		kind: 'XOVER',
		predicate: ({ filters }) => filters.has('XOVER'),

		down(evt, ctx, hit) {
			if (!hit.id) return true;

			// parse: `${segment.id}#to#${connectedEnd.segment.id}`
			const fromSegmentId = hit.id.split('#')[0];
			const toSegmentId = hit.id.split('#')[2];
			const fromSegment = ctx.part.getSegmentById(fromSegmentId);
			const toSegment = ctx.part.getSegmentById(toSegmentId);
			if (!fromSegment || !toSegment) return true;

			const selectedEnds = [fromSegment.threePrime, toSegment.fivePrime];

			if (!evt.shiftKey) {
				if (!ctx.strandCtx.selected.includesAll(selectedEnds)) {
					ctx.strandCtx.selected.clear();
					ctx.strandCtx.selected.set(selectedEnds);
				}
			} else {
				ctx.strandCtx.selected.add(selectedEnds);
			}

			return true; // handled; tool will delegate to WITH_SELECTION
		},
		reset() {
			/* no local state */
		},
	};
}
