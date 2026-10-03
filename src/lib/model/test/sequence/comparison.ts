// Compares Foldnano's generated sequences against cadnano 2.5 over the published corpus.
//
// Both sides start from the same original design file and are given the same scaffold. The cadnano
// side is produced by scripts/gen_reference_sequences.py through `Oligo.sequenceExport` — cadnano's
// own export path. Neither side ever reads the other.

import * as fs from 'fs';

import { CadnanoJSON } from '$lib/model/io/cadnanoJSON';
import { collectPartOligoSequences } from '$lib/model/io/sequenceCSV';
import {
	breakOligoCmd,
	fillSequenceToOligoCmd,
	toggleOligoAsScaffoldCmd,
} from '$lib/commands/strands';
import { HistoryStack } from '$lib/commands/history.svelte';
import FoldnanoDocument from '$lib/model/document.svelte';
import { StorageManager } from '$lib/services/storage/StorageManager';
import type { StorageProvider } from '$lib/services/storage/StorageProvider';
import type { ProviderInfo } from '$lib/services/storage/types';
import type { Part } from '$lib/model/Part';
import type Oligo from '$lib/model/Oligo/Oligo.svelte';
import type OligoSegment from '$lib/model/Oligo/OligoSegment.svelte';

import { byCodeUnit } from '../support/report-output';
import { sha256Text } from '../support/content-hash';
import {
	type BreakPoint,
	designJsonPath,
	type DesignProvenance,
	provenance,
	readScaffold,
	referenceCsvPath,
} from './fixtures';

/** Match lengths reported by the physical control, and the fixed seed for its negative control. */
export const MATCH_THRESHOLDS = [10, 14, 20] as const;
export const SHUFFLE_SEED = 20260814;

export interface OligoRow {
	start: string;
	end: string;
	sequence: string;
	length: number;
	color: string;
}

/** No kind is acceptable; they exist so a failure says which disagreement it was. */
export type DifferenceKind =
	'referenceUnsequenced' | 'generatedUnsequenced' | 'baseMismatch' | 'lengthMismatch';

export interface RouteDifference {
	route: string;
	kind: DifferenceKind;
	referenceLength: number;
	generatedLength: number;
	differingPositions: number;
	referenceExcerpt: string;
	generatedExcerpt: string;
}

/** Outside the identity rule: Foldnano generates colours the source omits, cadnano uses a default. */
export interface ColorAgreement {
	matched: number;
	generated: number;
	unexplained: string[];
}

/** Reverse-complement correspondence against the scaffold, with a seeded negative control. */
export interface PhysicalControl {
	stretches: number;
	seed: number;
	real: Record<number, number>;
	shuffled: Record<number, number>;
}

export interface DesignResult {
	design: string;
	error: string | null;
	scaffoldFile: string;
	scaffoldRouteLength: number;
	scaffoldCircular: boolean;
	linearizedAt: BreakPoint | null;
	referenceOligos: number;
	generatedOligos: number;
	/** Bijective four-field matches: 5' end, 3' end, length, and sequence all agree. */
	exactMatches: number;
	nonExactReference: number;
	nonExactGenerated: number;
	differences: RouteDifference[];
	unmatchedReferenceRoutes: string[];
	unmatchedGeneratedRoutes: string[];
	oligoNt: number;
	unsequencedNt: number;
	fillLeftover: number;
	fillMissing: number;
	circularExcluded: number;
	/** Compared oligos routed through cadnano's `scaf` slot; a `stap`-keyed selection would omit them. */
	scafSlotOligos: number;
	exporterAgrees: boolean | null;
	exporterError: string | null;
	modificationsEmpty: boolean;
	colors: ColorAgreement;
	verdict: 'exact' | 'differences';
}

/* ------------------------------------------------------------------ *
 * Reference CSV
 * ------------------------------------------------------------------ */

const ENDPOINT_PATTERN = /^\d+\[\d+\]$/;

/** Validated here so a malformed fixture reports itself instead of looking like a disagreement. */
export function parseReferenceCSV(text: string, design: string): OligoRow[] {
	const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
	const header = lines[0];
	if (header !== 'Start,End,Sequence,Length,Color') {
		throw new Error(`${design}: unexpected CSV header "${header}"`);
	}

	const rows = lines.slice(1).map((line) => {
		const parts = line.split(',');
		if (parts.length !== 5) throw new Error(`${design}: malformed row "${line}"`);
		const [start, end, sequence, rawLength, color] = parts;

		if (!ENDPOINT_PATTERN.test(start) || !ENDPOINT_PATTERN.test(end)) {
			throw new Error(`${design}: endpoints must look like vh[bp], got "${start}" -> "${end}"`);
		}
		const length = Number(rawLength);
		if (!Number.isInteger(length) || length <= 0) {
			throw new Error(`${design}: ${start} has a non-positive-integer length "${rawLength}"`);
		}
		// Compared independently of the declared column, so the two cannot disagree unnoticed.
		if (sequence.length !== length) {
			throw new Error(
				`${design}: ${start} declares length ${length} but carries ${sequence.length} characters`
			);
		}
		const stray = [...new Set(sequence.toUpperCase())].filter(
			(character) => !'ACGT?'.includes(character)
		);
		if (stray.length > 0) {
			throw new Error(`${design}: ${start} contains unexpected character(s) ${stray.join(', ')}`);
		}
		return { start, end, sequence, length, color };
	});

	const routes = new Set<string>();
	for (const row of rows) {
		const route = `${row.start} → ${row.end}`;
		if (routes.has(route)) throw new Error(`${design}: route ${route} appears twice`);
		routes.add(route);
	}
	return rows;
}

/** cadnano writes '?' for an unsequenced position; Foldnano writes 'N'. */
export function normalizeSequence(sequence: string): string {
	return sequence.toUpperCase().replace(/\?/g, 'N');
}

export function countUnsequenced(rows: OligoRow[]): number {
	return rows.reduce(
		(sum, row) => sum + (normalizeSequence(row.sequence).match(/N/g)?.length ?? 0),
		0
	);
}

export function readReferenceCSV(design: string): OligoRow[] {
	return parseReferenceCSV(fs.readFileSync(referenceCsvPath(design), 'utf-8'), design);
}

/* ------------------------------------------------------------------ *
 * Foldnano side
 * ------------------------------------------------------------------ */

/** Mock storage provider — the comparison never persists anything. */
class MockStorageProvider implements StorageProvider {
	async saveDocument(): Promise<boolean> {
		return true;
	}
	async loadDocument(): Promise<object | null> {
		return null;
	}
	async deleteDocument(): Promise<boolean> {
		return true;
	}
	async getDocumentList(): Promise<[]> {
		return [];
	}
	async saveContext(): Promise<boolean> {
		return true;
	}
	async loadContext(): Promise<object | null> {
		return null;
	}
	getProviderInfo(): ProviderInfo {
		return { name: 'memory', type: 'memory', description: 'in-memory test provider' };
	}
	async isAvailable(): Promise<boolean> {
		return true;
	}
}

export function importDesign(design: string): Part {
	const raw = JSON.parse(fs.readFileSync(designJsonPath(design), 'utf-8'));
	return new CadnanoJSON(raw.name, raw.vstrands).toPart();
}

/** A tie is refused, not broken: each side would resolve it from its own iteration order. */
export function longestOligo(part: Part): Oligo {
	let longest: Oligo | null = null;
	let tied = false;
	for (const oligo of part.oligos) {
		if (!longest || oligo.length > longest.length) {
			longest = oligo;
			tied = false;
		} else if (oligo.length === longest.length) {
			tied = true;
		}
	}
	if (!longest) throw new Error('no oligos in part');
	if (tied) {
		throw new Error(
			`two oligos tie for longest (${longest.length} nt); the scaffold choice is not reproducible`
		);
	}
	return longest;
}

/**
 * Locate the segment whose 5' end the recorded break enters, verifying both halves first. A different
 * cut rotates every sequence, so the coordinates are checked rather than trusted.
 */
function segmentAtRecordedBreak(
	scaffold: Oligo,
	breakPoint: BreakPoint,
	design: string
): OligoSegment {
	const { from, to } = breakPoint;

	const candidates = [...scaffold.segments].filter((segment) => {
		const fivePrime = segment.fivePrime;
		if (fivePrime.isFree) return false;
		const { vhIdx, bpIdx } = fivePrime.ntIndices;
		return vhIdx === to.vh && bpIdx === to.bp;
	});

	if (candidates.length === 0) {
		throw new Error(`${design}: no connected 5' end at vh${to.vh}[${to.bp}]`);
	}
	// A scaffold can occupy both strand sets of a helix, so vh[bp] does not name a unique end.
	if (candidates.length > 1) {
		throw new Error(
			`${design}: ${candidates.length} scaffold 5' ends sit at vh${to.vh}[${to.bp}]; the recorded break is ambiguous`
		);
	}

	const partner = candidates[0].fivePrime.connectedSegment;
	if (!partner) {
		throw new Error(`${design}: the 5' end at vh${to.vh}[${to.bp}] is not connected to anything`);
	}
	const partnerEnd = partner.threePrime.ntIndices;
	if (partnerEnd.vhIdx !== from.vh || partnerEnd.bpIdx !== from.bp) {
		throw new Error(
			`${design}: vh${to.vh}[${to.bp}] is connected to vh${partnerEnd.vhIdx}[${partnerEnd.bpIdx}], ` +
				`but the provenance records vh${from.vh}[${from.bp}]`
		);
	}
	return candidates[0];
}

/**
 * cadnano's `scaf` slot is a rendering convention, not scaffold identity: even virtual helices map it
 * to `strandSets[0]` and odd ones to `strandSets[1]`. See docs/cadnano-import.md.
 */
function isInScafSlot(segment: OligoSegment): boolean {
	const scafStrandIdx = segment.inVirtualHelix.index % 2 === 0 ? 0 : 1;
	return segment.inStrandIndex === scafStrandIdx;
}

function collectOligos(
	part: Part,
	scaffold: Oligo
): { rows: OligoRow[]; circular: number; scafSlot: number } {
	const rows: OligoRow[] = [];
	let circular = 0;
	let scafSlot = 0;
	for (const oligo of part.oligos) {
		if (oligo === scaffold) continue;
		const fivePrime = oligo.fivePrime;
		const threePrime = oligo.threePrime;
		// A circular oligo has no terminus to label, and cadnano's exporter refuses it outright, so
		// both sides exclude it. The counts are compared, so they cannot exclude different oligos.
		if (!fivePrime || !threePrime) {
			circular += 1;
			continue;
		}
		if ([...oligo.segments].some(isInScafSlot)) scafSlot += 1;
		rows.push({
			start: `${fivePrime.ntIndices.vhIdx}[${fivePrime.ntIndices.bpIdx}]`,
			end: `${threePrime.ntIndices.vhIdx}[${threePrime.ntIndices.bpIdx}]`,
			sequence: oligo.sequence || '',
			length: oligo.length,
			color: oligo.color,
		});
	}
	return { rows, circular, scafSlot };
}

/** Import the design, apply the scaffold, and return the generated rows. */
function generateOligos(
	design: string,
	meta: DesignProvenance
): {
	part: Part;
	scaffold: Oligo;
	rows: OligoRow[];
	circular: number;
	scafSlot: number;
	leftover: number;
	missing: number;
} {
	const part = importDesign(design);
	const scaffold = longestOligo(part);

	// If the two sides reconstructed different scaffold routes from the same file, every number
	// downstream would be comparing different things.
	if (scaffold.length !== meta.scaffoldRouteLength) {
		throw new Error(
			`${design}: scaffold route is ${scaffold.length} nt here but ${meta.scaffoldRouteLength} nt in the reference`
		);
	}
	if (scaffold.isCircular !== meta.scaffoldCircular) {
		throw new Error(`${design}: the two sides disagree on whether the scaffold route is circular`);
	}

	// The history is built before any mutation so every edit below runs through a command, as
	// CLAUDE.md requires — including the linearisation, which is a structural edit.
	const doc = new FoldnanoDocument(design);
	doc.parts = [part];
	const storageManager = new StorageManager('memory');
	storageManager.registerProvider('memory', new MockStorageProvider());
	const history = new HistoryStack(doc, storageManager);

	if (scaffold.isCircular) {
		if (!meta.linearizedAt) throw new Error(`${design}: circular scaffold with no recorded break`);
		const segment = segmentAtRecordedBreak(scaffold, meta.linearizedAt, design);
		breakOligoCmd({ part, oligo: scaffold, segment, atIndex: segment.fivePrime.index }, history);
		if (scaffold.isCircular) throw new Error(`${design}: scaffold still circular after the break`);
	}
	if (!scaffold.isScaffold) toggleOligoAsScaffoldCmd({ oligo: scaffold }, history);

	const sequence = readScaffold(meta.scaffoldFile);
	if (sequence.length !== meta.scaffoldLength) {
		throw new Error(
			`${design}: ${meta.scaffoldFile} is ${sequence.length} nt on disk but the reference used ${meta.scaffoldLength} nt`
		);
	}

	const fill = fillSequenceToOligoCmd({ oligo: scaffold, sequence, lockSequence: true }, history);
	if (fill.length !== 1) throw new Error(`${design}: expected one fill result, got ${fill.length}`);

	const { rows, circular, scafSlot } = collectOligos(part, scaffold);
	return {
		part,
		scaffold,
		rows,
		circular,
		scafSlot,
		leftover: fill[0].leftover.length,
		missing: fill[0].missing,
	};
}

/* ------------------------------------------------------------------ *
 * Comparison
 * ------------------------------------------------------------------ */

export function routeOf(row: OligoRow): string {
	return `${row.start} → ${row.end}`;
}

/** The identity rule: 5' end, 3' end, length, and sequence must all agree. */
function identityKey(row: OligoRow): string {
	return `${row.start}|${row.end}|${row.length}|${normalizeSequence(row.sequence)}`;
}

function excerpt(sequence: string): string {
	const normalized = normalizeSequence(sequence);
	return normalized.length > 50 ? `${normalized.slice(0, 50)}…` : normalized;
}

function classifyDifference(reference: OligoRow, generated: OligoRow): RouteDifference {
	const referenceSequence = normalizeSequence(reference.sequence);
	const generatedSequence = normalizeSequence(generated.sequence);

	if (
		reference.length !== generated.length ||
		referenceSequence.length !== generatedSequence.length
	) {
		return {
			route: routeOf(reference),
			kind: 'lengthMismatch',
			referenceLength: reference.length,
			generatedLength: generated.length,
			differingPositions: Math.abs(referenceSequence.length - generatedSequence.length),
			referenceExcerpt: excerpt(reference.sequence),
			generatedExcerpt: excerpt(generated.sequence),
		};
	}

	let differing = 0;
	let referenceGaps = 0;
	let generatedGaps = 0;
	for (let i = 0; i < referenceSequence.length; i += 1) {
		if (referenceSequence[i] === generatedSequence[i]) continue;
		differing += 1;
		if (referenceSequence[i] === 'N') referenceGaps += 1;
		if (generatedSequence[i] === 'N') generatedGaps += 1;
	}

	let kind: DifferenceKind = 'baseMismatch';
	if (differing > 0 && referenceGaps === differing) kind = 'referenceUnsequenced';
	else if (differing > 0 && generatedGaps === differing) kind = 'generatedUnsequenced';

	return {
		route: routeOf(reference),
		kind,
		referenceLength: reference.length,
		generatedLength: generated.length,
		differingPositions: differing,
		referenceExcerpt: excerpt(reference.sequence),
		generatedExcerpt: excerpt(generated.sequence),
	};
}

/** Bijection over all four fields, so a repeated sequence cannot inflate the agreement count. */
export function compareOligos(reference: OligoRow[], generated: OligoRow[]) {
	const pool = new Map<string, OligoRow[]>();
	for (const row of reference) {
		const key = identityKey(row);
		const bucket = pool.get(key);
		if (bucket) bucket.push(row);
		else pool.set(key, [row]);
	}

	let exactMatches = 0;
	const leftoverGenerated: OligoRow[] = [];
	for (const row of generated) {
		const bucket = pool.get(identityKey(row));
		if (bucket && bucket.length > 0) {
			bucket.pop();
			exactMatches += 1;
		} else {
			leftoverGenerated.push(row);
		}
	}
	const leftoverReference = [...pool.values()].flat();

	const byRoute = new Map<string, OligoRow>();
	for (const row of leftoverReference) byRoute.set(routeOf(row), row);

	const differences: RouteDifference[] = [];
	const unmatchedGeneratedRoutes: string[] = [];
	for (const row of leftoverGenerated) {
		const route = routeOf(row);
		const counterpart = byRoute.get(route);
		if (!counterpart) {
			unmatchedGeneratedRoutes.push(route);
			continue;
		}
		byRoute.delete(route);
		differences.push(classifyDifference(counterpart, row));
	}
	const unmatchedReferenceRoutes = [...byRoute.keys()];

	differences.sort((left, right) => byCodeUnit(left.route, right.route));
	unmatchedReferenceRoutes.sort();
	unmatchedGeneratedRoutes.sort();

	return {
		exactMatches,
		nonExactReference: leftoverReference.length,
		nonExactGenerated: leftoverGenerated.length,
		differences,
		unmatchedReferenceRoutes,
		unmatchedGeneratedRoutes,
	};
}

/** The comparison reads the model directly, so without this the toolbar path is never exercised. */
function exporterReproduces(
	part: Part,
	scaffold: Oligo,
	expected: OligoRow[]
): { agrees: boolean | null; error: string | null; modificationsEmpty: boolean } {
	let exported;
	try {
		exported = collectPartOligoSequences(part);
	} catch (error) {
		return {
			agrees: null,
			error: error instanceof Error ? error.message : String(error),
			modificationsEmpty: true,
		};
	}

	const scaffoldEnd = scaffold.fivePrime;
	if (!scaffoldEnd) {
		return {
			agrees: null,
			error: 'the scaffold has no free 5′ end, so its exported row cannot be identified',
			modificationsEmpty: true,
		};
	}
	const scaffoldRow = `${scaffoldEnd.ntIndices.vhIdx}[${scaffoldEnd.ntIndices.bpIdx}]`;

	// Removing the scaffold must remove exactly one row: zero would mean the exporter stopped
	// emitting it, more than one that another oligo collided with its identity.
	const withoutScaffold = exported.filter(
		(row) => !(row.Start === scaffoldRow && row.Length === scaffold.length)
	);
	if (exported.length - withoutScaffold.length !== 1) {
		return {
			agrees: null,
			error: `expected exactly one exported scaffold row at ${scaffoldRow}, found ${exported.length - withoutScaffold.length}`,
			modificationsEmpty: true,
		};
	}

	// The exporter's records are PascalCase; the rows collected off the model are camelCase.
	const fromExporter = withoutScaffold
		.map((row) => `${row.Start}|${row.End}|${row.Length}|${normalizeSequence(row.Sequence)}`)
		.sort();
	const fromModel = expected
		.map((row) => `${row.start}|${row.end}|${row.length}|${normalizeSequence(row.sequence)}`)
		.sort();

	return {
		agrees:
			fromExporter.length === fromModel.length &&
			fromExporter.every((row, index) => row === fromModel[index]),
		error: null,
		modificationsEmpty: exported.every((row) => row.Mod5Prime === '' && row.Mod3Prime === ''),
	};
}

/** A second import tells generated colours from read ones: only generated colours move. */
function compareColors(
	design: string,
	generated: OligoRow[],
	reference: OligoRow[]
): ColorAgreement {
	const second = importDesign(design);
	const secondColors = new Map<string, string>();
	for (const oligo of second.oligos) {
		const fivePrime = oligo.fivePrime;
		const threePrime = oligo.threePrime;
		if (!fivePrime || !threePrime) continue;
		const route =
			`${fivePrime.ntIndices.vhIdx}[${fivePrime.ntIndices.bpIdx}]` +
			` → ${threePrime.ntIndices.vhIdx}[${threePrime.ntIndices.bpIdx}]`;
		secondColors.set(route, oligo.color);
	}

	const referenceColors = new Map(
		reference.map((row) => [routeOf(row), row.color.trim().toLowerCase()])
	);

	let matched = 0;
	let generatedColors = 0;
	const unexplained: string[] = [];
	for (const row of generated) {
		const route = routeOf(row);
		const expected = referenceColors.get(route);
		if (expected === undefined) continue;
		if (row.color.trim().toLowerCase() === expected) {
			matched += 1;
			continue;
		}
		const secondColor = secondColors.get(route);
		if (secondColor !== undefined && secondColor !== row.color) generatedColors += 1;
		else unexplained.push(route);
	}

	unexplained.sort();
	return { matched, generated: generatedColors, unexplained };
}

/* ------------------------------------------------------------------ *
 * Physical control
 * ------------------------------------------------------------------ */

const COMPLEMENT: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A' };

function reverseComplement(sequence: string): string {
	let out = '';
	for (let i = sequence.length - 1; i >= 0; i -= 1) out += COMPLEMENT[sequence[i]];
	return out;
}

/** Deterministic PRNG, so the negative control is identical on every run and every machine. */
function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function shuffled(sequence: string, random: () => number): string {
	const characters = sequence.split('');
	for (let i = characters.length - 1; i > 0; i -= 1) {
		const j = Math.floor(random() * (i + 1));
		[characters[i], characters[j]] = [characters[j], characters[i]];
	}
	return characters.join('');
}

/**
 * Supporting evidence only: says the sequences are scaffold-derived, not that they are correct.
 *
 * `wrapAround` doubles the haystack so a window may span the scaffold's own join. The reported run
 * leaves it off, because every route is linear by the time the sequence is applied and no route runs
 * past the end of the scaffold, so a wrapped window could only invent matches across a join no oligo
 * crosses. The spec runs both and requires identical counts rather than assuming that.
 */
export function physicalControl(probeDesign: string, wrapAround = false): PhysicalControl {
	const scaffold = readScaffold(provenance.designs[probeDesign].scaffoldFile).toUpperCase();
	const haystack = wrapAround ? scaffold + scaffold : scaffold;

	const kmers = new Map<number, Set<string>>();
	for (const k of MATCH_THRESHOLDS) {
		const set = new Set<string>();
		for (let i = 0; i + k <= haystack.length; i += 1) set.add(haystack.slice(i, i + k));
		kmers.set(k, set);
	}

	const hasMatch = (sequence: string, k: number): boolean => {
		const set = kmers.get(k)!;
		for (let i = 0; i + k <= sequence.length; i += 1) {
			if (set.has(reverseComplement(sequence.slice(i, i + k)))) return true;
		}
		return false;
	};

	const random = mulberry32(SHUFFLE_SEED);
	const real: Record<number, number> = {};
	const control: Record<number, number> = {};
	for (const k of MATCH_THRESHOLDS) {
		real[k] = 0;
		control[k] = 0;
	}

	let stretches = 0;
	for (const design of Object.keys(provenance.designs).sort(byCodeUnit)) {
		for (const row of readReferenceCSV(design)) {
			for (const stretch of row.sequence.toUpperCase().split('?')) {
				if (stretch.length < MATCH_THRESHOLDS[0]) continue;
				stretches += 1;
				const scrambled = shuffled(stretch, random);
				for (const k of MATCH_THRESHOLDS) {
					if (hasMatch(stretch, k)) real[k] += 1;
					if (hasMatch(scrambled, k)) control[k] += 1;
				}
			}
		}
	}

	return { stretches, seed: SHUFFLE_SEED, real, shuffled: control };
}

/* ------------------------------------------------------------------ *
 * Per-design run
 * ------------------------------------------------------------------ */

function verdictFor(
	comparison: ReturnType<typeof compareOligos>,
	referenceCount: number,
	generatedCount: number
): DesignResult['verdict'] {
	if (referenceCount !== generatedCount) return 'differences';
	if (comparison.unmatchedReferenceRoutes.length > 0) return 'differences';
	if (comparison.unmatchedGeneratedRoutes.length > 0) return 'differences';
	return comparison.exactMatches === referenceCount ? 'exact' : 'differences';
}

export function runDesign(design: string): DesignResult {
	const meta = provenance.designs[design];
	const base: DesignResult = {
		design,
		error: null,
		scaffoldFile: meta?.scaffoldFile ?? 'unknown',
		scaffoldRouteLength: meta?.scaffoldRouteLength ?? 0,
		scaffoldCircular: meta?.scaffoldCircular ?? false,
		linearizedAt: meta?.linearizedAt ?? null,
		referenceOligos: 0,
		generatedOligos: 0,
		exactMatches: 0,
		nonExactReference: 0,
		nonExactGenerated: 0,
		differences: [],
		unmatchedReferenceRoutes: [],
		unmatchedGeneratedRoutes: [],
		oligoNt: 0,
		unsequencedNt: 0,
		fillLeftover: 0,
		fillMissing: 0,
		circularExcluded: 0,
		scafSlotOligos: 0,
		exporterAgrees: null,
		exporterError: null,
		modificationsEmpty: true,
		colors: { matched: 0, generated: 0, unexplained: [] },
		verdict: 'differences',
	};

	try {
		if (!meta) throw new Error('no provenance entry — rerun scripts/gen_reference_sequences.py');

		// The fixture and the provenance describing it are written by the same run. Checking them
		// against each other catches a fixture regenerated without its provenance, or edited by hand.
		if (sha256Text(referenceCsvPath(design)) !== meta.csvSha256) {
			throw new Error('the reference CSV does not match the hash recorded in the provenance');
		}
		if (sha256Text(designJsonPath(design)) !== meta.sourceSha256) {
			throw new Error('the source design does not match the hash recorded in the provenance');
		}

		const reference = readReferenceCSV(design);
		const oligoNt = reference.reduce((sum, row) => sum + row.length, 0);
		const unsequencedNt = countUnsequenced(reference);
		if (reference.length !== meta.oligos) {
			throw new Error(
				`reference CSV holds ${reference.length} oligos but the provenance records ${meta.oligos}`
			);
		}
		if (oligoNt !== meta.oligoNt) {
			throw new Error(
				`reference CSV holds ${oligoNt} nt but the provenance records ${meta.oligoNt}`
			);
		}
		if (unsequencedNt !== meta.unsequencedNt) {
			throw new Error(
				`reference CSV holds ${unsequencedNt} unsequenced nt but the provenance records ${meta.unsequencedNt}`
			);
		}

		const {
			part,
			scaffold,
			rows: generated,
			circular,
			scafSlot,
			leftover,
			missing,
		} = generateOligos(design, meta);
		const comparison = compareOligos(reference, generated);
		const exporter = exporterReproduces(part, scaffold, generated);

		return {
			...base,
			...comparison,
			referenceOligos: reference.length,
			generatedOligos: generated.length,
			oligoNt,
			unsequencedNt,
			fillLeftover: leftover,
			fillMissing: missing,
			circularExcluded: circular,
			scafSlotOligos: scafSlot,
			exporterAgrees: exporter.agrees,
			exporterError: exporter.error,
			modificationsEmpty: exporter.modificationsEmpty,
			colors: compareColors(design, generated, reference),
			verdict: verdictFor(comparison, reference.length, generated.length),
		};
	} catch (error) {
		return { ...base, error: error instanceof Error ? error.message : String(error) };
	}
}
