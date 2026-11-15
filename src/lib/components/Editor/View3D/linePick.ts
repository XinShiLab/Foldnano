import type * as THREE from 'three';
import type Oligo from '$lib/model/Oligo';
import type { OligoSegment, SegmentEnd } from '$lib/model/Oligo';
import type { Part } from '$lib/model/Part';
import type { Category, LeafTarget } from '$lib/canvasEditor/core/modes';
import type { SelectAllMode } from '../context/types';
import {
	expandOligoEnds,
	filterEndsByStrandType,
} from '$lib/canvasEditor/tools/select/selectUtils';

/** A pickable thing drawn in the 3D line view. A crossover is keyed by its 3' side. */
export type LinePickItem =
	| { kind: 'segment'; segment: OligoSegment }
	| { kind: 'xover'; segment: OligoSegment; toSegment: OligoSegment };

/**
 * The line view's drawn pieces with the item each belongs to, built alongside the batched line
 * geometry (which carries no identity). Positions are the drawn ones, so relaxed layouts pick
 * where they are shown.
 */
export interface LinePickIndex {
	readonly items: readonly LinePickItem[];
	/** Six floats per piece: start xyz, end xyz (nm). */
	readonly positions: Float32Array;
	/** Item index per piece. */
	readonly pieceItem: Int32Array;
	/** Base index at the piece's start and end, for the strand-view jump target. */
	readonly pieceBp: Float32Array;
	/** An item's pieces are contiguous: first piece and count per item. */
	readonly itemPieceStart: Int32Array;
	readonly itemPieceCount: Int32Array;
	/** 1 where the item is drawn translucent (dimmed). */
	readonly itemDim: Uint8Array;
}

export class LinePickIndexBuilder {
	private readonly _items: LinePickItem[] = [];
	private readonly _positions: number[] = [];
	private readonly _pieceItem: number[] = [];
	private readonly _pieceBp: number[] = [];
	private readonly _itemPieceStart: number[] = [];
	private readonly _itemDim: number[] = [];

	addItem(item: LinePickItem, dim = false): number {
		this._items.push(item);
		this._itemPieceStart.push(this._pieceItem.length);
		this._itemDim.push(dim ? 1 : 0);
		return this._items.length - 1;
	}

	addPiece(
		item: number,
		a: ArrayLike<number>,
		b: ArrayLike<number>,
		bpStart: number,
		bpEnd: number
	): void {
		if (item !== this._items.length - 1) throw new Error('Pick pieces must follow their item');
		this._positions.push(a[0], a[1], a[2], b[0], b[1], b[2]);
		this._pieceItem.push(item);
		this._pieceBp.push(bpStart, bpEnd);
	}

	build(): LinePickIndex {
		const n = this._items.length;
		const itemPieceStart = new Int32Array(this._itemPieceStart);
		const itemPieceCount = new Int32Array(n);
		for (let i = 0; i < n; i++) {
			const end = i + 1 < n ? itemPieceStart[i + 1] : this._pieceItem.length;
			itemPieceCount[i] = end - itemPieceStart[i];
		}
		return {
			items: this._items,
			positions: new Float32Array(this._positions),
			pieceItem: new Int32Array(this._pieceItem),
			pieceBp: new Float32Array(this._pieceBp),
			itemPieceStart,
			itemPieceCount,
			itemDim: new Uint8Array(this._itemDim),
		};
	}
}

export interface LinePickHit {
	item: LinePickItem;
	itemIndex: number;
	/** Base under the pointer, rounded. */
	bp: number;
	/** Screen distance from the pointer, px. */
	distancePx: number;
}

export interface LinePickQuery {
	/** Pointer in canvas pixels, origin top-left. */
	x: number;
	y: number;
	width: number;
	height: number;
	radiusPx: number;
	/** `camera.projectionMatrix × camera.matrixWorldInverse`. */
	viewProjection: THREE.Matrix4;
	accept?: (item: LinePickItem) => boolean;
	/**
	 * Hover hysteresis: keep this item while it stays within the radius and no other item is closer
	 * by more than `marginPx`, so hover doesn't flicker between neighbours.
	 */
	sticky?: { itemIndex: number; marginPx: number };
}

// Equal screen distances within this margin are settled by depth (front-most wins).
const TIE_PX = 0.5;

/**
 * Nearest drawn piece to the pointer within a screen-space radius. The radius is in pixels so a
 * zoomed-out view doesn't pick from a crowd and a zoomed-in one doesn't need pixel-perfect aim.
 */
export function pickLine(index: LinePickIndex, q: LinePickQuery): LinePickHit | null {
	const e = q.viewProjection.elements;
	const accepted = q.accept ? index.items.map(q.accept) : null;
	const { positions, pieceItem, pieceBp } = index;
	const r2 = q.radiusPx * q.radiusPx;
	let best = -1;
	let bestD2 = Infinity;
	let bestDepth = Infinity;
	let bestU = 0;
	const stickyItem = q.sticky?.itemIndex ?? -1;
	let sticky = -1;
	let stickyD2 = Infinity;
	let stickyU = 0;

	const pieceCount = pieceItem.length;
	for (let p = 0; p < pieceCount; p++) {
		if (accepted && !accepted[pieceItem[p]]) continue;
		const o = p * 6;
		const ax = positions[o],
			ay = positions[o + 1],
			az = positions[o + 2];
		const bx = positions[o + 3],
			by = positions[o + 4],
			bz = positions[o + 5];
		const aw = e[3] * ax + e[7] * ay + e[11] * az + e[15];
		const bw = e[3] * bx + e[7] * by + e[11] * bz + e[15];
		if (aw <= 1e-6 || bw <= 1e-6) continue; // behind the camera
		const asx = ((e[0] * ax + e[4] * ay + e[8] * az + e[12]) / aw + 1) * 0.5 * q.width;
		const asy = (1 - (e[1] * ax + e[5] * ay + e[9] * az + e[13]) / aw) * 0.5 * q.height;
		const bsx = ((e[0] * bx + e[4] * by + e[8] * bz + e[12]) / bw + 1) * 0.5 * q.width;
		const bsy = (1 - (e[1] * bx + e[5] * by + e[9] * bz + e[13]) / bw) * 0.5 * q.height;

		const dx = bsx - asx,
			dy = bsy - asy;
		const len2 = dx * dx + dy * dy;
		let u = len2 > 0 ? ((q.x - asx) * dx + (q.y - asy) * dy) / len2 : 0;
		u = u < 0 ? 0 : u > 1 ? 1 : u;
		const cx = asx + u * dx - q.x,
			cy = asy + u * dy - q.y;
		const d2 = cx * cx + cy * cy;
		if (d2 > r2) continue;
		if (pieceItem[p] === stickyItem && d2 < stickyD2) {
			sticky = p;
			stickyD2 = d2;
			stickyU = u;
		}

		const az_ = (e[2] * ax + e[6] * ay + e[10] * az + e[14]) / aw;
		const bz_ = (e[2] * bx + e[6] * by + e[10] * bz + e[14]) / bw;
		const depth = az_ + u * (bz_ - az_);
		const d = Math.sqrt(d2);
		const bd = Math.sqrt(bestD2);
		const better = d < bd - TIE_PX || (d <= bd + TIE_PX && depth < bestDepth);
		if (!better) continue;
		best = p;
		bestD2 = d2;
		bestDepth = depth;
		bestU = u;
	}

	if (best < 0) return null;
	if (sticky >= 0 && Math.sqrt(stickyD2) <= Math.sqrt(bestD2) + q.sticky!.marginPx) {
		best = sticky;
		bestD2 = stickyD2;
		bestU = stickyU;
	}
	const bp0 = pieceBp[best * 2];
	const bp1 = pieceBp[best * 2 + 1];
	return {
		item: index.items[pieceItem[best]],
		itemIndex: pieceItem[best],
		bp: Math.round(bp0 + bestU * (bp1 - bp0)),
		distancePx: Math.sqrt(bestD2),
	};
}

export interface LineRectQuery {
	/** Rectangle corners in canvas pixels, any order. */
	x0: number;
	y0: number;
	x1: number;
	y1: number;
	width: number;
	height: number;
	viewProjection: THREE.Matrix4;
	accept?: (item: LinePickItem) => boolean;
}

/**
 * Items with any piece midpoint inside a screen rectangle, front or back (like the strand view's
 * box, it has no notion of what is hidden behind what). Pieces behind the camera never count.
 */
export function itemsInRect(index: LinePickIndex, q: LineRectQuery): number[] {
	const e = q.viewProjection.elements;
	const left = Math.min(q.x0, q.x1),
		right = Math.max(q.x0, q.x1);
	const top = Math.min(q.y0, q.y1),
		bottom = Math.max(q.y0, q.y1);
	const { positions, itemPieceStart, itemPieceCount } = index;
	const inside: number[] = [];
	index.items.forEach((item, i) => {
		if (q.accept && !q.accept(item)) return;
		const end = itemPieceStart[i] + itemPieceCount[i];
		for (let p = itemPieceStart[i]; p < end; p++) {
			const o = p * 6;
			const mx = (positions[o] + positions[o + 3]) * 0.5;
			const my = (positions[o + 1] + positions[o + 4]) * 0.5;
			const mz = (positions[o + 2] + positions[o + 5]) * 0.5;
			const w = e[3] * mx + e[7] * my + e[11] * mz + e[15];
			if (w <= 1e-6) continue;
			const sx = ((e[0] * mx + e[4] * my + e[8] * mz + e[12]) / w + 1) * 0.5 * q.width;
			const sy = (1 - (e[1] * mx + e[5] * my + e[9] * mz + e[13]) / w) * 0.5 * q.height;
			if (sx >= left && sx <= right && sy >= top && sy <= bottom) {
				inside.push(i);
				return;
			}
		}
	});
	return inside;
}

/** Items a selection of `ends` fully covers: a segment needs both ends, a crossover both sides. */
export function itemsCoveredBy(index: LinePickIndex, ends: ReadonlySet<SegmentEnd>): number[] {
	const covered: number[] = [];
	index.items.forEach((item, i) => {
		const [a, b] =
			item.kind === 'segment'
				? [item.segment.fivePrime, item.segment.threePrime]
				: [item.segment.threePrime, item.toSegment.fivePrime];
		if (ends.has(a) && ends.has(b)) covered.push(i);
	});
	return covered;
}

/** The drawn pieces of `itemIndices`, split by kind (segments and crossovers draw at different widths). */
export function piecesOf(
	index: LinePickIndex,
	itemIndices: readonly number[]
): { segments: Float32Array; xovers: Float32Array } {
	let segLen = 0;
	let xoLen = 0;
	for (const i of itemIndices) {
		const n = index.itemPieceCount[i] * 6;
		if (index.items[i].kind === 'segment') segLen += n;
		else xoLen += n;
	}
	const segments = new Float32Array(segLen);
	const xovers = new Float32Array(xoLen);
	let so = 0;
	let xo = 0;
	for (const i of itemIndices) {
		const from = index.itemPieceStart[i] * 6;
		const slice = index.positions.subarray(from, from + index.itemPieceCount[i] * 6);
		if (index.items[i].kind === 'segment') {
			segments.set(slice, so);
			so += slice.length;
		} else {
			xovers.set(slice, xo);
			xo += slice.length;
		}
	}
	return { segments, xovers };
}

function itemOligo(item: LinePickItem): Oligo | null {
	return item.segment.oligo ?? null;
}

/**
 * What a click on `item` selects under the strand view's filter, mirroring the select tool's hit
 * priority (crossover, then oligo, then segment). Null when the filter lets nothing through.
 */
export function pickedEnds(
	part: Part,
	item: LinePickItem,
	filter: ReadonlySet<LeafTarget | Category>,
	selectAllMode: SelectAllMode
): SegmentEnd[] | null {
	let ends: SegmentEnd[] | null = null;
	const oligo = itemOligo(item);
	if (item.kind === 'xover' && filter.has('XOVER')) {
		ends = [item.segment.threePrime, item.toSegment.fivePrime];
	} else if (filter.has('OLIGO') && oligo) {
		ends = expandOligoEnds(part, oligo, selectAllMode);
	} else if (item.kind === 'segment' && filter.has('SEGMENT')) {
		ends = [item.segment.fivePrime, item.segment.threePrime];
	}
	if (!ends) return null;
	const kept = filterEndsByStrandType(ends, filter);
	return kept.length > 0 ? kept : null;
}

/** Cheap pre-filter for `pickLine`: could a click on this item select anything? */
export function isPickable(
	item: LinePickItem,
	filter: ReadonlySet<LeafTarget | Category>
): boolean {
	const oligo = itemOligo(item);
	if (!oligo || !filter.has(oligo.isScaffold ? 'SCAF' : 'STAP')) return false;
	if (filter.has('OLIGO')) return true;
	return item.kind === 'xover' ? filter.has('XOVER') : filter.has('SEGMENT');
}

/** Whether the filter has any kind the 3D view can pick (ends are not drawn there). */
export function hasPickableKind(filter: ReadonlySet<LeafTarget | Category>): boolean {
	return filter.has('SEGMENT') || filter.has('XOVER') || filter.has('OLIGO');
}

interface SelectionLike {
	set(ends: SegmentEnd[]): void;
	add(ends: SegmentEnd[]): void;
	remove(ends: SegmentEnd[]): void;
	includesAll(ends: SegmentEnd[]): boolean;
}

/**
 * Ends a box over `items` selects: each item through `pickedEnds`, with an oligo expanded once
 * however many of its pieces fell inside.
 */
export function boxPickedEnds(
	part: Part,
	items: readonly LinePickItem[],
	filter: ReadonlySet<LeafTarget | Category>,
	selectAllMode: SelectAllMode
): SegmentEnd[] {
	const ends = new Set<SegmentEnd>();
	const seenOligos = new Set<Oligo>();
	const oligoMode = filter.has('OLIGO');
	for (const item of items) {
		const oligo = itemOligo(item);
		// A crossover with XOVER on selects itself, not its oligo, so only dedupe true oligo picks.
		const picksOligo = oligoMode && !(item.kind === 'xover' && filter.has('XOVER'));
		if (picksOligo && oligo) {
			if (seenOligos.has(oligo)) continue;
			seenOligos.add(oligo);
		}
		for (const end of pickedEnds(part, item, filter, selectAllMode) ?? []) ends.add(end);
	}
	return [...ends];
}

/** Plain click replaces the selection; Shift toggles the picked ends in or out. */
export function applyPick(selection: SelectionLike, ends: SegmentEnd[], additive: boolean): void {
	if (!additive) selection.set(ends);
	else if (selection.includesAll(ends)) selection.remove(ends);
	else selection.add(ends);
}
