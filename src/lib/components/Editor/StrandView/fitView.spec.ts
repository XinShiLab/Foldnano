import { describe, expect, it } from 'vitest';
import { fitTransform, unionBounds } from './fitView';

const viewport = { width: 1000, height: 800 };
const opts = { paddingPx: 0, minScale: 0.01, maxScale: 1 };

describe('fitTransform', () => {
	it('zooms out to fit and centres the content', () => {
		const t = fitTransform({ minX: 0, minY: 0, maxX: 4000, maxY: 400 }, viewport, opts);
		expect(t.scale).toBe(0.25);
		expect(t.x).toBe(500 - 2000 * 0.25);
		expect(t.y).toBe(400 - 200 * 0.25);
	});

	it('never goes past maxScale, so a small box is only centred', () => {
		const t = fitTransform({ minX: 100, minY: 100, maxX: 120, maxY: 110 }, viewport, {
			...opts,
			maxScale: 0.5,
		});
		expect(t.scale).toBe(0.5);
		expect(t.x).toBe(500 - 110 * 0.5);
		expect(t.y).toBe(400 - 105 * 0.5);
	});

	it('keeps the padding on screen and respects minScale', () => {
		const padded = fitTransform({ minX: 0, minY: 0, maxX: 800, maxY: 10 }, viewport, {
			...opts,
			paddingPx: 100,
		});
		expect(padded.scale).toBe(1); // (1000 - 200) / 800
		const tiny = fitTransform({ minX: 0, minY: 0, maxX: 1e7, maxY: 10 }, viewport, opts);
		expect(tiny.scale).toBe(0.01);
	});
});

describe('unionBounds', () => {
	it('unions boxes and returns null for none', () => {
		expect(unionBounds([])).toBeNull();
		expect(
			unionBounds([
				{ minX: 0, minY: 5, maxX: 10, maxY: 6 },
				{ minX: -3, minY: 8, maxX: 4, maxY: 20 },
			])
		).toEqual({ minX: -3, minY: 5, maxX: 10, maxY: 20 });
	});
});
