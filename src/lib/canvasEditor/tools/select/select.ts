import type { PointerEventType, Tool } from '..';
import type { Category, HitResult, LeafTarget } from '../../core/modes';
import type { ViewContext } from '../../core/views';
import { createEndHandler } from './handlers/onEnd';
import { removeMoveEndBox } from './handlers/movingEndsOps';
import type { HandlerInstance, WorldPt } from '../types';
import { filterHitsByUserFilter } from './selectUtils';
import { createEmptyHandler, hideMarquee } from './handlers/onEmpty';
import { createSegmentHandler } from './handlers/onSegment';
import { createOligoHandler } from './handlers/onOligo';
import { createGridHandler } from './handlers/onGrid';
import { createXoverHandler } from './handlers/onXover';
import { createCsCursorHandler } from './handlers/onCsCursor';
import { createWithSelectionHandler } from './handlers/withSelection';
import { createVhTagHandler } from './handlers/onVhTag';
import { createRegionHeaderHandler } from './handlers/onRegionHeader';

/* ===================== Priority & Dispatch Helpers ===================== */

// Highest priority first; tweak order freely
// Priority order for hit handling; higher priority handlers are checked first.
// Handlers can return false or nothing to allow bubbling to lower-priority handlers.
// return true to stop bubbling.
const PRIORITY: Array<LeafTarget> = [
	'REGION_HEADER',
	'CS_CURSOR', // Top priority for CS cursor; stop bubbling of cursor is hit
	'VH_TAG', // High priority for VH tag drag interaction
	'VH_GRID', // Top priority for grid hits; allows bubbling after handled
	'END',
	'XOVER',
	'OLIGO',
	'SEGMENT',
	'XOVER_SITE',
	'EMPTY',
];

function rank(kind: string): number {
	const i = PRIORITY.indexOf(kind as LeafTarget);
	return i === -1 ? 999 : i;
}

function byPriority(a: HitResult, b: HitResult) {
	const ka = a.kind as string;
	const kb = b.kind as string;
	return rank(ka) - rank(kb);
}

function filteredHits(ctx: ViewContext, world: WorldPt, directTargetId?: string) {
	const hits = ctx.hit.hitAt(world, directTargetId);
	if (ctx.strandCtx.selectionFilter.size === 0) return hits; // no filtering
	return filterHitsByUserFilter(hits, ctx.strandCtx.selectionFilter).sort(byPriority);
}

/* ===================== Handlers (each with private state) ===================== */

function createWildcardHandler(): HandlerInstance {
	return {
		kind: '*',
		predicate: ({ ctx }) => ctx.strandCtx.selected.ends.size !== 0,
		down(_evt, _ctx) {
			return false;
		},
	};
}

/* ===================== The Tool (priority dispatch + active routing) ===================== */

export function SelectTool(): Tool {
	const instances = new Map<string, HandlerInstance>([
		['CS_CURSOR', createCsCursorHandler()], // pass-through handler, allow bubbling
		['REGION_HEADER', createRegionHeaderHandler()],
		['VH_TAG', createVhTagHandler()], // drag handler for VH tags
		['VH_GRID', createGridHandler()], // pass-through handler, allow bubbling
		['WITH_SELECTION', createWithSelectionHandler()], // kept, but not in hit list or the priority list
		['END', createEndHandler()],
		['SEGMENT', createSegmentHandler()],
		['OLIGO', createOligoHandler()],
		['XOVER', createXoverHandler()],
		['EMPTY', createEmptyHandler()],
	]);

	const needSelectionHandler = ['END', 'SEGMENT', 'OLIGO', 'XOVER'];
	const wildcard = createWildcardHandler();
	let active: HandlerInstance | null = null;
	let activeHit: HitResult | null = null;

	return {
		name: 'SELECT',

		onPointer(evt, ctx) {
			const type = evt.type as PointerEventType;

			// If a handler is active, route directly (but contextmenu can still bubble through)
			if (active && type !== 'contextmenu') {
				const fn = active[type];
				if (fn) fn(evt, ctx, activeHit as HitResult);
				if (type === 'up' || type === 'cancel') {
					active.reset?.();
					active = null;
					activeHit = null;
				}
				return;
			}

			// Normal dispatch: compute world + filters + hits once
			const world = ctx.camera.toWorld(evt.clientX, evt.clientY);
			const filters = ctx.strandCtx.selectionFilter || new Set<LeafTarget | Category>();
			const hits = filteredHits(ctx, world, evt.directTargetId || undefined);
			// no synthetic WITH_SELECTION hit injected anymore

			// Walk hits by priority and try handlers
			for (const hit of hits) {
				const key = hit.kind as string;
				const handler = instances.get(key) ?? wildcard;
				if (!handler) continue;

				const ok = handler.predicate?.({ filters, ctx, evt, hit }) ?? true;
				if (!ok) continue;

				const fn = handler[type];
				if (!fn) continue;

				const handled = fn(evt, ctx, hit);
				let selHandled = false;
				let selHandler: HandlerInstance | null = null;
				if (needSelectionHandler.includes(key)) {
					selHandler = instances.get('WITH_SELECTION') || null;
					const selFn = selHandler?.[type];
					if (selFn) {
						selHandled = selFn(evt, ctx, hit) || false;
					}
				}
				if (type === 'down') {
					if (selHandled) {
						active = selHandler;
						activeHit = hit; // cache the one we grabbed on down
						break;
					} else if (handled) {
						active = handler;
						activeHit = hit; // cache the one we grabbed on down
						break;
					}
				}
				if (handled) {
					break;
				}
			}
		},

		onExit(ctx) {
			active?.reset?.(ctx);
			active = null;
			activeHit = null;

			hideMarquee(ctx);
			removeMoveEndBox(ctx);
		},
	};
}
