import { describe, expect, it, vi } from 'vitest';
import { firstPressActivates } from './firstPressActivates';

function fakeEvent(init: { button?: number; pointerId?: number; timeStamp?: number } = {}) {
	return {
		button: init.button ?? 0,
		pointerId: init.pointerId ?? 1,
		timeStamp: init.timeStamp ?? 0,
		stopPropagation: vi.fn(),
		preventDefault: vi.fn(),
	} as unknown as PointerEvent & { stopPropagation: ReturnType<typeof vi.fn> };
}

describe('firstPressActivates', () => {
	it('swallows the whole first left-click gesture on an inactive pane and activates it', () => {
		let active = false;
		const h = firstPressActivates(
			() => active,
			() => (active = true)
		);
		const down = fakeEvent({ timeStamp: 100 });
		const up = fakeEvent({ timeStamp: 150 });
		const click = fakeEvent({ timeStamp: 151 });
		h.onpointerdowncapture(down);
		h.onpointerupcapture(up);
		h.onclickcapture(click);

		expect(active).toBe(true);
		for (const e of [down, up, click]) expect(e.stopPropagation).toHaveBeenCalled();
	});

	it('lets the next click through once the pane is active, but not a double-click it started', () => {
		let active = false;
		const h = firstPressActivates(
			() => active,
			() => (active = true)
		);
		h.onpointerdowncapture(fakeEvent({ timeStamp: 100 }));
		h.onclickcapture(fakeEvent({ timeStamp: 150 }));

		const down = fakeEvent({ timeStamp: 250 });
		const click = fakeEvent({ timeStamp: 300 });
		const dblclick = fakeEvent({ timeStamp: 301 });
		h.onpointerdowncapture(down);
		h.onclickcapture(click);
		h.ondblclickcapture(dblclick);
		expect(down.stopPropagation).not.toHaveBeenCalled();
		expect(click.stopPropagation).not.toHaveBeenCalled();
		expect(dblclick.stopPropagation).toHaveBeenCalled();

		const laterDbl = fakeEvent({ timeStamp: 2000 });
		h.ondblclickcapture(laterDbl);
		expect(laterDbl.stopPropagation).not.toHaveBeenCalled();
	});

	it('passes other buttons straight through without activating', () => {
		let active = false;
		const activate = vi.fn(() => (active = true));
		const h = firstPressActivates(() => active, activate);
		const right = fakeEvent({ button: 2 });
		h.onpointerdowncapture(right);
		expect(activate).not.toHaveBeenCalled();
		expect(right.stopPropagation).not.toHaveBeenCalled();
	});

	it("forgets a swallowed press whose click never came, so it can't eat a later click", () => {
		let active = false;
		const h = firstPressActivates(
			() => active,
			() => (active = true)
		);
		h.onpointerdowncapture(fakeEvent()); // released outside: no click
		h.onpointerdowncapture(fakeEvent({ timeStamp: 1000 }));
		const click = fakeEvent({ timeStamp: 1050 });
		h.onclickcapture(click);
		expect(click.stopPropagation).not.toHaveBeenCalled();
	});
});
