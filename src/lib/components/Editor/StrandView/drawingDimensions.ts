import type { StrandRowLayout, VisibleStrandRow } from './strandRowLayout';

export type DrawingDimensions = ReturnType<typeof createDrawingDimensions>;
export function createDrawingDimensions(
	radius: number,
	sideLength: number,
	strokeWidth: number,
	getRowLayout?: () => StrandRowLayout
) {
	const getLayout = () => getRowLayout?.();

	const getRowYByRowIdx = (rowIndex: number) => {
		return getLayout()?.getRowY(rowIndex) ?? strokeWidth + radius + rowIndex * 3 * radius + 20;
	};
	const getRowIdxByY = (y: number) => {
		return (
			getLayout()?.getDisplayRowByY(y) ??
			Math.floor((y - (strokeWidth + radius + 20) + sideLength) / (3 * radius))
		);
	};
	const getXByBpIdx = (bpIndex: number) => {
		return 4 * radius + bpIndex * sideLength;
	};
	const getBpIdxByX = (x: number) => {
		return Math.floor((x - 4 * radius) / sideLength);
	};
	const getBpCoordsByRowAndBpIdx = (
		rowIdx: number,
		bpIdx: number
	): [[number, number], [number, number]] => {
		return (
			getLayout()?.getBpCoords(rowIdx, bpIdx) ??
			(() => {
				const ry = getRowYByRowIdx(rowIdx);
				const x = getXByBpIdx(bpIdx);
				const y1 = ry - sideLength;
				const y2 = ry;
				return [
					[x, y1],
					[x, y2],
				];
			})()
		);
	};

	const getHitGridByXY = (x: number, y: number) => {
		return (
			getLayout()?.getHitGridByXY(x, y) ??
			(() => {
				const rowIdx = getRowIdxByY(y);
				const bpIdx = getBpIdxByX(x);
				const rowYStartedAt = getRowYByRowIdx(rowIdx) - sideLength;
				const rowYEndAt = rowYStartedAt + 2 * sideLength;

				if (y < rowYStartedAt || y > rowYEndAt) {
					return null;
				}

				const strandIdx = y < rowYStartedAt + sideLength ? 0 : (1 as 0 | 1);

				return {
					rowIdx,
					strandIdx,
					bpIdx,
				};
			})()
		);
	};

	const withOffset = (bpCoords: [number, number][], offset: [number, number]) => {
		return bpCoords.map(([x, y]) => [x + offset[0], y + offset[1]]);
	};

	const queryRect = (rect: { x: number; y: number; width: number; height: number }) => {
		return (
			getLayout()?.queryRect(rect) ??
			(() => {
				const rows: number[] = [];
				const strands: (0 | 1)[] = [];
				const bpIndices: number[] = [];

				const firstRowIdx = Math.ceil((rect.y - (strokeWidth + radius + 20)) / (3 * radius));
				const lastRowIdx = Math.floor(
					(rect.y + rect.height - (strokeWidth + radius + 20)) / (3 * radius)
				);
				for (let rowIdx = firstRowIdx; rowIdx <= lastRowIdx; rowIdx++) {
					rows.push(rowIdx);
				}

				const firstBpIdx = Math.ceil((rect.x - 4 * radius) / sideLength);
				const lastBpIdx = Math.floor((rect.x + rect.width - 4 * radius) / sideLength);
				for (let bpIdx = firstBpIdx; bpIdx <= lastBpIdx; bpIdx++) {
					bpIndices.push(bpIdx);
				}

				strands.push(0);
				strands.push(1);

				return {
					rows,
					vhIds: rows
						.map((rowIdx) => getLayout()?.getVisibleVhByDisplayRow(rowIdx)?.id)
						.filter((vhId): vhId is string => vhId !== undefined),
					strands,
					bpIndices,
				};
			})()
		);
	};

	return {
		dimensions: {
			radius,
			sideLength,
			strokeWidth,
		},
		getRowYByRowIdx,
		getRowIdxByY,
		getXByBpIdx,
		getBpIdxByX,
		// getRowBpByXY,
		getBpCoordsByRowAndBpIdx,
		getHitGridByXY,
		withOffset,
		queryRect,
		getVisibleStrandRows: () => getLayout()?.getVisibleStrandRows() ?? [],
		getVisibleVhRows: () => getLayout()?.getVisibleVhRows() ?? [],
		getVisibleVhByDisplayRow: (displayRow: number) =>
			getLayout()?.getVisibleVhByDisplayRow(displayRow) ?? null,
		getDisplayRowForVh: (vhId: string) => getLayout()?.getDisplayRowForVh(vhId) ?? null,
		getEffectiveDisplayRowForVh: (vhId: string) =>
			getLayout()?.getEffectiveDisplayRowForVh(vhId) ?? null,
		getRowAtDisplayRow: (displayRow: number): VisibleStrandRow | null =>
			getLayout()?.getRowAtDisplayRow(displayRow) ?? null,
	};
}
