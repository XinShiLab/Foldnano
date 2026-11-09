import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { edgeFadeMask, scrollStrip, verticalWheelToHorizontalPx } from './scroll-strip';

function makeStrip(scrollWidth: number, clientWidth: number, scrollLeft = 0): HTMLDivElement {
	const el = document.createElement('div');
	Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scrollWidth });
	Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth });
	el.scrollLeft = scrollLeft;
	document.body.append(el);
	return el;
}

function wheel(init: WheelEventInit): WheelEvent {
	return new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
}

describe('verticalWheelToHorizontalPx', () => {
	const el = makeStrip(500, 200);

	it('passes pixel-mode vertical deltas through', () => {
		expect(verticalWheelToHorizontalPx(wheel({ deltaY: 100 }), el)).toBe(100);
	});

	it('scales line- and page-mode deltas', () => {
		const line = wheel({ deltaY: 3, deltaMode: WheelEvent.DOM_DELTA_LINE });
		const page = wheel({ deltaY: -1, deltaMode: WheelEvent.DOM_DELTA_PAGE });
		expect(verticalWheelToHorizontalPx(line, el)).toBe(48);
		expect(verticalWheelToHorizontalPx(page, el)).toBe(-200);
	});

	it('ignores horizontal-dominant gestures and ctrl+wheel pinch', () => {
		expect(verticalWheelToHorizontalPx(wheel({ deltaX: 40, deltaY: 10 }), el)).toBe(0);
		expect(verticalWheelToHorizontalPx(wheel({ deltaY: 100, ctrlKey: true }), el)).toBe(0);
	});
});

describe('edgeFadeMask', () => {
	it('is empty when nothing overflows', () => {
		expect(edgeFadeMask(makeStrip(200, 200))).toBe('');
	});

	it('fades only the edges that hide content', () => {
		const atStart = edgeFadeMask(makeStrip(500, 200, 0));
		expect(atStart.startsWith('linear-gradient(to right, #000,')).toBe(true);
		expect(atStart.endsWith('transparent)')).toBe(true);

		const atEnd = edgeFadeMask(makeStrip(500, 200, 300));
		expect(atEnd.startsWith('linear-gradient(to right, transparent,')).toBe(true);
		expect(atEnd.endsWith('#000)')).toBe(true);

		const middle = edgeFadeMask(makeStrip(500, 200, 150));
		expect(middle).toMatch(/^linear-gradient\(to right, transparent,.*transparent\)$/);
	});
});

describe('scrollStrip attachment', () => {
	beforeEach(() => {
		vi.stubGlobal(
			'ResizeObserver',
			class {
				observe(): void {}
				disconnect(): void {}
			}
		);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		document.body.replaceChildren();
	});

	it('scrolls sideways on a vertical wheel and consumes the event', () => {
		const el = makeStrip(500, 200);
		scrollStrip(el);
		const event = wheel({ deltaY: 100 });
		el.dispatchEvent(event);
		expect(el.scrollLeft).toBe(100);
		expect(event.defaultPrevented).toBe(true);
	});

	it('lets the wheel fall through at the end of travel or without overflow', () => {
		const atEnd = makeStrip(500, 200, 300);
		scrollStrip(atEnd);
		const pastEnd = wheel({ deltaY: 100 });
		atEnd.dispatchEvent(pastEnd);
		expect(pastEnd.defaultPrevented).toBe(false);

		const fits = makeStrip(200, 200);
		scrollStrip(fits);
		const noOverflow = wheel({ deltaY: 100 });
		fits.dispatchEvent(noOverflow);
		expect(noOverflow.defaultPrevented).toBe(false);
	});

	it('sets the fade on attach and clears it on cleanup', () => {
		const el = makeStrip(500, 200);
		const cleanup = scrollStrip(el);
		expect(el.style.maskImage).not.toBe('');
		cleanup?.();
		expect(el.style.maskImage).toBe('');
	});
});
