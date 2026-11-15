import { describe, expect, it } from 'vitest';
import { nextRenderWindow, stageViewRect } from './renderWindow';

const viewport = { x: 0, y: 0, width: 1000, height: 800 };

describe('nextRenderWindow', () => {
	it('keeps the same object while the viewport stays inside it', () => {
		const first = nextRenderWindow({ x: 0, y: 0, width: 0, height: 0 }, viewport);
		expect(first).toEqual({ x: -250, y: -200, width: 1500, height: 1200 });
		expect(nextRenderWindow(first, { ...viewport, x: 150, y: -100 })).toBe(first);
	});

	it('moves before the viewport reaches the edge', () => {
		const first = nextRenderWindow({ x: 0, y: 0, width: 0, height: 0 }, viewport);
		const panned = { ...viewport, x: 210 };
		const next = nextRenderWindow(first, panned);
		expect(next).not.toBe(first);
		expect(next.x).toBe(panned.x - 250);
	});

	it('grows on zoom out and tightens after a large zoom in', () => {
		const first = nextRenderWindow({ x: 0, y: 0, width: 0, height: 0 }, viewport);
		const zoomedOut = { x: -500, y: -400, width: 2000, height: 1600 };
		expect(nextRenderWindow(first, zoomedOut).width).toBe(3000);
		const slightlyIn = { x: 100, y: 100, width: 800, height: 640 };
		expect(nextRenderWindow(first, slightlyIn)).toBe(first);
		const farIn = { x: 400, y: 300, width: 200, height: 160 };
		expect(nextRenderWindow(first, farIn).width).toBe(300);
	});
});

describe('stageViewRect', () => {
	it('maps the stage transform to world space', () => {
		const stage = {
			x: () => -200,
			y: () => 100,
			scaleX: () => 2,
			width: () => 1000,
			height: () => 800,
		};
		expect(stageViewRect(stage)).toEqual({ x: 100, y: -50, width: 500, height: 400 });
	});
});
