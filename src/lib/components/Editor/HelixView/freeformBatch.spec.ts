import { describe, expect, it, vi } from 'vitest';
import {
	drawFreeformScene,
	FIXED_SIZE_FROM_SCALE,
	pickVhAt,
	screenSizeFactor,
	type FreeformScene,
	type SceneHelix,
	type SceneTheme,
} from './freeformBatch';
import { helixCircleLabelFontSize } from './utils';

const theme: SceneTheme = {
	outline: '#000',
	label: '#000',
	helixFill: '#fff',
	helixStroke: '#000',
	helixLabel: '#000',
	scafIndicator: '#000',
	crossoverDotFill: '#fff',
};

const perpendicular = (vhIndex: number, x: number, y: number): SceneHelix => ({
	kind: 'perpendicular',
	vhIndex,
	x,
	y,
	opacity: 1,
	bounds: { minX: x - 10, minY: y - 10, maxX: x + 10, maxY: y + 10 },
	scafStartDeg: 0,
	scafBpDeg: 34.3,
});

// Horizontal in-plane helix from (x, y) to (x + lengthPx, y).
const inPlane = (vhIndex: number, x: number, y: number, lengthPx: number): SceneHelix => ({
	kind: 'inPlane',
	vhIndex,
	x,
	y,
	opacity: 1,
	bounds: { minX: x, minY: y - 10, maxX: x + lengthPx, maxY: y + 10 },
	angleRad: 0,
	lengthPx,
	strands: [{ fiveX: 0, threeX: lengthPx, strandIdx: 0, color: '#f00', opacity: 1 }],
});

function mockContext() {
	const calls: string[] = [];
	const record = (name: string) =>
		vi.fn(() => {
			calls.push(name);
		});
	const ctx = {
		save: record('save'),
		restore: record('restore'),
		translate: record('translate'),
		rotate: record('rotate'),
		beginPath: record('beginPath'),
		closePath: record('closePath'),
		moveTo: record('moveTo'),
		lineTo: record('lineTo'),
		arcTo: record('arcTo'),
		arc: record('arc'),
		quadraticCurveTo: record('quadraticCurveTo'),
		stroke: record('stroke'),
		fill: record('fill'),
		fillRect: record('fillRect'),
		fillText: record('fillText'),
	};
	return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

describe('pickVhAt', () => {
	it('returns the helix under the point and null on empty space', () => {
		const helices = [perpendicular(1, 0, 0), inPlane(2, 100, 0, 200)];
		expect(pickVhAt(helices, { x: 3, y: -4 })).toBe(1);
		expect(pickVhAt(helices, { x: 250, y: 6 })).toBe(2);
		expect(pickVhAt(helices, { x: 50, y: 50 })).toBeNull();
	});

	it('prefers the nearer helix (drawn last) where helices overlap', () => {
		const helices = [inPlane(1, 0, 0, 100), perpendicular(2, 50, 0)];
		expect(pickVhAt(helices, { x: 50, y: 0 })).toBe(2);
		expect(pickVhAt([...helices].reverse(), { x: 50, y: 0 })).toBe(1);
	});

	it('tests the rotated rectangle, not its bounding box', () => {
		const diagonal: SceneHelix = {
			...(inPlane(1, 0, 0, 100) as Extract<SceneHelix, { kind: 'inPlane' }>),
			angleRad: Math.PI / 4,
			bounds: { minX: -8, minY: -8, maxX: 78, maxY: 78 },
		};
		expect(pickVhAt([diagonal], { x: 35, y: 35 })).toBe(1);
		expect(pickVhAt([diagonal], { x: 70, y: 5 })).toBeNull();
	});
});

describe('drawFreeformScene', () => {
	const scene: FreeformScene = {
		helices: [perpendicular(1, 0, 0), inPlane(2, 1000, 0, 100)],
		crossovers: [],
		theme,
	};

	it('skips helices outside the window', () => {
		const { ctx, calls } = mockContext();
		drawFreeformScene(ctx, scene, {
			window: { minX: -50, minY: -50, maxX: 50, maxY: 50 },
			detail: true,
			cursorIdx: 0,
			scale: 1,
		});
		expect(calls.filter((c) => c === 'arc')).toHaveLength(1);
		expect(calls).not.toContain('rotate');
	});

	it('drops labels and end markers below detail zoom', () => {
		const window = { minX: -50, minY: -50, maxX: 2000, maxY: 50 };
		const detailed = mockContext();
		drawFreeformScene(detailed.ctx, scene, { window, detail: true, cursorIdx: 0, scale: 1 });
		const coarse = mockContext();
		drawFreeformScene(coarse.ctx, scene, { window, detail: false, cursorIdx: 0, scale: 1 });
		expect(detailed.calls.filter((c) => c === 'fillText')).toHaveLength(2);
		expect(detailed.calls).toContain('fillRect');
		expect(coarse.calls).not.toContain('fillText');
		expect(coarse.calls).not.toContain('fillRect');
	});
});

describe('screenSizeFactor', () => {
	it('scales with zoom up to the threshold, then keeps on-screen size fixed', () => {
		expect(screenSizeFactor(0.5)).toBe(1);
		expect(screenSizeFactor(FIXED_SIZE_FROM_SCALE)).toBe(1);
		for (const scale of [2, 5, 20]) {
			expect(screenSizeFactor(scale) * scale).toBeCloseTo(FIXED_SIZE_FROM_SCALE);
		}
	});

	it('draws thinner layer-space strands when zoomed in past the threshold', () => {
		const widths: number[] = [];
		const { ctx } = mockContext();
		Object.defineProperty(ctx, 'lineWidth', { set: (w: number) => widths.push(w) });
		const scene: FreeformScene = { helices: [inPlane(1, 0, 0, 100)], crossovers: [], theme };
		const window = { minX: -50, minY: -50, maxX: 200, maxY: 50 };
		drawFreeformScene(ctx, scene, { window, detail: false, cursorIdx: 0, scale: 4 });
		expect(Math.max(...widths)).toBeCloseTo(2 / 4);
	});
});

describe('helixCircleLabelFontSize', () => {
	it('shrinks labels of three or more digits', () => {
		expect(helixCircleLabelFontSize('42')).toBe(10);
		expect(helixCircleLabelFontSize('123')).toBeLessThan(10);
		expect(helixCircleLabelFontSize('1234')).toBeLessThan(helixCircleLabelFontSize('123'));
	});
});
