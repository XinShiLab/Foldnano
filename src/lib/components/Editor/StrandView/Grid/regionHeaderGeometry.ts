import type { Part } from '$lib/model/Part';
import type { DrawingDimensions } from '../drawingDimensions';

/** Last base of a region's rows: its own `maxBase`, never another region's (not `part.maxBase`,
 * which is whichever region happens to be first). */
export function regionMaxBpIdx(
	part: Pick<Part, 'regions' | 'maxBase'>,
	regionId: string | null
): number {
	return part.regions.find((r) => r.id === regionId)?.maxBase ?? part.maxBase;
}

export interface RegionHeaderGeometry {
	left: number;
	top: number;
	width: number;
	height: number;
	iconLeft: number;
	iconTop: number;
	iconSize: number;
	/** Left edges of the move-up / move-down buttons, just left of the plane icon. */
	moveUpLeft: number;
	moveDownLeft: number;
}

/** World-space boxes of a region header and its icons; shared with the `?` help anchors. */
export function regionHeaderGeometry(
	d: DrawingDimensions,
	displayRow: number,
	maxBpIdx: number
): RegionHeaderGeometry {
	const { radius, sideLength } = d.dimensions;
	const x = 2 * radius;
	const top = d.getRowYByRowIdx(displayRow) - sideLength - 4;
	const width = d.getXByBpIdx(maxBpIdx) - x + sideLength * 2;
	const height = sideLength * 2 + 8;
	const iconSize = sideLength + 4;
	const iconLeft = x - radius + width - iconSize - 10;
	const moveDownLeft = iconLeft - iconSize - 6;
	return {
		left: x - radius,
		top,
		width,
		height,
		iconLeft,
		iconTop: top + (height - iconSize) / 2,
		iconSize,
		moveUpLeft: moveDownLeft - iconSize - 2,
		moveDownLeft,
	};
}
