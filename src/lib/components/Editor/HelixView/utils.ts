export type LatticeType = 'HONEYCOMB' | 'SQUARE';
export type LatticeCell = { col: number; row: number };

const getHoneycombCoordsByIndex = (
	col: number,
	row: number,
	radius: number,
	strokeWidth: number
) => {
	const hr = Math.floor(row / 2);
	const x = col * (Math.sqrt(3) * radius);
	const y =
		row % 2 === 0
			? hr * 6 * radius + (col % 2) * radius
			: hr * 6 * radius + 4 * radius - (col % 2) * radius;

	const offset = radius + strokeWidth;
	return { x: x + offset, y: y + offset };
};

const getSquareCoordsByIndex = (col: number, row: number, step: number, strokeWidth: number) => {
	const x = col * step;
	const y = row * step;

	const offset = step / 2 + strokeWidth;
	return { x: x + offset, y: y + offset };
};

export const getCanvasPositionByIndex = (
	col: number,
	row: number,
	radius: number,
	strokeWidth: number,
	latticeType: LatticeType = 'HONEYCOMB'
) => {
	if (latticeType === 'SQUARE') {
		return getSquareCoordsByIndex(col, row, radius * 2, strokeWidth);
	} else {
		return getHoneycombCoordsByIndex(col, row, radius, strokeWidth);
	}
	// const x = getHoneycombCoordsByIndex(col, row, radius, strokeWidth).x;
	// const y = getHoneycombCoordsByIndex(col, row, radius, strokeWidth).y;

	// return { x, y };
};

export function getLatticeCircleBounds(
	col: number,
	row: number,
	radius: number,
	strokeWidth: number,
	latticeType: LatticeType
) {
	const { x, y } = getCanvasPositionByIndex(col, row, radius, strokeWidth, latticeType);
	return {
		minX: x - radius,
		minY: y - radius,
		maxX: x + radius,
		maxY: y + radius,
	};
}

export function getNearestLatticeCell(
	x: number,
	y: number,
	numCols: number,
	numRows: number,
	radius: number,
	strokeWidth: number,
	latticeType: LatticeType
): LatticeCell | null {
	let closest: LatticeCell | null = null;
	let minDistanceSq = Number.POSITIVE_INFINITY;

	for (let col = 0; col < numCols; col++) {
		for (let row = 0; row < numRows; row++) {
			const point = getCanvasPositionByIndex(col, row, radius, strokeWidth, latticeType);
			const dx = point.x - x;
			const dy = point.y - y;
			const distanceSq = dx * dx + dy * dy;
			if (distanceSq >= minDistanceSq) continue;
			minDistanceSq = distanceSq;
			closest = { col, row };
		}
	}

	return closest;
}
