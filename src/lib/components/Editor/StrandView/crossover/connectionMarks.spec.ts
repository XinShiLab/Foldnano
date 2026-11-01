import { describe, expect, it } from 'vitest';

import type { SegmentEnd } from '$lib/model/Oligo';
import type { Part } from '$lib/model/Part';
import { createDrawingDimensions } from '../drawingDimensions';
import { MIRROR_OPACITY } from '../drawingContext';
import {
	buildConnectionMarks,
	findConnectionMark,
	hitConnectionMark,
	selectedConnectionMarks,
} from './connectionMarks';

const SIDE = 12;

interface FakeEnd {
	isThreePrime: boolean;
	index: number;
	isConstrained: boolean;
	connectedEnd: FakeEnd | null;
	segment: FakeSegment;
}

interface FakeSegment {
	id: string;
	inStrandIndex: 0 | 1;
	inVirtualHelix: { id: string; index: number; regionId: string };
	oligo: { color: string; isMirror: boolean };
	fivePrime: FakeEnd;
	threePrime: FakeEnd;
}

function fakeSegment(
	id: string,
	vhIndex: number,
	regionId: string,
	strand: 0 | 1,
	low: number,
	high: number,
	isMirror = false
): FakeSegment {
	const segment = {
		id,
		inStrandIndex: strand,
		inVirtualHelix: { id: `vh${vhIndex}`, index: vhIndex, regionId },
		oligo: { color: '#123456', isMirror },
	} as FakeSegment;
	const end = (isThreePrime: boolean, index: number): FakeEnd => ({
		isThreePrime,
		index,
		isConstrained: true,
		connectedEnd: null,
		segment,
	});
	segment.fivePrime = end(false, strand === 0 ? low : high);
	segment.threePrime = end(true, strand === 0 ? high : low);
	return segment;
}

function connect(threePrimeOf: FakeSegment, fivePrimeOf: FakeSegment) {
	threePrimeOf.threePrime.connectedEnd = fivePrimeOf.fivePrime;
	fivePrimeOf.fivePrime.connectedEnd = threePrimeOf.threePrime;
}

function setup(
	segments: FakeSegment[],
	rows: Record<string, { displayRow: number; isCollapsed: boolean } | null>
) {
	const part = {
		regions: [{ id: 'r1' }, { id: 'r2' }],
		oligos: [{ color: '#123456', isMirror: segments.some((s) => s.oligo.isMirror), segments }],
	} as unknown as Part;
	const d = {
		...createDrawingDimensions(16, SIDE, 1),
		getEffectiveDisplayRowForVh: (vhId: string) => rows[vhId] ?? null,
	} as unknown as ReturnType<typeof createDrawingDimensions>;
	return { part, d, marks: buildConnectionMarks(part, d) };
}

const visibleRows = {
	vh12: { displayRow: 0, isCollapsed: false },
	vh13: { displayRow: 1, isCollapsed: false },
};

describe('buildConnectionMarks', () => {
	it('marks both ends with the VH[bp] of the other end', () => {
		const a = fakeSegment('a', 12, 'r1', 0, 10, 34);
		const b = fakeSegment('b', 13, 'r1', 1, 20, 40);
		connect(a, b);
		const { marks } = setup([a, b], visibleRows);

		expect(marks.get(0)?.map((m) => m.label)).toEqual(['13[40]']);
		expect(marks.get(1)?.map((m) => m.label)).toEqual(['12[34]']);
		expect(marks.get(0)?.[0].targetVhId).toBe('vh13');
		expect(marks.get(0)?.[0].targetBpIdx).toBe(40);
	});

	it('uses the same crossover id and 3 to 5 arc from either end', () => {
		const a = fakeSegment('a', 12, 'r1', 0, 10, 34);
		const b = fakeSegment('b', 13, 'r1', 1, 20, 40);
		connect(a, b);
		const { marks } = setup([a, b], visibleRows);
		const fromA = marks.get(0)![0];
		const fromB = marks.get(1)![0];

		expect(fromA.xoverId).toBe('XOVER#a#to#b');
		expect(fromB.xoverId).toBe('XOVER#a#to#b');
		expect(fromA.arc).toEqual(fromB.arc);
		expect(fromA.arc?.start).toEqual([0, 34, 0]);
		expect(fromA.arc?.end).toEqual([1, 40, 1]);
	});

	it('extends each label over its own segment, so DX neighbours point apart', () => {
		const left = fakeSegment('left', 12, 'r1', 0, 0, 20);
		const right = fakeSegment('right', 12, 'r1', 0, 21, 41);
		connect(left, fakeSegment('leftPartner', 13, 'r1', 1, 0, 20));
		connect(fakeSegment('rightPartner', 13, 'r1', 1, 21, 41), right);
		const { marks } = setup([left, right], visibleRows);
		const [leftMark, rightMark] = marks.get(0)!;

		expect(leftMark.side).toBe(-1);
		expect(rightMark.side).toBe(1);
		expect(leftMark.labelBox.x1).toBeLessThan(rightMark.labelBox.x0);
	});

	it('keeps strand 0 labels above the band and strand 1 labels below it', () => {
		const a = fakeSegment('a', 12, 'r1', 0, 10, 34);
		const b = fakeSegment('b', 13, 'r1', 1, 20, 40);
		connect(a, b);
		const { marks } = setup([a, b], visibleRows);
		const top = marks.get(0)![0];
		const bottom = marks.get(1)![0];

		expect(top.labelBox.y1).toBe(top.cellBox.y0);
		expect(bottom.labelBox.y0).toBe(bottom.cellBox.y1);
	});

	it('names the region and drops the arc when the target is collapsed', () => {
		const a = fakeSegment('a', 12, 'r1', 0, 10, 34);
		const b = fakeSegment('b', 13, 'r2', 1, 20, 40);
		connect(a, b);
		const { marks } = setup([a, b], {
			vh12: { displayRow: 0, isCollapsed: false },
			vh13: { displayRow: 5, isCollapsed: true },
		});

		expect(marks.get(0)?.[0].label).toBe('R2:13[40]');
		expect(marks.get(0)?.[0].arc).toBeNull();
		expect(marks.get(5)).toBeUndefined();
	});

	it('skips free ends and dims mirror oligos', () => {
		const free = fakeSegment('free', 12, 'r1', 0, 0, 10);
		const mirror = fakeSegment('mirror', 12, 'r1', 0, 20, 30, true);
		const other = fakeSegment('other', 13, 'r1', 1, 20, 40);
		connect(mirror, other);
		const { marks } = setup([free, mirror], visibleRows);

		expect(marks.get(0)).toHaveLength(1);
		expect(marks.get(0)?.[0].opacity).toBe(MIRROR_OPACITY);
	});
});

describe('selectedConnectionMarks', () => {
	const a = fakeSegment('a', 12, 'r1', 0, 10, 34);
	const b = fakeSegment('b', 13, 'r2', 1, 20, 40);
	connect(a, b);
	const select = (ends: FakeEnd[]) => new Set(ends) as unknown as ReadonlySet<SegmentEnd>;

	it('returns a crossover once, only when both its ends are selected', () => {
		const { marks } = setup([a, b], visibleRows);

		expect(selectedConnectionMarks(marks, select([]))).toEqual([]);
		expect(selectedConnectionMarks(marks, select([a.threePrime]))).toEqual([]);
		expect(
			selectedConnectionMarks(marks, select([a.threePrime, b.fivePrime])).map((m) => m.xoverId)
		).toEqual(['XOVER#a#to#b']);
	});

	it('skips a crossover whose other end is in a collapsed region', () => {
		const { marks } = setup([a, b], {
			vh12: { displayRow: 0, isCollapsed: false },
			vh13: { displayRow: 5, isCollapsed: true },
		});

		expect(selectedConnectionMarks(marks, select([a.threePrime, b.fivePrime]))).toEqual([]);
	});
});

describe('hitConnectionMark', () => {
	const a = fakeSegment('a', 12, 'r1', 1, 10, 34);
	const b = fakeSegment('b', 13, 'r1', 0, 20, 40);
	connect(a, b);
	const { marks, d } = setup([a, b], visibleRows);
	const lower = marks.get(0)![0];
	const upper = marks.get(1)![0];

	const hitAt = (x: number, y: number) => hitConnectionMark(marks, d.getRowIdxByY(y), x, y);

	it('finds a label in the gap, from the row above and the row below', () => {
		const lowerHit = hitAt(lower.labelX, lower.elbowY);
		const upperHit = hitAt(upper.labelX, upper.elbowY);

		expect(lowerHit).toMatchObject({ mark: { key: lower.key }, onLabel: true });
		expect(upperHit).toMatchObject({ mark: { key: upper.key }, onLabel: true });
	});

	it('finds the end cell without calling it a label hit', () => {
		const hit = hitAt(lower.stemX, (lower.cellBox.y0 + lower.cellBox.y1) / 2);
		expect(hit).toMatchObject({ mark: { key: lower.key }, onLabel: false });
	});

	it('misses elsewhere on the strand and in the gap', () => {
		expect(hitAt(lower.stemX + 20 * SIDE, lower.elbowY)).toBeNull();
		expect(hitAt(lower.stemX + 5 * SIDE, lower.cellBox.y0 + 2)).toBeNull();
	});

	it('looks marks up by key', () => {
		expect(findConnectionMark(marks, upper.key)).toBe(upper);
		expect(findConnectionMark(marks, 'gone#3')).toBeNull();
	});
});
