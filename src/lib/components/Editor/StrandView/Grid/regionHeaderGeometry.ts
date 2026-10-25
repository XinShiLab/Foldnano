import type { DrawingDimensions } from '../drawingDimensions';

export interface RegionHeaderGeometry {
	left: number;
	top: number;
	width: number;
	height: number;
	iconLeft: number;
	iconTop: number;
	iconSize: number;
}

/** World-space boxes of a region header and its plane icon; shared with the `?` help anchors. */
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
	return {
		left: x - radius,
		top,
		width,
		height,
		iconLeft: x - radius + width - iconSize - 10,
		iconTop: top + (height - iconSize) / 2,
		iconSize,
	};
}
