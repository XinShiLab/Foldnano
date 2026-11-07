import { describe, expect, it } from 'vitest';

import { formatRealTime, stepToSeconds } from '$lib/model/oxdnaReplay/oxdnaTime';

describe('stepToSeconds', () => {
	it('multiplies the step by dt and 3.03 ps', () => {
		expect(stepToSeconds(44_500_000, 0.003)).toBeCloseTo(404.505e-9, 15);
		expect(stepToSeconds(1, 1)).toBeCloseTo(3.03e-12, 20);
	});
});

describe('formatRealTime', () => {
	it('picks the unit that keeps three significant digits above 1', () => {
		expect(formatRealTime(404.505e-9)).toBe('405 ns');
		expect(formatRealTime(1.2345e-6)).toBe('1.23 µs');
		expect(formatRealTime(3.03e-12)).toBe('3.03 ps');
		expect(formatRealTime(0)).toBe('0 s');
		expect(formatRealTime(2.5)).toBe('2.5 s');
	});
});
