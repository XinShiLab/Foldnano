import { describe, expect, it } from 'vitest';

import { leaderLine, overlaps, placeNotes, type NoteRequest, type Rect } from './helpLayout';

const viewport = { width: 1200, height: 800 };

function rect(left: number, top: number, width: number, height: number): Rect {
	return { left, top, width, height };
}

function note(key: string, target: Rect, placement: NoteRequest<string>['placement']) {
	return { key, target, width: 200, height: 60, placement };
}

describe('placeNotes', () => {
	it('keeps an uncontested note at its preferred spot', () => {
		const placed = placeNotes([note('a', rect(500, 100, 300, 300), 'inside')], [], viewport);
		expect(placed.get('a')).toEqual(rect(508, 108, 200, 60));
	});

	it('never lets notes overlap each other or obstacles', () => {
		const target = rect(500, 100, 300, 300);
		const obstacle = rect(500, 160, 400, 100);
		const placed = placeNotes(
			[note('a', target, 'inside'), note('b', target, 'inside'), note('c', target, 'inside')],
			[obstacle],
			viewport
		);
		const rects = [...placed.values()];
		for (const r of rects) expect(overlaps(r, obstacle)).toBe(false);
		for (let i = 0; i < rects.length; i++)
			for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i], rects[j])).toBe(false);
	});

	it('slides along the preferred side before switching sides', () => {
		const target = rect(600, 200, 100, 100);
		const placed = placeNotes([note('a', target, 'left'), note('b', target, 'left')], [], viewport);
		const b = placed.get('b')!;
		expect(b.left).toBe(600 - 200 - 8);
		expect(b.top).not.toBe(200);
	});

	it('stays inside the viewport', () => {
		const placed = placeNotes([note('a', rect(0, 0, 40, 40), 'left')], [], viewport);
		const a = placed.get('a')!;
		expect(a.left).toBeGreaterThanOrEqual(8);
		expect(a.top).toBeGreaterThanOrEqual(8);
	});
});

describe('leaderLine', () => {
	it('is null when the note sits on its target', () => {
		expect(leaderLine(rect(10, 10, 50, 20), rect(0, 0, 100, 100))).toBeNull();
	});

	it('runs from the note edge to the nearest target edge', () => {
		expect(leaderLine(rect(0, 0, 100, 40), rect(200, 0, 100, 40))).toEqual({
			x1: 100,
			y1: 20,
			x2: 200,
			y2: 20,
		});
	});
});
