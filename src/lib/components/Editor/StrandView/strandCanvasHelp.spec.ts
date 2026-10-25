import type Konva from 'konva';
import { afterEach, describe, expect, it } from 'vitest';

import { canvasHelpRegistry } from '$lib/components/help/help';
import type { Part } from '$lib/model/Part';
import type { DrawingDimensions } from './drawingDimensions';
import { registerStrandCanvasHelp } from './strandCanvasHelp';
import type { VisibleStrandRow } from './strandRowLayout';

const RADIUS = 16;
const PITCH = 3 * RADIUS;

function fakeStage(y = 0): Konva.Stage {
	const container = { getBoundingClientRect: () => ({ left: 0, top: 0 }) as DOMRect };
	return {
		scaleX: () => 1,
		x: () => 0,
		y: () => y,
		height: () => 800,
		container: () => container,
	} as unknown as Konva.Stage;
}

// A design with one region header followed by `vhCount` helix rows; counts row lookups.
function fakeDimensions(vhCount: number) {
	const counter = { lookups: 0 };
	const rowY = (i: number) => RADIUS + 20 + i * PITCH;
	const d = {
		dimensions: { radius: RADIUS, sideLength: 12, strokeWidth: 1 },
		getRowYByRowIdx: rowY,
		getRowIdxByY: (y: number) => Math.floor((y - 20) / PITCH),
		getXByBpIdx: (bp: number) => 4 * RADIUS + bp * 12,
		getRowAtDisplayRow: (i: number): VisibleStrandRow | null => {
			counter.lookups++;
			if (i < 0 || i > vhCount) return null;
			if (i === 0) {
				return {
					kind: 'REGION_HEADER',
					displayRow: 0,
					regionId: 'r1',
					regionName: 'Region 1',
					vhCount,
					isCollapsed: false,
				} as unknown as VisibleStrandRow;
			}
			return {
				kind: 'VH',
				displayRow: i,
				regionId: 'r1',
				regionRow: i - 1,
			} as unknown as VisibleStrandRow;
		},
	} as unknown as DrawingDimensions;
	return { d, counter };
}

const part = { maxBase: 42, regions: [{ id: 'r1', maxBase: 42 }] } as unknown as Part;
const host = {} as HTMLElement;

function rects() {
	return [...canvasHelpRegistry].map(([anchor, spec]) => [spec.title, anchor.getRect()] as const);
}

describe('registerStrandCanvasHelp', () => {
	let unregister: (() => void) | undefined;
	afterEach(() => unregister?.());

	it('registers one note each for the header, plane icon and helix tag', () => {
		const { d } = fakeDimensions(5);
		unregister = registerStrandCanvasHelp(host, fakeStage(), d, part);
		const titles = rects().map(([title]) => title);
		expect(titles).toEqual(['Region header', 'Base plane', 'Helix tag']);
		expect(rects().every(([, rect]) => rect !== null)).toBe(true);
	});

	it('scans a bounded number of rows in a large design scrolled past every header', () => {
		const { d, counter } = fakeDimensions(10_000);
		// Scrolled well into the region: the only header is far above the viewport.
		unregister = registerStrandCanvasHelp(host, fakeStage(-5000 * PITCH), d, part);
		const [[, header], , [, tag]] = rects();
		expect(header).toBeNull();
		expect(tag).not.toBeNull();
		// Three getRect calls; each scan stops at the viewport bottom, never walking the design.
		expect(counter.lookups).toBeLessThan(3 * 64);
	});

	it('removes its notes on unregister', () => {
		const { d } = fakeDimensions(5);
		registerStrandCanvasHelp(host, fakeStage(), d, part)();
		expect(canvasHelpRegistry.size).toBe(0);
	});
});
