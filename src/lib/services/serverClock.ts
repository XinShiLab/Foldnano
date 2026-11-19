import type { ClockSource } from '$lib/model/exportStamp';

const TIMEOUT_MS = 3000;

let offset: Promise<number | null> | null = null;

async function measureOffset(fetchFn: typeof fetch): Promise<number | null> {
	try {
		const start = Date.now();
		const response = await fetchFn('/api/time', {
			cache: 'no-store',
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		const end = Date.now();
		if (!response.ok) return null;
		const { now } = (await response.json()) as { now?: unknown };
		if (typeof now !== 'number' || !Number.isFinite(now)) return null;
		// The server read its clock about halfway through the round trip.
		return now - (start + end) / 2;
	} catch {
		return null;
	}
}

/**
 * How far this computer's clock is behind the server's, in ms; null when the server can't be
 * reached. Measured once per page load; a failed measurement is retried on the next call.
 */
export function serverClockOffset(fetchFn: typeof fetch = fetch): Promise<number | null> {
	offset ??= measureOffset(fetchFn).then((value) => {
		if (value === null) offset = null;
		return value;
	});
	return offset;
}

/** The current time, from the server's clock when it can be reached. */
export async function trustedNow(): Promise<{ at: number; clock: ClockSource }> {
	const delta = await serverClockOffset();
	return delta === null
		? { at: Date.now(), clock: 'local' }
		: { at: Date.now() + delta, clock: 'server' };
}

export function resetServerClockForTesting(): void {
	offset = null;
}
