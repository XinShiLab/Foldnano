import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { makeHoneycombPart, addLatticeVh } from '$lib/model/test/testHelpers';
import type { SegmentEnd } from '$lib/model/Oligo';
import type { Category, LeafTarget } from '$lib/canvasEditor/core/modes';
import { buildScene, LINE_WIDTH } from './helixGeometry';
import { createHoverGlow } from './hoverGlow';
import { GLOW_STENCIL_REF } from './drawOncePerPixel';
import { formatHoverFootnote } from '$lib/canvasEditor/tools/behaviors/hoverInfo';
import {
	LinePickIndexBuilder,
	applyPick,
	boxPickedEnds,
	hasPickableKind,
	isPickable,
	itemsCoveredBy,
	itemsInRect,
	pickLine,
	piecesOf,
	pickedEnds,
	type LinePickItem,
} from './linePick';

function withMockCanvas<T>(fn: () => T): T {
	const originalGetContext = HTMLCanvasElement.prototype.getContext;
	const mockContext = {
		clearRect() {},
		fillText() {},
	} as unknown as CanvasRenderingContext2D;
	HTMLCanvasElement.prototype.getContext = (() =>
		mockContext) as unknown as typeof HTMLCanvasElement.prototype.getContext;
	try {
		return fn();
	} finally {
		HTMLCanvasElement.prototype.getContext = originalGetContext;
	}
}

// 100×100 px viewport where one world unit is one pixel: world (x, y) lands at (x + 50, 50 - y).
function orthoViewProjection(): THREE.Matrix4 {
	const camera = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.1, 1000);
	camera.position.set(0, 0, 100);
	camera.lookAt(0, 0, 0);
	camera.updateMatrixWorld();
	camera.updateProjectionMatrix();
	return new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
}

const filterOf = (...keys: (LeafTarget | Category)[]) => new Set<LeafTarget | Category>(keys);

function twoOligoPart() {
	const part = makeHoneycombPart('pick');
	const vhA = addLatticeVh(part, 0, 0);
	const vhB = addLatticeVh(part, 0, 1);
	const scaffold = part.createOligo(vhA, 0, 10, '#ff0000');
	scaffold.isScaffold = true;
	const staple = part.createOligo(vhB, 0, 10, '#00ff00');
	return { part, scaffold, staple };
}

describe('pickLine', () => {
	const query = { width: 100, height: 100, radiusPx: 4, viewProjection: orthoViewProjection() };
	const fake = (name: string) =>
		({ kind: 'segment', segment: { id: name } }) as unknown as LinePickItem;
	// One item with one piece along x at height y and depth z, bases 0..20 left to right.
	const addLine = (b: LinePickIndexBuilder, name: string, y: number, z = 0) => {
		const item = b.addItem(fake(name));
		b.addPiece(item, [-10, y, z], [10, y, z], 0, 20);
		return item;
	};

	it('picks the closest piece within the pixel radius and interpolates the base', () => {
		const b = new LinePickIndexBuilder();
		const near = addLine(b, 'near', 0);
		addLine(b, 'far', 3);
		const index = b.build();

		const hit = pickLine(index, { ...query, x: 55, y: 49 });
		expect(hit?.itemIndex).toBe(near);
		expect(hit?.bp).toBe(15);
		expect(pickLine(index, { ...query, x: 55, y: 30 })).toBeNull();
	});

	it('settles equal screen distances by depth, front-most first', () => {
		const b = new LinePickIndexBuilder();
		addLine(b, 'back', 0, -20);
		const front = addLine(b, 'front', 0, 20);
		const index = b.build();

		expect(pickLine(index, { ...query, x: 50, y: 50 })?.itemIndex).toBe(front);
	});

	it('skips items the accept filter rejects', () => {
		const b = new LinePickIndexBuilder();
		const front = addLine(b, 'front', 0, 20);
		const back = addLine(b, 'back', 0, -20);
		const index = b.build();

		const hit = pickLine(index, {
			...query,
			x: 50,
			y: 50,
			accept: (item) => item !== index.items[front],
		});
		expect(hit?.itemIndex).toBe(back);
	});

	it('keeps a sticky hover until another item is clearly closer', () => {
		const b = new LinePickIndexBuilder();
		const upper = addLine(b, 'upper', 1);
		const lower = addLine(b, 'lower', -1);
		const index = b.build();
		const sticky = { itemIndex: upper, marginPx: 2 };

		// Pointer slightly nearer the lower line: plain pick switches, sticky pick holds.
		expect(pickLine(index, { ...query, x: 50, y: 50.5 })?.itemIndex).toBe(lower);
		expect(pickLine(index, { ...query, x: 50, y: 50.5, sticky })?.itemIndex).toBe(upper);
		// Out of the sticky item's radius: it lets go.
		expect(pickLine(index, { ...query, x: 50, y: 53.5, sticky })?.itemIndex).toBe(lower);
	});

	it('requires pieces to follow their item', () => {
		const b = new LinePickIndexBuilder();
		const first = b.addItem(fake('first'));
		b.addItem(fake('second'));
		expect(() => b.addPiece(first, [0, 0, 0], [1, 0, 0], 0, 1)).toThrow();
	});
});

describe('line view pick index', () => {
	it('holds one item per drawn segment and crossover', () => {
		const { part, scaffold, staple } = twoOligoPart();
		[...scaffold.segments][0].threePrime.connectTo([...staple.segments][0].fivePrime);

		const { pickIndex } = withMockCanvas(() => buildScene(part));
		expect(pickIndex).not.toBeNull();
		const kinds = pickIndex!.items.map((item) => item.kind).sort();
		expect(kinds).toEqual(['segment', 'segment', 'xover']);
		expect(pickIndex!.pieceItem.length * 6).toBe(pickIndex!.positions.length);
	});

	it('leaves filtered-out segments unpickable', () => {
		const { part, staple } = twoOligoPart();
		const kept = new Set([...staple.segments]);
		const { pickIndex } = withMockCanvas(() => buildScene(part, false, undefined, kept));
		expect(pickIndex!.items.map((item) => item.segment)).toEqual([...kept]);
	});
});

describe('pickedEnds', () => {
	it('follows the select tool priority: crossover, then oligo, then segment', () => {
		const { part, scaffold, staple } = twoOligoPart();
		const from = [...scaffold.segments][0];
		const to = [...staple.segments][0];
		from.threePrime.connectTo(to.fivePrime);
		const xover: LinePickItem = { kind: 'xover', segment: from, toSegment: to };
		const segment: LinePickItem = { kind: 'segment', segment: from };
		const all = filterOf('SCAF', 'STAP');

		expect(pickedEnds(part, xover, filterOf(...all, 'XOVER', 'OLIGO'), 'NONE')).toEqual([
			from.threePrime,
			to.fivePrime,
		]);
		expect(new Set(pickedEnds(part, xover, filterOf(...all, 'OLIGO'), 'NONE'))).toEqual(
			from.oligo!.allEnds
		);
		expect(
			new Set(pickedEnds(part, segment, filterOf(...all, 'OLIGO', 'SEGMENT'), 'NONE'))
		).toEqual(from.oligo!.allEnds);
		expect(pickedEnds(part, segment, filterOf(...all, 'SEGMENT'), 'NONE')).toEqual([
			from.fivePrime,
			from.threePrime,
		]);
		expect(pickedEnds(part, segment, filterOf(...all, 'XOVER'), 'NONE')).toBeNull();
	});

	it('respects the scaffold/staple filter', () => {
		const { part, scaffold, staple } = twoOligoPart();
		const scafItem: LinePickItem = { kind: 'segment', segment: [...scaffold.segments][0] };
		const stapItem: LinePickItem = { kind: 'segment', segment: [...staple.segments][0] };
		const stapOnly = filterOf('STAP', 'SEGMENT');

		expect(pickedEnds(part, scafItem, stapOnly, 'NONE')).toBeNull();
		expect(isPickable(scafItem, stapOnly)).toBe(false);
		expect(isPickable(stapItem, stapOnly)).toBe(true);
		expect(hasPickableKind(filterOf('SCAF', 'STAP', 'END'))).toBe(false);
	});

	it('grows an oligo pick to same-colour oligos', () => {
		const { part, staple } = twoOligoPart();
		const vh = part.virtualHelices[0];
		const twin = part.createOligo(vh, 20, 30, staple.color);
		const item: LinePickItem = { kind: 'segment', segment: [...staple.segments][0] };
		const ends = pickedEnds(part, item, filterOf('SCAF', 'STAP', 'OLIGO'), 'SAME_COLOR');
		for (const end of twin.allEnds) expect(ends).toContain(end);
	});
});

describe('applyPick', () => {
	function fakeSelection() {
		const ends = new Set<SegmentEnd>();
		return {
			ends,
			set: (e: SegmentEnd[]) => {
				ends.clear();
				e.forEach((x) => ends.add(x));
			},
			add: (e: SegmentEnd[]) => e.forEach((x) => ends.add(x)),
			remove: (e: SegmentEnd[]) => e.forEach((x) => ends.delete(x)),
			includesAll: (e: SegmentEnd[]) => e.every((x) => ends.has(x)),
		};
	}

	it('replaces on a plain click and toggles with Shift', () => {
		const { scaffold, staple } = twoOligoPart();
		const a = [...scaffold.allEnds];
		const b = [...staple.allEnds];
		const sel = fakeSelection();

		applyPick(sel, a, false);
		applyPick(sel, b, false);
		expect([...sel.ends]).toEqual(b);
		applyPick(sel, a, true);
		expect(sel.ends.size).toBe(a.length + b.length);
		applyPick(sel, a, true);
		expect([...sel.ends]).toEqual(b);
	});
});

describe('hover coverage', () => {
	it('finds the items a selection fully covers and gathers their pieces by kind', () => {
		const { part, scaffold, staple } = twoOligoPart();
		const from = [...scaffold.segments][0];
		const to = [...staple.segments][0];
		from.threePrime.connectTo(to.fivePrime);
		const { pickIndex } = withMockCanvas(() => buildScene(part));
		const index = pickIndex!;

		// Selecting just the crossover covers the crossover, not the segments it joins.
		const xoverOnly = itemsCoveredBy(index, new Set([from.threePrime, to.fivePrime]));
		expect(xoverOnly.map((i) => index.items[i].kind)).toEqual(['xover']);

		// connectTo alone doesn't merge the oligos, so take both strands' ends.
		const all = itemsCoveredBy(index, new Set([...scaffold.allEnds, ...staple.allEnds]));
		expect(all).toHaveLength(3);
		const { segments, xovers } = piecesOf(index, all);
		const pieceFloats = (kind: string) =>
			all
				.filter((i) => index.items[i].kind === kind)
				.reduce((sum, i) => sum + index.itemPieceCount[i] * 6, 0);
		expect(segments.length).toBe(pieceFloats('segment'));
		expect(xovers.length).toBe(pieceFloats('xover'));
		expect(xovers.length).toBeGreaterThan(0);
	});
});

describe('formatHoverFootnote', () => {
	it('matches the strand view format and skips plain N inserts', () => {
		expect(formatHoverFootnote({ vhIndex: 3, bp: 42 })).toBe('VH 3 · BP 42');
		expect(
			formatHoverFootnote({ vhIndex: 3, bp: 42, oligoId: 'py-oligo-abcdef123', slotSeq: 'ACGT' })
		).toBe('VH 3 · BP 42 · Oligo abcdef · Insert ACGT');
		expect(formatHoverFootnote({ vhIndex: 3, bp: 42, slotSeq: 'NNN' })).toBe('VH 3 · BP 42');
	});
});

describe('drawOncePerPixel on translucent lines', () => {
	it('gives every dimmed line bucket a stencil mark and leaves solid ones alone', () => {
		const { part, staple } = twoOligoPart();
		const focused = new Set([...staple.segments]);
		const { group } = withMockCanvas(() => buildScene(part, false, undefined, null, focused));
		const materials = group.children
			.filter((c): c is LineSegments2 => c instanceof LineSegments2)
			.map((l) => l.material as LineMaterial);
		const dim = materials.filter((m) => m.transparent);
		const solid = materials.filter((m) => !m.transparent);
		expect(dim.length).toBeGreaterThan(0);
		expect(solid.length).toBeGreaterThan(0);
		for (const m of dim) {
			expect(m.stencilWrite).toBe(true);
			expect(m.stencilFunc).toBe(THREE.NotEqualStencilFunc);
			expect(m.stencilRef).toBeGreaterThan(0);
		}
		for (const m of solid) expect(m.stencilWrite).toBe(false);
	});
});

describe('hover glow mask', () => {
	it('records which pick items are drawn dimmed', () => {
		const { part, staple } = twoOligoPart();
		const focused = new Set([...staple.segments]);
		const { pickIndex } = withMockCanvas(() => buildScene(part, false, undefined, null, focused));
		const dimOf = (i: number) => pickIndex!.itemDim[i];
		pickIndex!.items.forEach((item, i) => expect(dimOf(i)).toBe(focused.has(item.segment) ? 0 : 1));
	});

	it('stamps the glow mark over solid hovered strands before drawing the glow', () => {
		const glow = createHoverGlow();
		const piece = new Float32Array([0, 0, 0, 1, 0, 0]);
		const none = new Float32Array(0);
		glow.set({ segments: piece, xovers: none }, { segments: piece, xovers: none });

		const lines = glow.group.children as LineSegments2[];
		const masks = lines.filter((l) => !(l.material as LineMaterial).colorWrite);
		const glows = lines.filter((l) => (l.material as LineMaterial).colorWrite);
		expect(masks).toHaveLength(1);
		expect(glows).toHaveLength(2);
		const mask = masks[0].material as LineMaterial;
		expect(mask.stencilFunc).toBe(THREE.AlwaysStencilFunc);
		expect(mask.stencilRef).toBe(GLOW_STENCIL_REF);
		expect(mask.linewidth).toBe(LINE_WIDTH);
		for (const g of glows) {
			expect((g.material as LineMaterial).stencilRef).toBe(GLOW_STENCIL_REF);
			expect(g.renderOrder).toBeGreaterThan(masks[0].renderOrder);
		}

		glow.clear();
		expect(glow.group.children).toHaveLength(0);
	});
});

describe('box select', () => {
	const view = { width: 100, height: 100, viewProjection: orthoViewProjection() };

	it('takes items with any piece midpoint inside the rectangle, in any drag direction', () => {
		const b = new LinePickIndexBuilder();
		const left = b.addItem({ kind: 'segment', segment: {} } as unknown as LinePickItem);
		b.addPiece(left, [-40, 0, 0], [-30, 0, 0], 0, 1); // midpoint at screen (15, 50)
		const right = b.addItem({ kind: 'segment', segment: {} } as unknown as LinePickItem);
		b.addPiece(right, [-30, 20, 0], [-20, 20, 0], 0, 1); // (25, 30)
		b.addPiece(right, [20, 0, 0], [30, 0, 0], 1, 2); // (75, 50)
		const index = b.build();

		expect(itemsInRect(index, { ...view, x0: 60, y0: 60, x1: 90, y1: 40 })).toEqual([right]);
		expect(itemsInRect(index, { ...view, x0: 0, y0: 0, x1: 100, y1: 100 })).toEqual([left, right]);
		expect(
			itemsInRect(index, { ...view, x0: 0, y0: 0, x1: 100, y1: 100, accept: () => false })
		).toEqual([]);
	});

	it('expands each oligo once and unions the ends', () => {
		const { part, scaffold, staple } = twoOligoPart();
		const scafSeg: LinePickItem = { kind: 'segment', segment: [...scaffold.segments][0] };
		const stapSeg: LinePickItem = { kind: 'segment', segment: [...staple.segments][0] };
		const all = filterOf('SCAF', 'STAP');

		const segs = boxPickedEnds(
			part,
			[scafSeg, stapSeg, stapSeg],
			filterOf(...all, 'SEGMENT'),
			'NONE'
		);
		expect(new Set(segs)).toEqual(new Set([...scaffold.allEnds, ...staple.allEnds]));
		expect(segs).toHaveLength(new Set(segs).size);

		const stapOnly = boxPickedEnds(part, [scafSeg, stapSeg], filterOf('STAP', 'OLIGO'), 'NONE');
		expect(new Set(stapOnly)).toEqual(staple.allEnds);
	});
});
