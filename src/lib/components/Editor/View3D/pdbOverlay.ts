import type { Vec3 } from '$lib/model/geometry3d/types';
import { computeBounds, type PdbChain, type PdbOverlay } from './externalStructureOverlay';

/** PDB coordinates are in Ångström; the 3D scene works in nm. */
const ANGSTROM_TO_NM = 0.1;

export class PdbOverlayParseError extends Error {
	constructor(
		message: string,
		readonly lineNumber?: number
	) {
		super(lineNumber === undefined ? message : `Line ${lineNumber}: ${message}`);
		this.name = 'PdbOverlayParseError';
	}
}

function parseCoord(line: string, start: number, end: number, lineNumber: number): number {
	const value = Number(line.slice(start, end).trim());
	if (!Number.isFinite(value)) {
		throw new PdbOverlayParseError('Malformed ATOM coordinate.', lineNumber);
	}
	return value;
}

interface ChainAccum {
	id: string;
	segments: Vec3[][];
	/** In-progress run of bonded residues. */
	current: Vec3[];
	lastResSeq: number | null;
	/** A TER was seen — the next Cα must start a new segment. */
	broken: boolean;
}

function getChain(byChain: Map<string, ChainAccum>, order: string[], id: string): ChainAccum {
	let chain = byChain.get(id);
	if (!chain) {
		chain = { id, segments: [], current: [], lastResSeq: null, broken: false };
		byChain.set(id, chain);
		order.push(id);
	}
	return chain;
}

function endSegment(chain: ChainAccum): void {
	if (chain.current.length > 0) {
		chain.segments.push(chain.current);
		chain.current = [];
	}
	chain.lastResSeq = null;
}

/**
 * Parse a PDB file into per-chain Cα backbone traces (positions in nm), split
 * into contiguous segments so chain breaks never draw false bonds.
 *
 * MVP scope: only the first model, only Cα atoms, only the blank/`A` altLoc.
 * Fixed-column layout per the PDB spec — name cols 13–16, altLoc col 17,
 * chainID col 22, resSeq cols 23–26, x/y/z cols 31–54 (1-based). A new segment
 * starts on a TER record or a residue-sequence discontinuity.
 */
export function parsePdbOverlay(txt: string, name = 'PDB overlay'): PdbOverlay {
	const chainOrder: string[] = [];
	const byChain = new Map<string, ChainAccum>();
	let pdbId: string | undefined;

	const lines = txt.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const record = line.slice(0, 6);

		// HEADER carries the 4-char RCSB accession in cols 63–66 (e.g. "6J6J").
		if (record === 'HEADER') {
			const id = line.slice(62, 66).trim().toUpperCase();
			if (id) pdbId = id;
			continue;
		}

		// Only the first model is rendered.
		if (record.trimEnd() === 'ENDMDL') break;

		// TER ends the current run of its chain (next Cα starts a new segment).
		if (record.trimEnd() === 'TER') {
			const chainId = line.charAt(21).trim() || '_';
			const chain = byChain.get(chainId);
			if (chain) {
				endSegment(chain);
				chain.broken = true;
			}
			continue;
		}

		if (record !== 'ATOM  ') continue;

		const atomName = line.slice(12, 16).trim();
		if (atomName !== 'CA') continue;

		const altLoc = line.charAt(16);
		if (altLoc !== ' ' && altLoc !== 'A') continue;

		const lineNumber = i + 1;
		const position: Vec3 = {
			x: parseCoord(line, 30, 38, lineNumber) * ANGSTROM_TO_NM,
			y: parseCoord(line, 38, 46, lineNumber) * ANGSTROM_TO_NM,
			z: parseCoord(line, 46, 54, lineNumber) * ANGSTROM_TO_NM,
		};
		const resSeq = Number(line.slice(22, 26).trim());

		const chainId = line.charAt(21).trim() || '_';
		const chain = getChain(byChain, chainOrder, chainId);

		// Break the run on a TER, or any non-consecutive residue number (gap,
		// reset, or chain-ID reuse).
		const discontinuous =
			chain.broken ||
			(chain.lastResSeq !== null && resSeq - chain.lastResSeq !== 1) ||
			!Number.isFinite(resSeq);
		if (discontinuous) endSegment(chain);

		chain.current.push(position);
		chain.lastResSeq = Number.isFinite(resSeq) ? resSeq : null;
		chain.broken = false;
	}

	const accums = chainOrder.map((id) => byChain.get(id)!);
	for (const chain of accums) endSegment(chain);

	const chains: PdbChain[] = accums.map((chain) => ({ id: chain.id, segments: chain.segments }));
	const allCa = chains.flatMap((chain) => chain.segments.flat());
	if (allCa.length === 0) {
		throw new PdbOverlayParseError('No Cα atoms found in the first model.');
	}

	return {
		id: crypto.randomUUID(),
		name,
		format: 'pdb',
		pdbId,
		chains,
		bounds: computeBounds(allCa),
		stats: {
			chainCount: chains.length,
			residueCount: allCa.length,
		},
	};
}
