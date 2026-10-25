import { v4 as uuidv4 } from 'uuid';
import type { Vec3 } from '$lib/model/geometry3d/types';

export type ExternalStructureFormat = 'mrdna' | 'pdb';

export interface OverlayNode {
	id: number;
	position: Vec3;
	base?: string;
	orientation?: [number, number, number, number, number, number, number, number, number];
}

export interface OverlayEdge {
	from: number;
	to: number;
}

export interface OverlayBounds {
	min: Vec3;
	max: Vec3;
	center: Vec3;
	size: Vec3;
}

/** Fields shared by every overlay format. Topology + stats are format-specific. */
export interface BaseOverlay {
	id: string;
	name: string;
	bounds: OverlayBounds;
}

export interface MrdnaOverlay extends BaseOverlay {
	format: 'mrdna';
	nodes: OverlayNode[];
	chainEdges: OverlayEdge[];
	stackEdges: OverlayEdge[];
	threePrimeTerminalIds: number[];
	stats: {
		nucleotideCount: number;
		strandCount: number;
		stackEdgeCount: number;
	};
}

/**
 * One polypeptide chain reduced to its Cα backbone (positions in nm), split into
 * contiguous segments. Bonds are drawn only *within* a segment, so chain breaks
 * (TER), missing residues, and chain-ID reuse never connect with false bonds.
 */
export interface PdbChain {
	id: string;
	segments: Vec3[][];
}

export interface PdbOverlay extends BaseOverlay {
	format: 'pdb';
	/** RCSB accession from the HEADER record (cols 63–66), e.g. "6J6J", if present. */
	pdbId?: string;
	chains: PdbChain[];
	stats: {
		chainCount: number;
		residueCount: number;
	};
}

export type ExternalStructureOverlay = MrdnaOverlay | PdbOverlay;

export class MrdnaOverlayParseError extends Error {
	constructor(
		message: string,
		readonly lineNumber?: number
	) {
		super(lineNumber === undefined ? message : `Line ${lineNumber}: ${message}`);
		this.name = 'MrdnaOverlayParseError';
	}
}

interface MrdnaRow {
	lineNumber: number;
	position: Vec3;
	bpIdx: number;
	stackIdx: number;
	threePrimeIdx: number;
	base?: string;
	orientation?: [number, number, number, number, number, number, number, number, number];
}

function parseFiniteNumber(value: string, lineNumber: number, fieldName: string): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		throw new MrdnaOverlayParseError(`${fieldName} must be a finite number.`, lineNumber);
	}
	return parsed;
}

function parseIndex(value: string, lineNumber: number, fieldName: string): number {
	const parsed = parseFiniteNumber(value, lineNumber, fieldName);
	if (!Number.isInteger(parsed)) {
		throw new MrdnaOverlayParseError(`${fieldName} must be an integer.`, lineNumber);
	}
	if (parsed < -1) {
		throw new MrdnaOverlayParseError(
			`${fieldName} must be -1 or a non-negative index.`,
			lineNumber
		);
	}
	return parsed;
}

function parseOrientation(
	fields: string[],
	lineNumber: number
): [number, number, number, number, number, number, number, number, number] | undefined {
	if (fields.length === 0) return undefined;
	if (fields.length !== 9) {
		throw new MrdnaOverlayParseError(
			'Optional orientation must contain exactly 9 numeric fields.',
			lineNumber
		);
	}
	return fields.map((field, idx) =>
		parseFiniteNumber(field, lineNumber, `orientation field ${idx + 1}`)
	) as [number, number, number, number, number, number, number, number, number];
}

function parseRow(line: string, lineNumber: number): MrdnaRow {
	const fields = line.trim().split(/\s+/);
	if (fields.length < 6) {
		throw new MrdnaOverlayParseError('Expected at least 6 fields.', lineNumber);
	}

	const [x, y, z, bpIdx, stackIdx, threePrimeIdx] = fields;
	const trailing = fields.slice(6);
	let base: string | undefined;
	let orientationFields = trailing;
	if (trailing.length > 0 && /^[ATCG]$/i.test(trailing[0])) {
		base = trailing[0].toUpperCase();
		orientationFields = trailing.slice(1);
	}

	return {
		lineNumber,
		position: {
			x: parseFiniteNumber(x, lineNumber, 'coord_x'),
			y: parseFiniteNumber(y, lineNumber, 'coord_y'),
			z: parseFiniteNumber(z, lineNumber, 'coord_z'),
		},
		bpIdx: parseIndex(bpIdx, lineNumber, 'bp_idx'),
		stackIdx: parseIndex(stackIdx, lineNumber, 'stack_on_three_prime_idx'),
		threePrimeIdx: parseIndex(threePrimeIdx, lineNumber, 'three_prime_idx'),
		base,
		orientation: parseOrientation(orientationFields, lineNumber),
	};
}

function validateIndex(idx: number, count: number, lineNumber: number, fieldName: string): void {
	if (idx !== -1 && idx >= count) {
		throw new MrdnaOverlayParseError(
			`${fieldName} index ${idx} is outside the ${count}-nucleotide file.`,
			lineNumber
		);
	}
}

export function computeBounds(points: Vec3[]): OverlayBounds {
	const min = { x: Infinity, y: Infinity, z: Infinity };
	const max = { x: -Infinity, y: -Infinity, z: -Infinity };
	for (const position of points) {
		min.x = Math.min(min.x, position.x);
		min.y = Math.min(min.y, position.y);
		min.z = Math.min(min.z, position.z);
		max.x = Math.max(max.x, position.x);
		max.y = Math.max(max.y, position.y);
		max.z = Math.max(max.z, position.z);
	}
	const size = { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z };
	return {
		min,
		max,
		size,
		center: {
			x: min.x + size.x / 2,
			y: min.y + size.y / 2,
			z: min.z + size.z / 2,
		},
	};
}

function countStrands(rows: MrdnaRow[]): number {
	const hasPrev = new Uint8Array(rows.length);
	for (const row of rows) {
		if (row.threePrimeIdx !== -1) hasPrev[row.threePrimeIdx] = 1;
	}

	// Linear strands start at 5′ terminals (no predecessor).
	let count = 0;
	const visited = new Uint8Array(rows.length);
	for (let i = 0; i < rows.length; i++) {
		if (hasPrev[i] === 0) {
			count++;
			// Walk the strand to mark all its nucleotides visited.
			let cur = i;
			while (cur !== -1 && !visited[cur]) {
				visited[cur] = 1;
				cur = rows[cur].threePrimeIdx;
			}
		}
	}

	// Circular strands have no 5′ terminal; count each unvisited connected component.
	for (let i = 0; i < rows.length; i++) {
		if (!visited[i]) {
			count++;
			let cur = i;
			while (!visited[cur]) {
				visited[cur] = 1;
				cur = rows[cur].threePrimeIdx;
			}
		}
	}

	return count;
}

export function parseMrdnaOverlay(txt: string, name = 'mrDNA overlay'): MrdnaOverlay {
	const rows: MrdnaRow[] = [];
	for (const [idx, rawLine] of txt.split(/\r?\n/).entries()) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;
		rows.push(parseRow(line, idx + 1));
	}

	if (rows.length === 0) {
		throw new MrdnaOverlayParseError('No nucleotide rows found.');
	}

	for (const row of rows) {
		validateIndex(row.bpIdx, rows.length, row.lineNumber, 'bp_idx');
		validateIndex(row.stackIdx, rows.length, row.lineNumber, 'stack_on_three_prime_idx');
		validateIndex(row.threePrimeIdx, rows.length, row.lineNumber, 'three_prime_idx');
	}

	const nodes: OverlayNode[] = rows.map((row, id) => ({
		id,
		position: row.position,
		base: row.base,
		orientation: row.orientation,
	}));
	const chainEdges = rows.flatMap((row, from) =>
		row.threePrimeIdx === -1 ? [] : [{ from, to: row.threePrimeIdx }]
	);
	const stackEdges = rows.flatMap((row, from) =>
		row.stackIdx === -1 ? [] : [{ from, to: row.stackIdx }]
	);
	const threePrimeTerminalIds = rows.flatMap((row, id) => (row.threePrimeIdx === -1 ? [id] : []));

	return {
		id: uuidv4(),
		name,
		format: 'mrdna',
		nodes,
		chainEdges,
		stackEdges,
		threePrimeTerminalIds,
		bounds: computeBounds(nodes.map((node) => node.position)),
		stats: {
			nucleotideCount: nodes.length,
			strandCount: countStrands(rows),
			stackEdgeCount: stackEdges.length,
		},
	};
}
