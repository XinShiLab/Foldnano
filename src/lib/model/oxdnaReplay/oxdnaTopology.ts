export class OxDnaTopologyParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'OxDnaTopologyParseError';
	}
}

/** A classic (per-nucleotide) oxDNA `.top` file, as Foldnano's exporter writes it. */
export interface OxDnaTopology {
	nucleotideCount: number;
	strandCount: number;
	/** 1-based strand id per row. */
	strandIds: Int32Array;
	bases: string[];
	/** Row of the 3′ neighbour, or -1. */
	next: Int32Array;
	/** Row of the 5′ neighbour, or -1. */
	prev: Int32Array;
}

export function parseOxDnaTopology(text: string): OxDnaTopology {
	const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
	if (lines.length === 0) throw new OxDnaTopologyParseError('The topology file is empty.');

	const header = lines[0].trim().split(/\s+/);
	const nucleotideCount = Number(header[0]);
	const strandCount = Number(header[1]);
	if (!Number.isInteger(nucleotideCount) || !Number.isInteger(strandCount) || header.length < 2) {
		throw new OxDnaTopologyParseError(
			'Not a classic oxDNA topology: the first line must be "<nucleotides> <strands>".'
		);
	}
	if (header.length > 2 && header[2].includes('5->3')) {
		throw new OxDnaTopologyParseError(
			'This is a new-format oxDNA topology. Replay expects the .top written by Foldnano.'
		);
	}
	if (lines.length - 1 !== nucleotideCount) {
		throw new OxDnaTopologyParseError(
			`The header says ${nucleotideCount} nucleotides but the file lists ${lines.length - 1}.`
		);
	}

	const strandIds = new Int32Array(nucleotideCount);
	const next = new Int32Array(nucleotideCount);
	const prev = new Int32Array(nucleotideCount);
	const bases: string[] = new Array(nucleotideCount);
	for (let row = 0; row < nucleotideCount; row++) {
		const fields = lines[row + 1].trim().split(/\s+/);
		const strandId = Number(fields[0]);
		const nextRow = Number(fields[2]);
		const prevRow = Number(fields[3]);
		if (
			fields.length < 4 ||
			!Number.isInteger(strandId) ||
			!Number.isInteger(nextRow) ||
			!Number.isInteger(prevRow)
		) {
			throw new OxDnaTopologyParseError(`Line ${row + 2} is not "<strand> <base> <next> <prev>".`);
		}
		strandIds[row] = strandId;
		bases[row] = fields[1].toUpperCase();
		next[row] = nextRow;
		prev[row] = prevRow;
	}
	return { nucleotideCount, strandCount, strandIds, bases, next, prev };
}
