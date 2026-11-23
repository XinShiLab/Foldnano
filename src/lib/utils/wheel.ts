/** Pixels a `DOM_DELTA_LINE` wheel step scrolls (Firefox / some Windows mice). */
const LINE_PX = 16;

/** A wheel `delta` in CSS pixels, given the event's `deltaMode` and the scrolled area's size. */
export function wheelDeltaPx(delta: number, deltaMode: number, pagePx: number): number {
	switch (deltaMode) {
		case WheelEvent.DOM_DELTA_LINE:
			return delta * LINE_PX;
		case WheelEvent.DOM_DELTA_PAGE:
			return delta * pagePx;
		default:
			return delta;
	}
}
