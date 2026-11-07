import { describe, expect, it } from 'vitest';

import { evenSize, fitVerticalFovDeg, videoFrameIndices } from './replayVideoExport';

describe('videoFrameIndices', () => {
	it('takes every Nth frame of the range, inclusive', () => {
		expect(videoFrameIndices(0, 9, 3)).toEqual([0, 3, 6, 9]);
		expect(videoFrameIndices(2, 4, 1)).toEqual([2, 3, 4]);
	});

	it('leaves out frames known to be unreadable', () => {
		expect(videoFrameIndices(0, 4, 1, (i) => i === 2)).toEqual([0, 1, 3, 4]);
	});

	it('treats a stride below 1 as 1', () => {
		expect(videoFrameIndices(0, 2, 0)).toEqual([0, 1, 2]);
	});
});

describe('evenSize', () => {
	it('rounds both sides down to even', () => {
		expect(evenSize(1921, 1081)).toEqual({ width: 1920, height: 1080 });
		expect(evenSize(1, 1)).toEqual({ width: 2, height: 2 });
	});
});

describe('fitVerticalFovDeg', () => {
	it('keeps the angle for a frame at least as wide as the view', () => {
		expect(fitVerticalFovDeg(50, 1.5, 16 / 9)).toBe(50);
	});

	it('widens the vertical angle so a narrower frame keeps the sides', () => {
		const fov = fitVerticalFovDeg(50, 2, 1);
		const halfWidth = (deg: number, aspect: number) => Math.tan((deg * Math.PI) / 360) * aspect;
		expect(halfWidth(fov, 1)).toBeCloseTo(halfWidth(50, 2), 10);
	});
});
