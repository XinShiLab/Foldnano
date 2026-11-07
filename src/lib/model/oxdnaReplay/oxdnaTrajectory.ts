export class OxDnaTrajectoryParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'OxDnaTrajectoryParseError';
	}
}

/** Floats kept per nucleotide: r (3), a1 (3), a3 (3), in oxDNA units. Velocities are dropped. */
export const FRAME_STRIDE = 9;

export interface OxDnaFrame {
	time: number;
	box: [number, number, number];
	/** `FRAME_STRIDE` floats per nucleotide, in row order. */
	data: Float32Array;
}

const LOWER_T = 0x74;
const LOWER_I = 0x69;
const SPACE = 0x20;
const EQUALS = 0x3d;

/**
 * Byte offsets (relative to the file) of every frame header (`t = …`) in `chunk`. Rows hold only
 * numbers, and `b`/`E` lines have no `t`, so every `t` starts a header, even one that is not at a
 * line start (after NUL padding or a cut-off row left by an interrupted run).
 */
export function scanFrameStarts(chunk: Uint8Array, chunkOffset: number): number[] {
	const starts: number[] = [];
	let i = chunk.indexOf(LOWER_T);
	while (i !== -1) {
		// `Infinity` is the one number spelling with a `t`; a header's `t` is followed by ` ` or `=`.
		const after = chunk[i + 1];
		const header =
			after === SPACE || after === EQUALS || (after === undefined && chunk[i - 1] !== LOWER_I);
		if (header) starts.push(chunkOffset + i);
		i = chunk.indexOf(LOWER_T, i + 1);
	}
	return starts;
}

function headerValues(line: string, key: string): number[] {
	const eq = line.indexOf('=');
	if (!line.startsWith(key) || eq === -1) {
		throw new OxDnaTrajectoryParseError(
			`Expected a "${key} = …" line, got "${line.slice(0, 40)}".`
		);
	}
	return line
		.slice(eq + 1)
		.trim()
		.split(/\s+/)
		.map(Number);
}

/** Parses one frame's text (header lines + one row per nucleotide). */
export function parseOxDnaFrame(text: string, expectedNucleotides: number): OxDnaFrame {
	// A crashed run can leave NUL padding where unflushed frames were; it is not data.
	const clean = text.includes('\0') ? text.replace(/\0+/g, '') : text;
	const lines = clean.split('\n');
	let lineIdx = 0;
	const nextLine = () => {
		while (lineIdx < lines.length && lines[lineIdx].trim() === '') lineIdx++;
		return lineIdx < lines.length ? lines[lineIdx++].trim() : '';
	};

	const time = headerValues(nextLine(), 't')[0];
	const boxValues = headerValues(nextLine(), 'b');
	if (boxValues.length < 3 || boxValues.some((v) => !Number.isFinite(v))) {
		throw new OxDnaTrajectoryParseError('The box line must list three numbers.');
	}
	headerValues(nextLine(), 'E');

	const data = new Float32Array(expectedNucleotides * FRAME_STRIDE);
	let row = 0;
	for (; lineIdx < lines.length; lineIdx++) {
		const line = lines[lineIdx];
		if (line.trim() === '') continue;
		if (row >= expectedNucleotides) {
			throw new OxDnaTrajectoryParseError(
				`It has more rows than the ${expectedNucleotides} nucleotides in the topology.`
			);
		}
		const fields = line.trim().split(/\s+/);
		if (fields.length < FRAME_STRIDE) {
			throw new OxDnaTrajectoryParseError(
				`Row ${row} has too few columns; the frame was cut off, likely by an interrupted run.`
			);
		}
		const base = row * FRAME_STRIDE;
		for (let k = 0; k < FRAME_STRIDE; k++) data[base + k] = Number(fields[k]);
		row++;
	}
	if (row !== expectedNucleotides) {
		throw new OxDnaTrajectoryParseError(
			`It has ${row} of the ${expectedNucleotides} rows in the topology; the frame was cut off, likely by an interrupted run.`
		);
	}
	return { time, box: [boxValues[0], boxValues[1], boxValues[2]], data };
}
