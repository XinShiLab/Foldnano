export const getOffsets_honeycomb = (
	isVhIdxEven: boolean,
	strandIndex: 0 | 1,
	col: number,
	row: number
) => {
	if (isVhIdxEven && strandIndex === 0) {
		return [
			{ offset: 1, col: col + 1, row }, // x + 1, y: [1, 11]
			{ offset: 11, col: col + 1, row }, // x + 1, y: [1, 11]
			{ offset: 4, col: col - 1, row }, // x - 1, y: [4, 15]
			{ offset: 15, col: col - 1, row }, // x - 1, y: [4, 15]
			{ offset: 8, col, row: row - 1 }, // x, y - 1: [8, 18]
			{ offset: 18, col, row: row - 1 }, // x, y - 1: [8, 18]
		];
	} else if (isVhIdxEven && strandIndex === 1) {
		return [
			{ offset: -1, col: col - 1, row }, // x - 1, y: [-1]
			{ offset: 6, col: col + 1, row }, // x + 1, y: [6]
			{ offset: 13, col, row: row - 1 }, // x, y - 1: [13]
		];
	} else if (!isVhIdxEven && strandIndex === 0) {
		return [
			{ offset: -1, col: col + 1, row }, // x + 1, y: [-1]
			{ offset: 6, col: col - 1, row }, // x - 1, y: [6]
			{ offset: 13, col, row: row + 1 }, // x, y + 1: [13]
		];
	} else {
		return [
			{ offset: 1, col: col - 1, row }, // x - 1, y: [1, 11]
			{ offset: 11, col: col - 1, row }, // x - 1, y: [1, 11]
			{ offset: 4, col: col + 1, row }, // x + 1, y: [4, 15]
			{ offset: 15, col: col + 1, row }, // x + 1, y: [4, 15]
			{ offset: 8, col, row: row + 1 }, // x, y + 1: [8, 18]
			{ offset: 18, col, row: row + 1 }, // x, y + 1: [8, 18]
		];
	}
};

export const getOffsets_square = (
	isVhIdxEven: boolean,
	strandIndex: 0 | 1,
	col: number,
	row: number
) => {
	if (isVhIdxEven && strandIndex === 0) {
		return [
			{ offset: 4, col: col + 1, row }, // x + 1, y: [1, 11]x
			{ offset: 26, col: col + 1, row }, // x + 1, y: [1, 11]x
			{ offset: 15, col: col + 1, row }, // x - 1, y: [4, 15]x
			{ offset: 18, col: col, row: row + 1 }, // x - 1, y: [4, 15]x
			{ offset: 28, col, row: row + 1 }, // x, y - 1: [8, 18]x
			{ offset: 7, col, row: row + 1 }, // x, y - 1: [8, 18]x
			{ offset: 10, col: col - 1, row }, // x - 1, y: [4, 15]x
			{ offset: 20, col: col - 1, row: row }, // x, y - 1: [8, 18]x
			{ offset: -1, col: col - 1, row: row }, // x, y - 1: [8, 18]x
			{ offset: 2, col: col, row: row - 1 }, // x - 1, y: [4, 15]x
			{ offset: 12, col, row: row - 1 }, // x, y - 1: [8, 18]x
			{ offset: 23, col: col, row: row - 1 }, // x, y - 1: [8, 18]x
		];
	} else if (isVhIdxEven && strandIndex === 1) {
		return [
			{ offset: -1, col: col + 1, row }, // x - 1, y: [-1]
			{ offset: 23, col: col, row: row + 1 }, // x + 1, y: [6]
			{ offset: 15, col: col - 1, row: row }, // x, y - 1: [13]
			{ offset: 7, col, row: row - 1 }, // x, y - 1: [13]
		];
	} else if (!isVhIdxEven && strandIndex === 0) {
		return [
			{ offset: -1, col: col - 1, row }, // x - 1, y: [-1]
			{ offset: 23, col: col, row: row - 1 }, // x + 1, y: [6]
			{ offset: 15, col: col + 1, row: row }, // x, y - 1: [13]
			{ offset: 7, col, row: row + 1 }, // x, y - 1: [13]
		];
	} else {
		return [
			{ offset: 4, col: col - 1, row }, // x + 1, y: [1, 11]x
			{ offset: 26, col: col - 1, row }, // x + 1, y: [1, 11]x
			{ offset: 15, col: col - 1, row }, // x - 1, y: [4, 15]x
			{ offset: 18, col: col, row: row - 1 }, // x - 1, y: [4, 15]x
			{ offset: 28, col, row: row - 1 }, // x, y - 1: [8, 18]x
			{ offset: 7, col, row: row - 1 }, // x, y - 1: [8, 18]x
			{ offset: 10, col: col + 1, row }, // x - 1, y: [4, 15]x
			{ offset: 20, col: col + 1, row: row }, // x, y - 1: [8, 18]x
			{ offset: -1, col: col + 1, row: row }, // x, y - 1: [8, 18]x
			{ offset: 2, col: col, row: row + 1 }, // x - 1, y: [4, 15]x
			{ offset: 12, col, row: row + 1 }, // x, y - 1: [8, 18]x
			{ offset: 23, col: col, row: row + 1 }, // x, y - 1: [8, 18]x
		];
	}
};

export const toCoord = (
	latticeType: 'HONEYCOMB' | 'SQUARE' = 'HONEYCOMB',
	latticeAStep: number,
	isVhIdxEven: boolean,
	strandIdx: 0 | 1,
	col: number,
	row: number,
	bpIdx: number,
	right: boolean = false
) => {
	let offsets = [];
	if (latticeType === 'SQUARE') {
		offsets = getOffsets_square(isVhIdxEven, strandIdx, col, row);
	} else {
		offsets = getOffsets_honeycomb(isVhIdxEven, strandIdx, col, row);
	}

	// const offsets = getOffsets_honeycomb(isVhIdxEven, strandIdx, col, row);

	for (const { offset, col: newCol, row: newRow } of offsets) {
		const effectiveOffset = right ? offset + 1 : offset;
		if ((bpIdx - effectiveOffset) % latticeAStep === 0) {
			return { bpIdx, to: { col: newCol, row: newRow }, right };
		}
	}
	return null;
};
