// Oligo CSV export intentionally requires explicit free 5' and 3' ends.
// Circular DNA must be linearized before export; we do not infer a cut point.

import type { Part } from '../Part/Part.svelte';
import type FoldnanoDocument from '../document.svelte';
import type Oligo from '../Oligo/Oligo.svelte';

/** One row in the exported CSV */
interface OligoSequenceRecord {
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

/** Collect sequence records from entire Document (all Parts concatenated) */
export function collectDocumentOligoSequences(doc: FoldnanoDocument): OligoSequenceRecord[] {
	const all: OligoSequenceRecord[] = [];
	for (const part of doc.parts) {
		all.push(...collectPartOligoSequences(part));
	}
	return all;
}

/** Quote a CSV field if needed */
function csvEscape(field: string | number): string {
	const s = String(field);
	return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Turn records into CSV string with header Start,End,Sequence,Length,Color,Mod5Prime,Mod3Prime */
export function sequencesToCSV(records: OligoSequenceRecord[]): string {
	const header = 'Start,End,Sequence,Length,Color,Mod5Prime,Mod3Prime';
	const lines = records.map((r) =>
		[r.Start, r.End, r.Sequence, r.Length, r.Color, r.Mod5Prime, r.Mod3Prime]
			.map(csvEscape)
			.join(',')
	);
	return [header, ...lines].join('\n');
}

/** Convenience: export one Part to CSV */
export function exportPartSequencesToCSV(part: Part) {
	const csvString = sequencesToCSV(collectPartOligoSequences(part));
	downloadCSVAsTextFile(part.name || 'part_sequences', csvString);
	return;
}

/** Convenience: export entire Document to CSV */
export function exportDocumentSequencesToCSV(doc: FoldnanoDocument) {
	const csvString = sequencesToCSV(collectDocumentOligoSequences(doc));
	downloadCSVAsTextFile(doc.name || 'part_sequences', csvString);
	return;
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
