import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetServerClockForTesting, serverClockOffset } from '../serverClock';

const respond = (body: unknown, ok = true) =>
	vi.fn().mockResolvedValue({ ok, json: async () => body } as Response);

describe('serverClockOffset', () => {
	afterEach(() => {
		resetServerClockForTesting();
		vi.useRealTimers();
	});

	it('measures how far the server clock is ahead, once per page load', async () => {
		vi.useFakeTimers({ now: 1_000 });
		const fetchFn = respond({ now: 61_000 });

		expect(await serverClockOffset(fetchFn)).toBe(60_000);
		expect(await serverClockOffset(fetchFn)).toBe(60_000);
		expect(fetchFn).toHaveBeenCalledTimes(1);
		expect(fetchFn).toHaveBeenCalledWith(
			'/api/time',
			expect.objectContaining({ cache: 'no-store' })
		);
	});

	it('gives null offline and tries again next time', async () => {
		const offline = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

		expect(await serverClockOffset(offline)).toBeNull();
		expect(await serverClockOffset(respond({ now: 'soon' }))).toBeNull();
		expect(await serverClockOffset(respond({}, false))).toBeNull();
		expect(typeof (await serverClockOffset(respond({ now: Date.now() })))).toBe('number');
	});
});
