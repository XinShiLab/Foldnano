import type Oligo from '$lib/model/Oligo';
import type { SegmentEnd } from '$lib/model/Oligo';
import type { Part } from '$lib/model/Part';
import type { CanHide } from '../../context/types';
import { MIRROR_OPACITY } from '../drawingContext';
import type { DrawingDimensions } from '../drawingDimensions';

const LANE_HEIGHT = 12;
const ELBOW_OFFSET = 6;
const ELBOW_LENGTH = 5;
const LABEL_GAP = 2;
const LABEL_CHAR_WIDTH = 4;
const STEM_HIT_PADDING = 3;

export const CONNECTION_LABEL_FONT_SIZE = 7;

interface Box {
	x0: number;
	x1: number;
	y0: number;
	y1: number;
}

export interface ConnectionMark {
	key: string;
	xoverId: string;
	end: SegmentEnd;
	partner: SegmentEnd;
	isThreePrime: boolean;
	strandIdx: 0 | 1;
	/** Labels extend over the end's own segment, so the two ends of a DX pair point apart. */
	side: -1 | 1;
	label: string;
	color: string;
	opacity: number;
	stemX: number;
	/** Where the mark meets the strand band. */
	edgeY: number;
	elbowY: number;
	tipX: number;
	labelX: number;
	labelBox: Box;
	cellBox: Box;
	targetVhId: string;
	targetBpIdx: number;
	/** Null when the target's region is collapsed: there is no row to draw the arc to. */
	arc: {
		start: [number, number, 0 | 1];
		end: [number, number, 0 | 1];
		isConstrained: boolean;
	} | null;
}

/** Marks keyed by display row, so drawing and hit tests only visit the rows they touch. */
export type ConnectionMarksByRow = Map<number, ConnectionMark[]>;

export interface ConnectionMarkHit {
	mark: ConnectionMark;
	onLabel: boolean;
}

export const NO_CONNECTION_MARKS: ConnectionMarksByRow = new Map();

export function isCrossoverHidden(
	hide: Record<CanHide, boolean>,
	end: SegmentEnd,
	partner: SegmentEnd
): boolean {
	if (hide.crossovers) return true;
	return hide.unconstrained_crossovers && !(end.isConstrained && partner.isConstrained);
}

export function buildConnectionMarks(
	part: Part,
	d: DrawingDimensions,
	hide: Record<CanHide, boolean>
): ConnectionMarksByRow {
	const marks: ConnectionMarksByRow = new Map();
	for (const oligo of part.oligos) {
		for (const segment of oligo.segments) {
			const own = d.getEffectiveDisplayRowForVh(segment.inVirtualHelix.id);
			if (own === null || own.isCollapsed) continue;
			for (const end of [segment.fivePrime, segment.threePrime]) {
				const partner = end.connectedEnd;
				if (!partner || !isCrossoverHidden(hide, end, partner)) continue;
				const target = d.getEffectiveDisplayRowForVh(partner.segment.inVirtualHelix.id);
				if (target === null) continue;

				const mark = createMark(part, d, oligo, end, partner, own.displayRow, target);
				const row = marks.get(own.displayRow);
				if (row) row.push(mark);
				else marks.set(own.displayRow, [mark]);
			}
		}
	}
	return marks;
}

function createMark(
	part: Part,
	d: DrawingDimensions,
	oligo: Oligo,
	end: SegmentEnd,
	partner: SegmentEnd,
	displayRow: number,
	target: { displayRow: number; isCollapsed: boolean }
): ConnectionMark {
	const { sideLength } = d.dimensions;
	const segment = end.segment;
	const strandIdx = segment.inStrandIndex as 0 | 1;
	const partnerStrandIdx = partner.segment.inStrandIndex as 0 | 1;
	const targetVh = partner.segment.inVirtualHelix;

	let label = `${targetVh.index}[${partner.index}]`;
	if (target.isCollapsed) {
		const regionNumber = part.regions.findIndex((r) => r.id === targetVh.regionId) + 1;
		label = `R${regionNumber}:${label}`;
	}

	const [x, y] = d.getBpCoordsByRowAndBpIdx(displayRow, end.index)[strandIdx];
	const stemX = x + sideLength / 2;
	const up = strandIdx === 0 ? -1 : 1;
	const edgeY = strandIdx === 0 ? y : y + sideLength;
	// 5'→3' runs right on strand 0 and left on strand 1, so a 3' end's segment lies behind it.
	const side = end.isThreePrime === (strandIdx === 0) ? -1 : 1;
	const tipX = stemX + side * ELBOW_LENGTH;
	const labelX = tipX + side * LABEL_GAP;
	const labelEndX = labelX + side * label.length * LABEL_CHAR_WIDTH;

	const threePrime = end.isThreePrime ? end : partner;
	const fivePrime = end.isThreePrime ? partner : end;
	const here: [number, number, 0 | 1] = [displayRow, end.index, strandIdx];
	const there: [number, number, 0 | 1] = [target.displayRow, partner.index, partnerStrandIdx];

	return {
		key: `${segment.id}#${end.isThreePrime ? '3' : '5'}`,
		xoverId: `XOVER#${threePrime.segment.id}#to#${fivePrime.segment.id}`,
		end,
		partner,
		isThreePrime: end.isThreePrime,
		strandIdx,
		side,
		label,
		color: oligo.color,
		opacity: oligo.isMirror ? MIRROR_OPACITY : 1,
		stemX,
		edgeY,
		elbowY: edgeY + up * ELBOW_OFFSET,
		tipX,
		labelX,
		labelBox: {
			x0: Math.min(stemX - side * STEM_HIT_PADDING, labelEndX),
			x1: Math.max(stemX - side * STEM_HIT_PADDING, labelEndX),
			y0: Math.min(edgeY, edgeY + up * LANE_HEIGHT),
			y1: Math.max(edgeY, edgeY + up * LANE_HEIGHT),
		},
		cellBox: { x0: x, x1: x + sideLength, y0: y, y1: y + sideLength },
		targetVhId: targetVh.id,
		targetBpIdx: partner.index,
		arc: target.isCollapsed
			? null
			: {
					start: end.isThreePrime ? here : there,
					end: end.isThreePrime ? there : here,
					isConstrained: end.isConstrained && partner.isConstrained,
				},
	};
}

const inBox = (box: Box, x: number, y: number) =>
	x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1;

/** `displayRow` is the row whose band holds `y`; that band spans its helix and the gap below it. */
export function hitConnectionMark(
	marks: ConnectionMarksByRow,
	displayRow: number,
	x: number,
	y: number
): ConnectionMarkHit | null {
	for (const row of [displayRow, displayRow + 1]) {
		for (const mark of marks.get(row) ?? []) {
			if (inBox(mark.labelBox, x, y)) return { mark, onLabel: true };
			if (inBox(mark.cellBox, x, y)) return { mark, onLabel: false };
		}
	}
	return null;
}

/** Crossovers with both ends selected, once each, skipping any whose arc has no row to reach. */
export function selectedConnectionMarks(
	marks: ConnectionMarksByRow,
	selectedEnds: ReadonlySet<SegmentEnd>
): ConnectionMark[] {
	if (selectedEnds.size === 0) return [];
	const selected: ConnectionMark[] = [];
	for (const row of marks.values()) {
		for (const mark of row) {
			if (
				mark.isThreePrime &&
				mark.arc &&
				selectedEnds.has(mark.end) &&
				selectedEnds.has(mark.partner)
			) {
				selected.push(mark);
			}
		}
	}
	return selected;
}

export function findConnectionMark(
	marks: ConnectionMarksByRow,
	key: string
): ConnectionMark | null {
	for (const row of marks.values()) {
		const mark = row.find((candidate) => candidate.key === key);
		if (mark) return mark;
	}
	return null;
}
