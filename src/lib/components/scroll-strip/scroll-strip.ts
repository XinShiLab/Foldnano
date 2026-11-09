import type { Attachment } from 'svelte/attachments';

/** Width of the edge fade that hints at clipped content, in CSS pixels. */
const FADE_PX = 20;
/** Pixels a `DOM_DELTA_LINE` wheel step scrolls (Firefox / some Windows mice). */
const LINE_PX = 16;

/** Pixel distance `event` asks to scroll `el` horizontally; 0 when it is not a vertical-wheel gesture. */
export function verticalWheelToHorizontalPx(event: WheelEvent, el: HTMLElement): number {
	// Trackpad pinch-zoom arrives as ctrl+wheel; horizontal gestures scroll natively.
	if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return 0;
	switch (event.deltaMode) {
		case WheelEvent.DOM_DELTA_LINE:
			return event.deltaY * LINE_PX;
		case WheelEvent.DOM_DELTA_PAGE:
			return event.deltaY * el.clientWidth;
		default:
			return event.deltaY;
	}
}

/** Mask that fades whichever edges of `el` have content scrolled past them; `''` when none. */
export function edgeFadeMask(el: HTMLElement): string {
	const max = el.scrollWidth - el.clientWidth;
	const fadeStart = max > 1 && el.scrollLeft > 1;
	const fadeEnd = max > 1 && el.scrollLeft < max - 1;
	if (!fadeStart && !fadeEnd) return '';
	const start = fadeStart ? `transparent, #000 ${FADE_PX}px` : '#000';
	const end = fadeEnd ? `#000 calc(100% - ${FADE_PX}px), transparent` : '#000';
	return `linear-gradient(to right, ${start}, ${end})`;
}

/**
 * For a horizontally scrolling strip with a hidden scrollbar (toolbars, tab rows): a plain
 * vertical mouse wheel scrolls it sideways, and its edges fade while content is clipped there.
 */
export const scrollStrip: Attachment<HTMLElement> = (el) => {
	// The strip may live in a pop-out window; observers must come from that window's realm.
	const view = el.ownerDocument.defaultView ?? window;
	const updateFade = (): void => {
		el.style.maskImage = edgeFadeMask(el);
	};

	const onWheel = (event: WheelEvent): void => {
		const px = verticalWheelToHorizontalPx(event, el);
		if (px === 0) return;
		const max = el.scrollWidth - el.clientWidth;
		// At the end of travel, let the wheel fall through to whatever is underneath.
		if ((px < 0 && el.scrollLeft <= 0) || (px > 0 && el.scrollLeft >= max - 1)) return;
		event.preventDefault();
		el.scrollLeft += px;
	};

	// Content can grow without the strip resizing (buttons appear per mode/region), so watch children too.
	const resizeObserver = new view.ResizeObserver(updateFade);
	const observeAll = (): void => {
		resizeObserver.disconnect();
		resizeObserver.observe(el);
		for (const child of el.children) resizeObserver.observe(child);
		updateFade();
	};
	const mutationObserver = new view.MutationObserver(observeAll);

	el.addEventListener('wheel', onWheel, { passive: false });
	el.addEventListener('scroll', updateFade, { passive: true });
	mutationObserver.observe(el, { childList: true });
	observeAll();

	return () => {
		el.removeEventListener('wheel', onWheel);
		el.removeEventListener('scroll', updateFade);
		mutationObserver.disconnect();
		resizeObserver.disconnect();
		el.style.maskImage = '';
	};
};
