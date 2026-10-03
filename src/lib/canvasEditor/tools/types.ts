import type { PointerEvt } from '.';
import type { Category, HitResult, LeafTarget } from '../core/modes';
import type { ViewContext } from '../core/views';

/**  */
export type PointerEventHandler = (
	evt: PointerEvt,
	ctx: ViewContext,
	hit: HitResult
) => boolean | void;

type SelectionFilters = ReadonlySet<LeafTarget | Category>;

export type HandlerInstance = {
	readonly kind: string;

	/**Decide if this handler wants to take the event for a given hit */
	predicate?: (args: {
		filters: SelectionFilters;
		ctx: ViewContext;
		evt: PointerEvt;
		hit: HitResult;
	}) => boolean;

	// lifecycle for pointer events
	down?: PointerEventHandler;
	move?: PointerEventHandler;
	up?: PointerEventHandler;
	cancel?: PointerEventHandler;
	contextmenu?: PointerEventHandler;

	// optional: called when tool exits or handler loses capture
	reset?: (ctx?: ViewContext) => void;
};

export type WorldPt = { x: number; y: number };
export type WorldRect = { x: number; y: number; width: number; height: number };
