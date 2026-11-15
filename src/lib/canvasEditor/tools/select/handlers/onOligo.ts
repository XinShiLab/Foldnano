import type { HandlerInstance } from '../../types';
import { expandOligoEnds, filterEndsByStrandType } from '../selectUtils';

export function createOligoHandler(): HandlerInstance {
	return {
		kind: 'OLIGO',
		predicate: ({ filters }) => filters.has('OLIGO'),
		down(evt, ctx, hit) {
			if (evt.button !== 0) return false;

			if (!hit.id) return true;
			const oligo = ctx.part.getOligoById(hit.id);
			if (!oligo) return true;
			ctx.strandCtx.hoverOligo = oligo;
			ctx.strandCtx.hoverSegment = null; // clear segment hover if any

			let selectedEnds = expandOligoEnds(ctx.part, oligo, ctx.strandCtx.selectAllMode);

			selectedEnds = filterEndsByStrandType(selectedEnds, ctx.strandCtx.selectionFilter);
			if (selectedEnds.length === 0) return true;

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

		reset() {
			/* no local moving state */
		},
	};
}
