/** One oxDNA time unit in ps; coarse-grained dynamics run faster than real DNA. */
export const OXDNA_TIME_UNIT_PS = 3.03;

/** The `dt` most oxDNA example inputs use; the user sets theirs, as it is not in the trajectory. */
export const DEFAULT_OXDNA_DT = 0.003;

/** A frame header's `t` is the MD step; real time is step × dt × one time unit. */
export function stepToSeconds(step: number, dt: number): number {
	return step * dt * OXDNA_TIME_UNIT_PS * 1e-12;
}

const UNITS: readonly [number, string][] = [
	[1, 's'],
	[1e-3, 'ms'],
	[1e-6, 'µs'],
	[1e-9, 'ns'],
	[1e-12, 'ps'],
	[1e-15, 'fs'],
];

/** Three significant digits in the largest unit that keeps the value at or above 1. */
export function formatRealTime(seconds: number): string {
	if (!Number.isFinite(seconds)) return '–';
	if (seconds === 0) return '0 s';
	const [scale, unit] = UNITS.find(([s]) => Math.abs(seconds) >= s) ?? UNITS[UNITS.length - 1];
	return `${Number((seconds / scale).toPrecision(3))} ${unit}`;
}
