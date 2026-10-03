import type VirtualHelix from '$lib/model/VirtualHelix';
import type { Part } from '$lib/model/Part';
import type { RegionKind } from '$lib/model/Part/DesignRegion';

export type VisibleRegionHeaderRow = {
	kind: 'REGION_HEADER';
	displayRow: number;
	regionId: string;
	regionName: string;
	regionKind: RegionKind;
	vhCount: number;
	isCollapsed: boolean;
};

export type VisibleVhDisplayRow = {
	kind: 'VH';
	displayRow: number;
	regionId: string;
	regionRow: number;
	vh: VirtualHelix;
};

export type VisibleStrandRow = VisibleRegionHeaderRow | VisibleVhDisplayRow;

type QueryRectResult = {
	rows: number[];
	vhIds: string[];
	strands: (0 | 1)[];
	bpIndices: number[];
};

export type StrandRowLayout = ReturnType<typeof createStrandRowLayout>;

export function createStrandRowLayout(
	part: Part,
	collapsedRegionIds: string[],
	radius: number,
	sideLength: number,
	strokeWidth: number
) {
	const rowPitch = 3 * radius;
	const rowOffset = strokeWidth + radius + 20;
	const collapsed = new Set(collapsedRegionIds);

	const getRowY = (displayRow: number) => rowOffset + displayRow * rowPitch;
	const getDisplayRowByY = (y: number) => Math.floor((y - rowOffset + sideLength) / rowPitch);

	const rows: VisibleStrandRow[] = [];
	const displayRowByVhId = new Map<string, number>();
	const regionHeaderById = new Map<string, VisibleRegionHeaderRow>();
	const regionMembers = new Map<string, VirtualHelix[]>();
	const assignedVhIds = new Set<string>();

	for (const vh of part.virtualHelices) {
		const regionId = vh.regionId ?? '';
		const members = regionMembers.get(regionId);
		if (members) {
			members.push(vh);
		} else {
			regionMembers.set(regionId, [vh]);
		}
	}

	for (const region of part.regions) {
		const members = regionMembers.get(region.id) ?? [];
		const header: VisibleRegionHeaderRow = {
			kind: 'REGION_HEADER',
			displayRow: rows.length,
			regionId: region.id,
			regionName: region.name,
			regionKind: region.kind,
			vhCount: members.length,
			isCollapsed: collapsed.has(region.id),
		};
		rows.push(header);
		regionHeaderById.set(region.id, header);
		for (const vh of members) assignedVhIds.add(vh.id);

		if (header.isCollapsed || members.length === 0) continue;

		const byId = new Map(members.map((vh) => [vh.id, vh]));
		let regionRow = 0;
		for (const vhId of region.vhOrder) {
			const vh = byId.get(vhId);
			if (!vh) continue;
			const row: VisibleVhDisplayRow = {
				kind: 'VH',
				displayRow: rows.length,
				regionId: region.id,
				regionRow,
				vh,
			};
			rows.push(row);
			displayRowByVhId.set(vh.id, row.displayRow);
			regionRow += 1;
			byId.delete(vhId);
		}

		for (const vh of members) {
			if (!byId.has(vh.id)) continue;
			const row: VisibleVhDisplayRow = {
				kind: 'VH',
				displayRow: rows.length,
				regionId: region.id,
				regionRow,
				vh,
			};
			rows.push(row);
			displayRowByVhId.set(vh.id, row.displayRow);
			regionRow += 1;
		}
	}

	for (const vh of part.virtualHelices) {
		if (assignedVhIds.has(vh.id) || displayRowByVhId.has(vh.id)) continue;
		const row: VisibleVhDisplayRow = {
			kind: 'VH',
			displayRow: rows.length,
			regionId: vh.regionId ?? '',
			regionRow: 0,
			vh,
		};
		rows.push(row);
		displayRowByVhId.set(vh.id, row.displayRow);
	}

	const visibleVhRows = rows.filter((row): row is VisibleVhDisplayRow => row.kind === 'VH');

	const vhIdToRegionId = new Map<string, string>();
	for (const vh of part.virtualHelices) {
		if (vh.regionId) vhIdToRegionId.set(vh.id, vh.regionId);
	}

	const getVisibleStrandRows = () => rows;
	const getVisibleVhRows = () => visibleVhRows;
	const getRowAtDisplayRow = (displayRow: number) => rows[displayRow] ?? null;
	const getVisibleVhByDisplayRow = (displayRow: number) => {
		const row = getRowAtDisplayRow(displayRow);
		return row?.kind === 'VH' ? row.vh : null;
	};
	const getDisplayRowForVh = (vhId: string) => displayRowByVhId.get(vhId) ?? null;
	const getRegionHeaderRow = (regionId: string) => regionHeaderById.get(regionId) ?? null;

	const getEffectiveDisplayRowForVh = (
		vhId: string
	): { displayRow: number; isCollapsed: boolean } | null => {
		const displayRow = displayRowByVhId.get(vhId);
		if (displayRow !== undefined) return { displayRow, isCollapsed: false };
		const regionId = vhIdToRegionId.get(vhId);
		if (!regionId) return null;
		const headerRow = regionHeaderById.get(regionId);
		if (!headerRow) return null;
		return { displayRow: headerRow.displayRow, isCollapsed: true };
	};

	const getXByBpIdx = (bpIndex: number) => 4 * radius + bpIndex * sideLength;
	const getBpIdxByX = (x: number) => Math.floor((x - 4 * radius) / sideLength);
	const getBpCoords = (displayRow: number, bpIdx: number): [[number, number], [number, number]] => {
		const y = getRowY(displayRow);
		const x = getXByBpIdx(bpIdx);
		return [
			[x, y - sideLength],
			[x, y],
		];
	};

	const getHitGridByXY = (x: number, y: number) => {
		const displayRow = getDisplayRowByY(y);
		const row = getRowAtDisplayRow(displayRow);
		if (!row || row.kind !== 'VH') return null;

		const bpIdx = getBpIdxByX(x);
		const rowYStartedAt = getRowY(displayRow) - sideLength;
		const rowYEndAt = rowYStartedAt + 2 * sideLength;
		if (y < rowYStartedAt || y > rowYEndAt) return null;

		return {
			rowIdx: displayRow,
			strandIdx: (y < rowYStartedAt + sideLength ? 0 : 1) as 0 | 1,
			bpIdx,
		};
	};

	const getFirstRowBelowY = (y: number) => Math.ceil((y - rowOffset) / rowPitch);
	const getLastRowAboveY = (y: number) => Math.floor((y - rowOffset) / rowPitch);
	const getFirstBpIndexRightOfX = (x: number) => Math.ceil((x - 4 * radius) / sideLength);
	const getLastBpIndexLeftOfX = (x: number) => Math.floor((x - 4 * radius) / sideLength);

	const queryRect = (rect: {
		x: number;
		y: number;
		width: number;
		height: number;
	}): QueryRectResult => {
		const rowIds: number[] = [];
		const vhIds: string[] = [];
		const bpIndices: number[] = [];
		const firstRowIdx = getFirstRowBelowY(rect.y);
		const lastRowIdx = getLastRowAboveY(rect.y + rect.height);

		for (let displayRow = firstRowIdx; displayRow <= lastRowIdx; displayRow++) {
			const row = getRowAtDisplayRow(displayRow);
			if (!row || row.kind !== 'VH') continue;
			rowIds.push(displayRow);
			vhIds.push(row.vh.id);
		}

		const firstBpIdx = getFirstBpIndexRightOfX(rect.x);
		const lastBpIdx = getLastBpIndexLeftOfX(rect.x + rect.width);
		for (let bpIdx = firstBpIdx; bpIdx <= lastBpIdx; bpIdx++) {
			bpIndices.push(bpIdx);
		}

		return {
			rows: rowIds,
			vhIds,
			strands: [0, 1],
			bpIndices,
		};
	};

	return {
		rowPitch,
		getVisibleStrandRows,
		getVisibleVhRows,
		getRowAtDisplayRow,
		getVisibleVhByDisplayRow,
		getDisplayRowForVh,
		getEffectiveDisplayRowForVh,
		getRegionHeaderRow,
		getRowY,
		getDisplayRowByY,
		getBpCoords,
		getHitGridByXY,
		queryRect,
	};
}
