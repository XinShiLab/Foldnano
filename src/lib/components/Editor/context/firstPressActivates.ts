// A double-click whose first click only activated the pane must not act either.
const ACTIVATION_DBLCLICK_MS = 500;

export interface FirstPressHandlers {
	onpointerdowncapture: (e: PointerEvent) => void;
	onpointerupcapture: (e: PointerEvent) => void;
	onclickcapture: (e: MouseEvent) => void;
	ondblclickcapture: (e: MouseEvent) => void;
}

/**
 * Capture-phase handlers for a viewer pane: a left press on an inactive pane only activates it.
 * The whole gesture (down, up, click, and a double-click it starts) is stopped before the canvas,
 * its tools or its camera controls see it, so activating never deselects, selects or draws.
 * Other buttons and the wheel pass through, so panning and zooming work without activating first.
 */
export function firstPressActivates(
	isActive: () => boolean,
	activate: () => void
): FirstPressHandlers {
	let swallowedPointer: number | null = null;
	let activatedAt = -Infinity;

	const stop = (e: Event) => {
		e.stopPropagation();
		e.preventDefault();
	};

	return {
		onpointerdowncapture(e) {
			swallowedPointer = null;
			if (e.button !== 0 || isActive()) return;
			activate();
			swallowedPointer = e.pointerId;
			activatedAt = e.timeStamp;
			stop(e);
		},
		onpointerupcapture(e) {
			if (e.pointerId === swallowedPointer) stop(e);
		},
		onclickcapture(e) {
			if (swallowedPointer === null) return;
			swallowedPointer = null;
			stop(e);
		},
		ondblclickcapture(e) {
			if (e.timeStamp - activatedAt < ACTIVATION_DBLCLICK_MS) stop(e);
		},
	};
}
