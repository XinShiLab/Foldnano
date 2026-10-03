import type { Part } from '$lib/model/Part';
import type Oligo from '$lib/model/Oligo/Oligo.svelte';
import {
	buildOligoSignature,
	describeOligoPositions,
	endpointKey,
	formatOligoKey,
} from '$lib/model/Oligo/oligoKey';

export const OLIGO_REPORT_COLUMNS = [
	'oligoKey',
	'start',
	'end',
	'sequence',
	'length',
	'color',
	'mod5Prime',
	'mod3Prime',
	'positions',
] as const;

export type OligoReportColumn = (typeof OLIGO_REPORT_COLUMNS)[number];

export interface OligoReportRow {
	oligoKey: string;
	signature: string;
	fullOligoId: string;
	start: string;
	end: string;
	sequence: string;
	length: number;
	color: string;
	mod5Prime: string;
	mod3Prime: string;
	positions: string;
	isCircular: boolean;
}

export type OligoDiffStatus = 'unchanged' | 'changed' | 'left-only' | 'right-only';

export interface OligoDiffRow {
	key: string;
	status: OligoDiffStatus;
	left: OligoReportRow | null;
	right: OligoReportRow | null;
	changedColumns: OligoReportColumn[];
}

export interface OligoDiffResult {
	rows: OligoDiffRow[];
	unchanged: OligoDiffRow[];
	changed: OligoDiffRow[];
	leftOnly: OligoDiffRow[];
	rightOnly: OligoDiffRow[];
}

function formatEnd(oligo: Oligo, which: 'five' | 'three'): string {
	const end = which === 'five' ? oligo.fivePrime : oligo.threePrime;
	if (!end) return 'Circular';
	return endpointKey(end.ntIndices);
}

export function collectPartOligoReportRows(part: Part): OligoReportRow[] {
	return part.realOligos.map((oligo) => {
		const isCircular = oligo.isCircular;
		const signature = buildOligoSignature(oligo);
		return {
			oligoKey: formatOligoKey(signature),
			signature,
			fullOligoId: oligo.id,
			start: isCircular ? 'Circular' : formatEnd(oligo, 'five'),
			end: isCircular ? 'Circular' : formatEnd(oligo, 'three'),
			sequence: isCircular ? '' : oligo.sequence || '',
			length: oligo.length,
			color: oligo.color,
			mod5Prime: oligo.fivePrime?.modification || '',
			mod3Prime: oligo.threePrime?.modification || '',
			positions: describeOligoPositions(oligo),
			isCircular,
		};
	});
}

function compareRows(left: OligoReportRow, right: OligoReportRow): OligoReportColumn[] {
	return OLIGO_REPORT_COLUMNS.filter((column) => left[column] !== right[column]);
}

export function diffOligoReportRows(
	leftRows: OligoReportRow[],
	rightRows: OligoReportRow[]
): OligoDiffResult {
	const rightBySignature = new Map<string, number[]>();
	for (const [index, row] of rightRows.entries()) {
		const indices = rightBySignature.get(row.signature) ?? [];
		indices.push(index);
		rightBySignature.set(row.signature, indices);
	}

	const usedRight = new Set<number>();
	const rows: OligoDiffRow[] = [];
	for (const left of leftRows) {
		const candidates = rightBySignature.get(left.signature) ?? [];
		const rightIndex = candidates.find((index) => !usedRight.has(index));
		if (rightIndex === undefined) {
			rows.push({
				key: `left:${left.signature}:${left.fullOligoId}`,
				status: 'left-only',
				left,
				right: null,
				changedColumns: [],
			});
			continue;
		}

		usedRight.add(rightIndex);
		const right = rightRows[rightIndex];
		const changedColumns = compareRows(left, right);
		rows.push({
			key: `matched:${left.signature}:${left.fullOligoId}:${right.fullOligoId}`,
			status: changedColumns.length ? 'changed' : 'unchanged',
			left,
			right,
			changedColumns,
		});
	}

	for (const [index, right] of rightRows.entries()) {
		if (usedRight.has(index)) continue;
		rows.push({
			key: `right:${right.signature}:${right.fullOligoId}`,
			status: 'right-only',
			left: null,
			right,
			changedColumns: [],
		});
	}

	rows.sort((a, b) => {
		const aRow = a.left ?? a.right;
		const bRow = b.left ?? b.right;
		return (aRow?.signature ?? '').localeCompare(bRow?.signature ?? '');
	});

	return {
		rows,
		unchanged: rows.filter((row) => row.status === 'unchanged'),
		changed: rows.filter((row) => row.status === 'changed'),
		leftOnly: rows.filter((row) => row.status === 'left-only'),
		rightOnly: rows.filter((row) => row.status === 'right-only'),
	};
}
