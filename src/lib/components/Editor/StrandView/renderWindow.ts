export interface ViewRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Extra world space kept rendered around the viewport, as a fraction of its size per side. */
const WINDOW_MARGIN = 0.25;
/** The viewport may come this close (fraction of its size) to the window edge before it moves. */
const WINDOW_GUARD = 0.05;
/** After zooming in, a window this many times the viewport is replaced by a tighter one. */
const MAX_WINDOW_RATIO = 3;

/**
 * The rect that viewport culling tests against. It only changes when the viewport nears its
 * edge or has shrunk well inside it, and then returns a new object; otherwise it returns
 * `current` itself, so a pan or zoom step that stays inside re-evaluates no culling.
 */
export function nextRenderWindow(current: ViewRect, viewport: ViewRect): ViewRect {
	const guardX = viewport.width * WINDOW_GUARD;
	const guardY = viewport.height * WINDOW_GUARD;
	const contains =
		current.x <= viewport.x - guardX &&
		current.y <= viewport.y - guardY &&
		current.x + current.width >= viewport.x + viewport.width + guardX &&
		current.y + current.height >= viewport.y + viewport.height + guardY;
	const oversized =
		current.width > viewport.width * MAX_WINDOW_RATIO ||
		current.height > viewport.height * MAX_WINDOW_RATIO;
	if (contains && !oversized) return current;
	const marginX = viewport.width * WINDOW_MARGIN;
	const marginY = viewport.height * WINDOW_MARGIN;
	return {
		x: viewport.x - marginX,
		y: viewport.y - marginY,
		width: viewport.width + 2 * marginX,
		height: viewport.height + 2 * marginY,
	};
}

/** World-space rect a Konva stage currently shows. Read at draw time, so it needs no state. */
export function stageViewRect(stage: {
	x(): number;
	y(): number;
	scaleX(): number;
	width(): number;
	height(): number;
}): ViewRect {
	const scale = stage.scaleX() || 1;
	return {
		x: -stage.x() / scale,
		y: -stage.y() / scale,
		width: stage.width() / scale,
		height: stage.height() / scale,
	};
}
