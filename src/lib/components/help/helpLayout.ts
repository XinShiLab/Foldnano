export interface Rect {
	left: number;
	top: number;
	width: number;
	height: number;
}

export type Placement = 'inside' | 'left' | 'right' | 'above' | 'below';

export interface NoteRequest<K> {
	key: K;
	target: Rect;
	width: number;
	height: number;
	placement: Placement;
	/** Placements to fall back to when the preferred one is crowded; all of them by default. */
	alternatives?: readonly Placement[];
}

export interface Viewport {
	width: number;
	height: number;
}

const ALL_PLACEMENTS: readonly Placement[] = ['inside', 'left', 'right', 'below', 'above'];
const GAP = 8;
// Notes keep this much clear space between each other so borders never touch.
const SPACING = 6;
const STEP = 6;
const MAX_SHIFT = 720;
// A different side costs as much as sliding this far along the preferred one.
const ALTERNATIVE_PENALTY = 160;

function anchor(target: Rect, width: number, height: number, placement: Placement): Rect {
	switch (placement) {
		case 'inside':
			return { left: target.left + GAP, top: target.top + GAP, width, height };
		case 'left':
			return { left: target.left - width - GAP, top: target.top, width, height };
		case 'right':
			return { left: target.left + target.width + GAP, top: target.top, width, height };
		case 'below':
			return { left: target.left, top: target.top + target.height + GAP, width, height };
		case 'above':
			return { left: target.left, top: target.top - height - GAP, width, height };
	}
}

function clampToViewport(rect: Rect, viewport: Viewport): Rect {
	const maxLeft = Math.max(GAP, viewport.width - rect.width - GAP);
	const maxTop = Math.max(GAP, viewport.height - rect.height - GAP);
	return {
		...rect,
		left: Math.min(Math.max(rect.left, GAP), maxLeft),
		top: Math.min(Math.max(rect.top, GAP), maxTop),
	};
}

export function overlaps(a: Rect, b: Rect, spacing = 0): boolean {
	return (
		a.left < b.left + b.width + spacing &&
		b.left < a.left + a.width + spacing &&
		a.top < b.top + b.height + spacing &&
		b.top < a.top + a.height + spacing
	);
}

/**
 * Places notes one by one so none overlaps an obstacle or an earlier note. Each note starts at its
 * preferred side of its target and slides along that side (or tries another side) until it is
 * clear; the cheapest clear spot wins. A note that cannot be cleared keeps its preferred spot.
 */
export function placeNotes<K>(
	requests: readonly NoteRequest<K>[],
	obstacles: readonly Rect[],
	viewport: Viewport
): Map<K, Rect> {
	const taken: Rect[] = [...obstacles];
	const result = new Map<K, Rect>();

	for (const req of requests) {
		const sides = [
			req.placement,
			...(req.alternatives ?? ALL_PLACEMENTS).filter((p) => p !== req.placement),
		];
		let best: Rect | null = null;
		let bestScore = Infinity;

		for (const side of sides) {
			const penalty = side === req.placement ? 0 : ALTERNATIVE_PENALTY;
			const base = anchor(req.target, req.width, req.height, side);
			const slideVertically = side !== 'above' && side !== 'below';
			search: for (
				let shift = 0;
				shift <= MAX_SHIFT && shift + penalty < bestScore;
				shift += STEP
			) {
				for (const d of shift === 0 ? [0] : [shift, -shift]) {
					const moved = slideVertically
						? { ...base, top: base.top + d }
						: { ...base, left: base.left + d };
					const rect = clampToViewport(moved, viewport);
					if (taken.some((t) => overlaps(rect, t, SPACING))) continue;
					best = rect;
					bestScore = shift + penalty;
					break search;
				}
			}
		}

		const placed =
			best ?? clampToViewport(anchor(req.target, req.width, req.height, req.placement), viewport);
		taken.push(placed);
		result.set(req.key, placed);
	}
	return result;
}

/** Endpoints of a leader line from a note to its target, or null when they already touch. */
export function leaderLine(
	note: Rect,
	target: Rect
): { x1: number; y1: number; x2: number; y2: number } | null {
	if (overlaps(note, target)) return null;
	const cx = note.left + note.width / 2;
	const cy = note.top + note.height / 2;
	const x2 = Math.min(Math.max(cx, target.left), target.left + target.width);
	const y2 = Math.min(Math.max(cy, target.top), target.top + target.height);
	const x1 = Math.min(Math.max(x2, note.left), note.left + note.width);
	const y1 = Math.min(Math.max(y2, note.top), note.top + note.height);
	return { x1, y1, x2, y2 };
}
