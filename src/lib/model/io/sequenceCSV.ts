// Oligo CSV export intentionally requires explicit free 5' and 3' ends.
// Circular DNA must be linearized before export; we do not infer a cut point.

import type { Part } from '../Part/Part.svelte';
import type FoldnanoDocument from '../document.svelte';
import type Oligo from '../Oligo/Oligo.svelte';
import { exportBaseName } from './designFileName';

/** One row in the exported CSV */
interface OligoSequenceRecord {
	Name: string;
	Start: string;
	End: string;
	Sequence: string;
	Length: number;
	Color: string;
	Mod5Prime: string;
	Mod3Prime: string;
}

/** Build a human-readable position string for an oligo's segments */
function describeOligoPositions(oligo: Oligo): string {
	const parts: string[] = [];
	for (const seg of oligo.segments) {
		const a = seg.fivePrime.ntIndices;
		const b = seg.threePrime.ntIndices;
		parts.push(`${a.vhIdx}[${a.bpIdx}]-${b.vhIdx}[${b.bpIdx}]`);
	}
	return parts.join(', ');
}

function circularOligoExportError(oligo: Oligo): Error {
	const kind = oligo.isScaffold ? 'scaffold' : 'staple';
	return new Error(
		`Cannot export oligo CSV while circular ${kind} DNA is present. ` +
			`Break circular oligos to create explicit 5' and 3' ends first. ` +
			`Positions: ${describeOligoPositions(oligo)}`
	);
}

/** Format an end as "<vhIdx>[<bpIdx>]" */
function formatEnd(oligo: Oligo, which: 'five' | 'three'): string {
	const end = which === 'five' ? oligo.fivePrime : oligo.threePrime;
	if (end) {
		const { vhIdx, bpIdx } = end.ntIndices;
		return `${vhIdx}[${bpIdx}]`;
	}
	throw new Error(
		`Cannot export oligo CSV: missing ${which} end. ` +
			`Positions: ${describeOligoPositions(oligo)}`
	);
}

/** Collect sequence records from a single Part */
export function collectPartOligoSequences(part: Part): OligoSequenceRecord[] {
	const rows: OligoSequenceRecord[] = [];
	for (const oligo of part.realOligos) {
		if (oligo.isCircular) {
			throw circularOligoExportError(oligo);
		}
		const Sequence = oligo.sequence || '';
		rows.push({
			Name: oligo.name,
			Start: formatEnd(oligo, 'five'),
			End: formatEnd(oligo, 'three'),
			Sequence,
			Length: oligo.length,
			Color: oligo.color,
			Mod5Prime: oligo.fivePrime?.modification || '',
			Mod3Prime: oligo.threePrime?.modification || '',
		});
	}
	return rows;
}

/** A row of a design with several Parts: which Part, and how many times the design places it. */
interface AssemblyOligoSequenceRecord extends OligoSequenceRecord {
	Part: string;
	Quantity: number;
}

/**
 * Every Part's oligos, each row tagged with its Part and how many instances of that Part the
 * design places (hidden ones too: the order list is what you build, not what 3D shows).
 */
export function collectDocumentOligoSequences(
	doc: FoldnanoDocument
): AssemblyOligoSequenceRecord[] {
	return doc.parts.flatMap((part) => {
		const quantity = doc.assembly.occurrencesOf(part.id).length;
		return collectPartOligoSequences(part).map((record) => ({
			Part: part.name,
			Quantity: quantity,
			...record,
		}));
	});
}

/** Quote a CSV field if needed */
function csvEscape(field: string | number): string {
	const s = String(field);
	return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const PLAIN_COLUMNS = [
	'Name',
	'Start',
	'End',
	'Sequence',
	'Length',
	'Color',
	'Mod5Prime',
	'Mod3Prime',
] as const satisfies readonly (keyof OligoSequenceRecord)[];

const ASSEMBLY_COLUMNS = [
	'Part',
	'Quantity',
	...PLAIN_COLUMNS,
] as const satisfies readonly (keyof AssemblyOligoSequenceRecord)[];

// One serializer for every row: a quoted field may hold a line break, so rows are never split.
function toCSV<R>(columns: readonly (keyof R & string)[], records: R[]): string {
	const rows = records.map((record) =>
		columns.map((column) => csvEscape(record[column] as string | number)).join(',')
	);
	return [columns.join(','), ...rows].join('\n');
}

/** Header Part,Quantity,Name,… : `sequencesToCSV` with the two assembly columns first. */
export function assemblySequencesToCSV(records: AssemblyOligoSequenceRecord[]): string {
	return toCSV(ASSEMBLY_COLUMNS, records);
}

/** Turn records into CSV string with header Name,Start,End,Sequence,Length,Color,Mod5Prime,Mod3Prime */
export function sequencesToCSV(records: OligoSequenceRecord[]): string {
	return toCSV(PLAIN_COLUMNS, records);
}

/** Convenience: export one Part to CSV, named after its document (`docName`). */
export function exportPartSequencesToCSV(part: Part, docName: string) {
	const csvString = sequencesToCSV(collectPartOligoSequences(part));
	downloadCSVAsTextFile(exportBaseName(docName), csvString);
	return;
}

/**
 * True when an order list needs `Part` and `Quantity` columns: the design has several Parts, or
 * places one more than once. A single Part placed once keeps the plain format.
 */
export function documentNeedsQuantities(doc: FoldnanoDocument): boolean {
	return doc.parts.length > 1 || doc.parts.some((p) => doc.assembly.occurrencesOf(p.id).length > 1);
}

/**
 * The design's oligo CSV: the plain one-Part format for a single Part placed once, else every
 * Part's rows with `Part` and `Quantity` columns (see `documentNeedsQuantities`).
 */
export function documentSequencesCSV(doc: FoldnanoDocument): string {
	if (!documentNeedsQuantities(doc)) {
		return sequencesToCSV(doc.parts[0] ? collectPartOligoSequences(doc.parts[0]) : []);
	}
	return assemblySequencesToCSV(collectDocumentOligoSequences(doc));
}

/** Convenience: export the whole design to CSV (see `documentSequencesCSV`). */
export function exportDocumentSequencesToCSV(doc: FoldnanoDocument) {
	downloadCSVAsTextFile(exportBaseName(doc.name), documentSequencesCSV(doc));
}

/** Trigger a download of the provided CSV text as a .csv file (browser only). */
export function downloadCSVAsTextFile(filename: string, csv: string): void {
	if (typeof window === 'undefined' || typeof document === 'undefined') {
		throw new Error('downloadCSVAsTextFile can only be used in a browser environment');
	}
	const safeName = filename.endsWith('.csv') ? filename : `${filename}.csv`;
	const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = safeName;
	a.style.display = 'none';
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}
