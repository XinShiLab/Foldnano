/**
 * Returns a "bulge" point along the perpendicular bisector of a line segment.
 *
 * @param x1 - x coordinate of the first point
 * @param y1 - y coordinate of the first point
 * @param x2 - x coordinate of the second point
 * @param y2 - y coordinate of the second point
 * @param k - bulge scaling factor (default 0.1, proportional to segment length)
 * @param maxBulge - optional maximum bulge distance cap
 * @param side - direction of bulge (+1 or -1, default +1)
 * @returns The bulge point as {x, y}
 */
export function bulgePoint(
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	side: -1 | 1 = 1,
	k: number = 0.1,
	maxBulge: number = Infinity,
	offset: number = 0.2
): [number, number] {
	const dx = x2 - x1;
	const dy = y2 - y1;
	const L = Math.hypot(dx, dy);
	if (L === 0) return [x1, y1]; // Degenerate case

	const mx = (x1 + x2) / 2;
	const my = (y1 + y2) / 2;

	// Unit perpendicular vector
	const nx = -dy / L;
	const ny = dx / L;

	// Bulge distance: proportional to length, but capped
	const d = Math.min(k * L, maxBulge);

	return [mx + side * offset * d * nx, my + side * offset * d * ny];
}

export const getAttachmentPoints = (
	x: number,
	y: number,
	sideLength: number,
	strand: 0 | 1
): [number, number] => {
	//  strand 0
	if (strand === 0) return [x + sideLength / 2, y];
	//  strand 1
	return [x + sideLength / 2, y + (2 * sideLength) / 2];
};

export const direction = (start: [number, number, number], end: [number, number, number]) => {
	if (start[2] === 0 && end[0] <= start[0]) return -1;
	if (start[2] === 1 && end[0] >= start[0]) return -1;
	else return 1;
};

export const directionByX = (startX: number, endX: number, startStrandSet: 0 | 1) => {
	if (startStrandSet === 0 && endX <= startX) return -1;
	if (startStrandSet === 1 && endX >= startX) return -1;
	else return 1;
};
