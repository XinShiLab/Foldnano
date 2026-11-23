import { describe, expect, it } from 'vitest';
import { classifyWheel, type WheelContext } from './mouseHandler';

function wheel(init: WheelEventInit): WheelEvent {
	return new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
}

const SELECT: WheelContext = { panMode: false, pageWidth: 800, pageHeight: 600 };
const PAN: WheelContext = { ...SELECT, panMode: true };

describe('classifyWheel outside pan mode', () => {
	it('zooms on a vertical wheel', () => {
		expect(classifyWheel(wheel({ deltaY: 100 }), SELECT)).toEqual({ kind: 'zoom', direction: 1 });
		expect(classifyWheel(wheel({ deltaY: -100 }), SELECT)).toEqual({
			kind: 'zoom',
			direction: -1,
		});
	});

	it('pans sideways on a horizontal wheel instead of zooming out', () => {
		expect(classifyWheel(wheel({ deltaX: 120 }), SELECT)).toEqual({ kind: 'pan', dx: 120, dy: 0 });
		expect(classifyWheel(wheel({ deltaX: -30, deltaY: 4 }), SELECT)).toEqual({
			kind: 'pan',
			dx: -30,
			dy: 0,
		});
	});

	it('pans sideways on Shift + vertical wheel when the browser leaves it vertical', () => {
		expect(classifyWheel(wheel({ deltaY: 100, shiftKey: true }), SELECT)).toEqual({
			kind: 'pan',
			dx: 100,
			dy: 0,
		});
	});

	it('pans both ways with Alt held, even without the PAN tool', () => {
		expect(classifyWheel(wheel({ deltaY: 40, altKey: true }), SELECT)).toEqual({
			kind: 'pan',
			dx: 0,
			dy: 40,
		});
	});

	it('does nothing for an empty event', () => {
		expect(classifyWheel(wheel({}), SELECT)).toEqual({ kind: 'none' });
	});
});

describe('classifyWheel in pan mode', () => {
	it('scrolls vertically and horizontally', () => {
		expect(classifyWheel(wheel({ deltaY: 100 }), PAN)).toEqual({ kind: 'pan', dx: 0, dy: 100 });
		expect(classifyWheel(wheel({ deltaX: 12, deltaY: -8 }), PAN)).toEqual({
			kind: 'pan',
			dx: 12,
			dy: -8,
		});
		expect(classifyWheel(wheel({ deltaY: 100, shiftKey: true }), PAN)).toEqual({
			kind: 'pan',
			dx: 100,
			dy: 0,
		});
	});

	it('scales line- and page-mode deltas per axis', () => {
		const line = wheel({ deltaX: 3, deltaY: 1, deltaMode: WheelEvent.DOM_DELTA_LINE });
		const page = wheel({ deltaY: -1, deltaMode: WheelEvent.DOM_DELTA_PAGE });
		expect(classifyWheel(line, PAN)).toEqual({ kind: 'pan', dx: 48, dy: 16 });
		expect(classifyWheel(page, PAN)).toEqual({ kind: 'pan', dx: 0, dy: -600 });
	});
});

describe('classifyWheel with Ctrl/Cmd', () => {
	it('zooms in every mode, wheel up zooming in (also trackpad pinch)', () => {
		for (const ctx of [SELECT, PAN]) {
			expect(classifyWheel(wheel({ deltaY: -5, ctrlKey: true }), ctx)).toEqual({
				kind: 'zoom',
				direction: 1,
			});
			expect(classifyWheel(wheel({ deltaY: 100, metaKey: true }), ctx)).toEqual({
				kind: 'zoom',
				direction: -1,
			});
		}
	});

	it('ignores a horizontal-only event', () => {
		expect(classifyWheel(wheel({ deltaX: 50, ctrlKey: true }), PAN)).toEqual({ kind: 'none' });
	});
});
