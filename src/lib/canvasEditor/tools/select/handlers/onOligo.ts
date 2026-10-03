import type { SegmentEnd } from '../../../../model/Oligo';
import type { HandlerInstance } from '../../types';

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

			const selectedEnds = Array.from(oligo.allEnds);

			// if ctx.strandCtx.selectAllMode is SAME_COLOR or SAME_MODI, select all oligos with same color/modification
			if (ctx.strandCtx.selectAllMode === 'SAME_COLOR') {
				const targetColor = oligo.color;
				const allEnds: Set<SegmentEnd> = new Set();
				ctx.part.oligos.forEach((o) => {
					if (o.color === targetColor) {
						o.allEnds.forEach((end) => allEnds.add(end));
					}
				});
				selectedEnds.push(...Array.from(allEnds));
			}

			if (ctx.strandCtx.selectAllMode === 'SAME_LENGTH') {
				const targetLength = oligo.length;
				const allEnds: Set<SegmentEnd> = new Set();
				ctx.part.oligos.forEach((o) => {
					if (o.length === targetLength) {
						o.allEnds.forEach((end) => allEnds.add(end));
					}
				});
				selectedEnds.push(...Array.from(allEnds));
			}

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
		// move() {
		//   console.log('OLIGO move');
		//   return false;
		// },
		// up() { return false; },

		// contextmenu handler removed - now handled by ContextMenuBehavior

		reset() {
			/* no local moving state */
		},
	};
}
