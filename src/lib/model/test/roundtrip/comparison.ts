// Round-trips J0 → P1 → J1 → P2 → J2 → P3 (J = cadnano document, P = Part) and compares the stages.
// Original cadnano data preservation (J0 vs J1) is classified separately from recurring differences
// (J1 vs J2, P2 vs P3): later cycles can be stable even when the first export already lost data.

import * as fs from 'fs';
import * as path from 'path';

import { CadnanoJSON } from '$lib/model/io/cadnanoJSON';
import type { Part } from '$lib/model/Part';
import { LatticedDesignRegion } from '$lib/model/Part/DesignRegion';
import type Oligo from '$lib/model/Oligo/Oligo.svelte';
import type OligoSegment from '$lib/model/Oligo/OligoSegment.svelte';

import { byCodeUnit } from '../support/report-output';
import {
	asColorArray,
	asNumberArray,
	asTupleArray,
	asVstrands,
	asVStrandJson,
	COMPARISON_COLOR_FIELDS,
	COMPARISON_NUMBER_FIELDS,
	COMPARISON_SCALAR_FIELDS,
	COMPARISON_TUPLE_FIELDS,
	documentFieldProblems,
	duplicateNumbers,
	type JsonObject,
	jsonValue,
	KNOWN_VSTRAND_FIELDS,
	parseObject,
	structurallyEqual,
	vstrandNumber,
} from './validation';

export const DESIGNS_DIR = path.resolve('test_files/published_cadnano_designs');
export const MAX_EXAMPLES = 6;

export interface ChangeExample {
	path: string;
	before: unknown;
	after: unknown;
}

export interface FieldOccurrence {
	field: string;
	count: number;
	vstrands: number[];
}

export interface KeyOrderOccurrence {
	count: number;
	vstrands: number[];
	before: string[];
	after: string[];
}

export interface ArrayLengthChange {
	field: string;
	count: number;
	vstrands: number[];
	examples: ChangeExample[];
}

export interface ValueChangeGroup {
	field: string;
	signature: string;
	count: number;
	vstrands: number[];
	countsByVstrand: Array<{ vstrand: number; count: number }>;
	examples: ChangeExample[];
}

export interface ColorMappingChange {
	field: string;
	vstrand: number;
	added: Array<[number, number]>;
	removed: Array<[number, number]>;
}

export interface JsonComparison {
	label: string;
	structurallyEqual: boolean;
	topLevelKeyOrderChanged: boolean;
	vstrandOrder: {
		changed: boolean;
		before: number[];
		after: number[];
		movedCount: number;
		sameNumbers: boolean;
		afterIsAscending: boolean;
	};
	duplicateVstrandNumbers: { before: number[]; after: number[] };
	keyOrderChanges: KeyOrderOccurrence[];
	addedFields: FieldOccurrence[];
	removedFields: FieldOccurrence[];
	renamedFields: FieldOccurrence[];
	arrayLengthChanges: ArrayLengthChange[];
	tupleChanges: ValueChangeGroup[];
	numericArrayChanges: ValueChangeGroup[];
	scalarChanges: ValueChangeGroup[];
	colorOrderOnly: FieldOccurrence[];
	colorMappingChanges: ColorMappingChange[];
	totalTupleEntriesChanged: number;
	totalNumericEntriesChanged: number;
	totalColorMappingsChanged: number;
	totalSchemaOccurrencesChanged: number;
	totalPresentationChanges: number;
}

interface VirtualHelixSnapshot {
	index: number;
	row: number | null;
	col: number | null;
	length: number;
}

interface SegmentSnapshot {
	key: string;
	vh: number;
	strand: number;
	fivePrime: number;
	threePrime: number;
	skipsAndInserts: Array<[number, number]>;
}

interface OligoSnapshot {
	topology: string;
	circular: boolean;
	length: number;
	color: string;
}

export interface PartSnapshot {
	name: string;
	regionKinds: string[];
	vstrandOrder: number[];
	virtualHelices: VirtualHelixSnapshot[];
	segments: SegmentSnapshot[];
	crossovers: string[];
	oligos: OligoSnapshot[];
}

export interface PartComparison {
	label: string;
	vstrandOrderChanged: boolean;
	movedVstrandCount: number;
	metadataChanges: number;
	virtualHelixChanges: number;
	segmentsAdded: number;
	segmentsRemoved: number;
	segmentsModified: number;
	crossoversAdded: number;
	crossoversRemoved: number;
	oligosAdded: number;
	oligosRemoved: number;
	oligosModified: number;
	colorChanges: number;
	foldnanoPartChanges: number;
	designAndColorChanges: number;
	examples: string[];
}

export type DifferenceCategory =
	'representation-only' | 'generated-metadata' | 'warned-lossy' | 'unexpected';

/** One J0/J1 difference after presentation-only ordering and spelling differences are ignored. */
export interface OriginalCadnanoDifference {
	vstrand: number;
	field: string;
	index: number | null;
	before: unknown;
	after: unknown;
	category: DifferenceCategory;
	reason: string;
}

export interface DeletionRelocation {
	vstrand: number;
	fromBase: number;
	toBase: number;
}

export interface CadnanoScopeAgreement {
	virtualHelixGeometry: boolean;
	strandAndCrossoverTopology: boolean;
	loops: boolean;
	skipsExactly: boolean;
	sourceColors: boolean;
	exactInScopeAgreement: boolean;
}

export interface OriginalCadnanoPreservationReport {
	allComparedDataEqual: boolean;
	agreement: CadnanoScopeAgreement;
	representationOnlyChanges: OriginalCadnanoDifference[];
	generatedMetadataChanges: OriginalCadnanoDifference[];
	warnedLossyDifferences: OriginalCadnanoDifference[];
	unexpectedDifferences: OriginalCadnanoDifference[];
	deletionRelocations: DeletionRelocation[];
	selfReferentialExits: number;
	scaffoldColorsInvented: number;
}

export interface DesignResult {
	design: string;
	sourceSha256: string;
	error: { stage: string; message: string } | null;
	warnings: { J0: string[]; J1: string[]; J2: string[] };
	documentProblems: string[];
	originalCadnanoPreservation: OriginalCadnanoPreservationReport | null;
	J0J1: JsonComparison | null;
	J1J2: JsonComparison | null;
	P1P2: PartComparison | null;
	P2P3: PartComparison | null;
	verdict: string;
}

/* ------------------------------------------------------------------ *
 * Grouping helpers
 * ------------------------------------------------------------------ */

function addMapSet(map: Map<string, Set<number>>, key: string, vh: number): void {
	const values = map.get(key) ?? new Set<number>();
	values.add(vh);
	map.set(key, values);
}

function finalizeOccurrences(map: Map<string, Set<number>>): FieldOccurrence[] {
	return [...map.entries()]
		.map(([field, vstrands]) => ({
			field,
			count: vstrands.size,
			vstrands: [...vstrands].sort((a, b) => a - b),
		}))
		.sort((a, b) => byCodeUnit(a.field, b.field));
}

interface MutableValueGroup {
	field: string;
	signature: string;
	count: number;
	vstrands: Set<number>;
	countsByVstrand: Map<number, number>;
	examples: ChangeExample[];
}

function addValueGroup(
	map: Map<string, MutableValueGroup>,
	field: string,
	signature: string,
	vh: number,
	example: ChangeExample
): void {
	const key = `${field}\u0000${signature}`;
	const group = map.get(key) ?? {
		field,
		signature,
		count: 0,
		vstrands: new Set<number>(),
		countsByVstrand: new Map<number, number>(),
		examples: [],
	};
	group.count++;
	group.vstrands.add(vh);
	group.countsByVstrand.set(vh, (group.countsByVstrand.get(vh) ?? 0) + 1);
	if (group.examples.length < MAX_EXAMPLES) group.examples.push(example);
	map.set(key, group);
}

function finalizeValueGroups(map: Map<string, MutableValueGroup>): ValueChangeGroup[] {
	return [...map.values()]
		.map((group) => ({
			field: group.field,
			signature: group.signature,
			count: group.count,
			vstrands: [...group.vstrands].sort((a, b) => a - b),
			countsByVstrand: [...group.countsByVstrand.entries()]
				.map(([vstrand, count]) => ({ vstrand, count }))
				.sort((a, b) => a.vstrand - b.vstrand),
			examples: group.examples,
		}))
		.sort((a, b) => b.count - a.count || byCodeUnit(a.field, b.field));
}

export function multisetDifference<T>(left: T[], right: T[], key: (value: T) => string): T[] {
	const counts = new Map<string, number>();
	for (const value of right) counts.set(key(value), (counts.get(key(value)) ?? 0) + 1);
	const difference: T[] = [];
	for (const value of left) {
		const itemKey = key(value);
		const count = counts.get(itemKey) ?? 0;
		if (count === 0) difference.push(value);
		else counts.set(itemKey, count - 1);
	}
	return difference;
}

/* ------------------------------------------------------------------ *
 * Original cadnano data preservation, ignoring formatting (J0 vs J1)
 * ------------------------------------------------------------------ */

const colorPairKey = (pair: [number, number]) => `${pair[0]}:${pair[1]}`;

function sortedColors(value: unknown): Array<[number, number]> {
	const colors = asColorArray(value ?? []) ?? [];
	return [...colors].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/** Drops only what provably cannot change which molecule is described: key order, spelling, colour order. */
function vstrandDataIgnoringFormatting(vstrand: JsonObject): JsonObject {
	const comparable: JsonObject = {};
	for (const field of COMPARISON_SCALAR_FIELDS) comparable[field] = vstrand[field] ?? null;
	for (const field of COMPARISON_TUPLE_FIELDS) comparable[field] = vstrand[field] ?? [];
	for (const field of COMPARISON_NUMBER_FIELDS) {
		if (field === 'scaf_loop') comparable[field] = vstrand.scaf_loop ?? vstrand.scafLoop ?? [];
		else if (field === 'stap_loop') comparable[field] = vstrand.stap_loop ?? vstrand.stapLoop ?? [];
		else comparable[field] = vstrand[field] ?? [];
	}
	for (const field of COMPARISON_COLOR_FIELDS) comparable[field] = sortedColors(vstrand[field]);
	return comparable;
}

export function vstrandDataIgnoringFormattingForComparison(json: JsonObject): JsonObject[] {
	return asVstrands(json)
		.map(vstrandDataIgnoringFormatting)
		.sort((a, b) => (a.num as number) - (b.num as number));
}

/** `VH 10: deletion at crossover bp 68 moved to bp 67 (...)` — from VStrand.relocateSkipsOffCrossovers(). */
const RELOCATION_WARNING = /^VH (\d+): deletion at crossover bp (\d+) moved to bp (\d+)/;

function parseRelocationWarnings(warnings: string[]): Map<number, Array<[number, number]>> {
	const byVh = new Map<number, Array<[number, number]>>();
	for (const warning of warnings) {
		const match = RELOCATION_WARNING.exec(warning);
		if (!match) continue;
		const vh = Number(match[1]);
		const moves = byVh.get(vh) ?? [];
		moves.push([Number(match[2]), Number(match[3])]);
		byVh.set(vh, moves);
	}
	return byVh;
}

function validateDeletionRelocations(
	beforeByNum: Map<number, JsonObject>,
	afterByNum: Map<number, JsonObject>,
	candidates: Map<number, Array<[number, number]>>
): DeletionRelocation[] {
	const relocations: DeletionRelocation[] = [];
	for (const [vstrand, moves] of candidates) {
		const beforeSkip = asNumberArray(beforeByNum.get(vstrand)?.skip) ?? [];
		const afterSkip = asNumberArray(afterByNum.get(vstrand)?.skip) ?? [];
		for (const [fromBase, toBase] of moves) {
			if (
				beforeSkip[fromBase] === -1 &&
				afterSkip[fromBase] === 0 &&
				beforeSkip[toBase] === 0 &&
				afterSkip[toBase] === -1
			) {
				relocations.push({ vstrand, fromBase, toBase });
			}
		}
	}
	return relocations;
}

// Self-referential predecessor `[vh, i, …]` at index i, rewritten to the neighbour (isXoverExitEnd()
// in VStrand.buildSegments()). Shape alone would not prove the encodings agree, so the neighbour must
// already point forward at us.
function isSelfReferentialExitRewrite(
	sourceTuples: number[][],
	vh: number,
	index: number,
	before: number[],
	after: number[]
): boolean {
	if (before[2] !== after[2] || before[3] !== after[3]) return false; // successor must be untouched
	if (before[0] !== vh || before[1] !== index) return false; // source pointed at itself
	if (after[0] !== vh || Math.abs(after[1] - index) !== 1) return false; // now points at a neighbour
	const neighbour = sourceTuples[after[1]];
	if (!neighbour) return false;
	return neighbour[2] === vh && neighbour[3] === index;
}

function isRelocatedSkip(
	moves: DeletionRelocation[],
	index: number,
	before: unknown,
	after: unknown
): boolean {
	for (const move of moves) {
		if (index === move.fromBase && before === -1 && after === 0) return true;
		if (index === move.toBase && before === 0 && after === -1) return true;
	}
	return false;
}

/** Classifies every in-scope J0/J1 difference instead of silently normalizing it away. */
export function checkOriginalCadnanoDataPreservation(
	source: JsonObject,
	exported: JsonObject,
	warnings: string[],
	expectedScaffoldColors: Map<number, Array<[number, number]>> = new Map()
): OriginalCadnanoPreservationReport {
	const sourceVstrands = asVstrands(source);
	const exportedVstrands = asVstrands(exported);
	const before = vstrandDataIgnoringFormattingForComparison(source);
	const after = vstrandDataIgnoringFormattingForComparison(exported);
	const beforeByNum = new Map(before.map((vstrand) => [vstrand.num as number, vstrand]));
	const afterByNum = new Map(after.map((vstrand) => [vstrand.num as number, vstrand]));
	const deletionRelocations = validateDeletionRelocations(
		beforeByNum,
		afterByNum,
		parseRelocationWarnings(warnings)
	);
	const numbers = [...new Set([...beforeByNum.keys(), ...afterByNum.keys()])].sort((a, b) => a - b);
	const differences: OriginalCadnanoDifference[] = [];

	const record = (
		vstrand: number,
		field: string,
		index: number | null,
		left: unknown,
		right: unknown,
		category: DifferenceCategory,
		reason: string
	) => differences.push({ vstrand, field, index, before: left, after: right, category, reason });

	const sourceNumbers = sourceVstrands.map(vstrandNumber);
	const exportedNumbers = exportedVstrands.map(vstrandNumber);
	const duplicateNums = [
		...new Set([...duplicateNumbers(sourceNumbers), ...duplicateNumbers(exportedNumbers)]),
	].sort((a, b) => a - b);
	for (const num of duplicateNums) {
		record(
			num,
			'vstrand.num.duplicate',
			null,
			sourceNumbers.filter((value) => Object.is(value, num)).length,
			exportedNumbers.filter((value) => Object.is(value, num)).length,
			'unexpected',
			'duplicate vstrand number makes topology matching ambiguous'
		);
	}

	// Fail closed. The loop below only reads the fields it knows about, so a data-bearing field the
	// exporter dropped would otherwise be absent from both sides and never surface as a difference.
	for (const vstrand of sourceVstrands) {
		for (const field of Object.keys(vstrand)) {
			if (KNOWN_VSTRAND_FIELDS.has(field)) continue;
			record(
				vstrandNumber(vstrand),
				field,
				null,
				vstrand[field],
				null,
				'unexpected',
				'source field is outside the compared set, so its preservation is unverified'
			);
		}
	}

	for (const num of numbers) {
		const left = beforeByNum.get(num);
		const right = afterByNum.get(num);
		if (!left || !right) {
			record(num, 'vstrand', null, left ?? null, right ?? null, 'unexpected', 'vstrand missing');
			continue;
		}

		for (const field of COMPARISON_SCALAR_FIELDS) {
			if (left[field] !== right[field])
				record(num, field, null, left[field], right[field], 'unexpected', 'value changed');
		}

		for (const field of COMPARISON_TUPLE_FIELDS) {
			const leftTuples = asTupleArray(left[field]) ?? [];
			const rightTuples = asTupleArray(right[field]) ?? [];
			if (leftTuples.length !== rightTuples.length) {
				record(
					num,
					`${field}.length`,
					null,
					leftTuples.length,
					rightTuples.length,
					'unexpected',
					'array length changed'
				);
			}
			for (let i = 0; i < Math.max(leftTuples.length, rightTuples.length); i++) {
				const leftTuple = leftTuples[i];
				const rightTuple = rightTuples[i];
				if (jsonValue(leftTuple) === jsonValue(rightTuple)) continue;
				const representationOnly =
					leftTuple &&
					rightTuple &&
					isSelfReferentialExitRewrite(leftTuples, num, i, leftTuple, rightTuple);
				record(
					num,
					field,
					i,
					leftTuple ?? null,
					rightTuple ?? null,
					representationOnly ? 'representation-only' : 'unexpected',
					representationOnly
						? 'self-referential crossover exit rewritten in regular form (VStrand.buildSegments())'
						: 'connection tuple changed'
				);
			}
		}

		const moves = deletionRelocations.filter((move) => move.vstrand === num);
		for (const field of COMPARISON_NUMBER_FIELDS) {
			const leftNumbers = asNumberArray(left[field]) ?? [];
			const rightNumbers = asNumberArray(right[field]) ?? [];
			if (leftNumbers.length !== rightNumbers.length) {
				record(
					num,
					`${field}.length`,
					null,
					leftNumbers.length,
					rightNumbers.length,
					'unexpected',
					'array length changed'
				);
			}
			for (let i = 0; i < Math.max(leftNumbers.length, rightNumbers.length); i++) {
				if (leftNumbers[i] === rightNumbers[i]) continue;
				const warnedLossy =
					field === 'skip' && isRelocatedSkip(moves, i, leftNumbers[i], rightNumbers[i]);
				record(
					num,
					field,
					i,
					leftNumbers[i] ?? null,
					rightNumbers[i] ?? null,
					warnedLossy ? 'warned-lossy' : 'unexpected',
					warnedLossy
						? 'deletion relocated off a crossover column, with a user warning (VStrand.relocateSkipsOffCrossovers())'
						: `${field} value changed`
				);
			}
		}

		for (const field of COMPARISON_COLOR_FIELDS) {
			const leftColors = sortedColors(left[field]);
			const rightColors = sortedColors(right[field]);
			const removed = multisetDifference(leftColors, rightColors, colorPairKey);
			const added = multisetDifference(rightColors, leftColors, colorPairKey);
			const expectedAdditions =
				field === 'scaf_colors'
					? multisetDifference(
							sortedColors(expectedScaffoldColors.get(num) ?? []),
							leftColors,
							colorPairKey
						)
					: [];
			for (const pair of removed)
				record(num, field, pair[0], pair, null, 'unexpected', 'source colour removed');
			for (const pair of added) {
				const expectedIndex = expectedAdditions.findIndex(
					(expected) => colorPairKey(expected) === colorPairKey(pair)
				);
				const generatedMetadata =
					field === 'scaf_colors' && removed.length === 0 && expectedIndex !== -1;
				if (expectedIndex !== -1) expectedAdditions.splice(expectedIndex, 1);
				record(
					num,
					field,
					pair[0],
					null,
					pair,
					generatedMetadata ? 'generated-metadata' : 'unexpected',
					generatedMetadata
						? 'missing scaffold colour generated during import and written during export (Oligo.constructor)'
						: 'new source-level colour entry'
				);
			}
		}
	}

	const byCategory = (category: DifferenceCategory) =>
		differences.filter((difference) => difference.category === category);
	const representationOnlyChanges = byCategory('representation-only');
	const generatedMetadataChanges = byCategory('generated-metadata');
	const warnedLossyDifferences = byCategory('warned-lossy');
	const unexpectedDifferences = byCategory('unexpected');
	const hasUnexpectedField = (predicate: (field: string) => boolean) =>
		unexpectedDifferences.some((difference) => predicate(difference.field));
	const virtualHelixGeometry = !hasUnexpectedField((field) =>
		[
			'vstrand',
			'vstrand.num.duplicate',
			'row',
			'col',
			'num',
			'scaf.length',
			'stap.length',
		].includes(field)
	);
	const strandAndCrossoverTopology = !hasUnexpectedField((field) =>
		['vstrand', 'vstrand.num.duplicate', 'scaf', 'stap', 'scaf.length', 'stap.length'].includes(
			field
		)
	);
	const loops = !hasUnexpectedField((field) =>
		[
			'loop',
			'loop.length',
			'scaf_loop',
			'scaf_loop.length',
			'stap_loop',
			'stap_loop.length',
		].includes(field)
	);
	const skipsExactly = !differences.some(
		(difference) => difference.field === 'skip' || difference.field === 'skip.length'
	);
	const sourceColors = !hasUnexpectedField((field) =>
		COMPARISON_COLOR_FIELDS.includes(field as (typeof COMPARISON_COLOR_FIELDS)[number])
	);
	const agreement: CadnanoScopeAgreement = {
		virtualHelixGeometry,
		strandAndCrossoverTopology,
		loops,
		skipsExactly,
		sourceColors,
		exactInScopeAgreement:
			virtualHelixGeometry &&
			strandAndCrossoverTopology &&
			loops &&
			skipsExactly &&
			sourceColors &&
			unexpectedDifferences.length === 0,
	};
	return {
		allComparedDataEqual: differences.length === 0,
		agreement,
		representationOnlyChanges,
		generatedMetadataChanges,
		warnedLossyDifferences,
		unexpectedDifferences,
		deletionRelocations,
		selfReferentialExits: representationOnlyChanges.length,
		scaffoldColorsInvented: generatedMetadataChanges.filter(
			(difference) => difference.field === 'scaf_colors'
		).length,
	};
}

export function describeOriginalCadnanoDifference(difference: OriginalCadnanoDifference): string {
	const at = difference.index === null ? '' : `[${difference.index}]`;
	return `vstrand(${difference.vstrand}).${difference.field}${at}: ${jsonValue(difference.before)} → ${jsonValue(difference.after)}`;
}

/* ------------------------------------------------------------------ *
 * Descriptive diff (kept for the report table)
 * ------------------------------------------------------------------ */

function relation(value: number, component: number, vh: number, bp: number): string {
	if (value === -1) return '-1';
	const reference = component === 0 || component === 2 ? vh : bp;
	const name = component === 0 || component === 2 ? 'vh' : 'i';
	const delta = value - reference;
	if (delta === 0) return name;
	if (delta > 0 && delta <= 4) return `${name}+${delta}`;
	if (delta < 0 && delta >= -4) return `${name}${delta}`;
	return String(value);
}

const TUPLE_COMPONENTS = ['fromVh', 'fromBp', 'toVh', 'toBp'] as const;

function compareTupleField(
	before: JsonObject,
	after: JsonObject,
	vh: number,
	field: 'scaf' | 'stap',
	groups: Map<string, MutableValueGroup>,
	lengthChanges: ArrayLengthChange[]
): void {
	const left = asTupleArray(before[field]);
	const right = asTupleArray(after[field]);
	if (!left || !right) return;
	if (left.length !== right.length) {
		lengthChanges.push({
			field,
			count: Math.abs(left.length - right.length),
			vstrands: [vh],
			examples: [
				{ path: `vstrand(${vh}).${field}.length`, before: left.length, after: right.length },
			],
		});
	}
	for (let i = 0; i < Math.max(left.length, right.length); i++) {
		const leftTuple = left[i];
		const rightTuple = right[i];
		if (jsonValue(leftTuple) === jsonValue(rightTuple)) continue;
		let signature: string;
		if (!leftTuple || !rightTuple) {
			signature = leftTuple ? 'entry removed' : 'entry added';
		} else {
			const changes: string[] = [];
			for (let component = 0; component < 4; component++) {
				if (leftTuple[component] === rightTuple[component]) continue;
				changes.push(
					`${TUPLE_COMPONENTS[component]}:${relation(leftTuple[component], component, vh, i)}→${relation(rightTuple[component], component, vh, i)}`
				);
			}
			signature = changes.join(', ');
		}
		addValueGroup(groups, field, signature, vh, {
			path: `vstrand(${vh}).${field}[${i}]`,
			before: leftTuple,
			after: rightTuple,
		});
	}
}

function logicalArray(vstrand: JsonObject, field: string): unknown {
	if (field === 'scafLoop') return vstrand.scaf_loop ?? vstrand.scafLoop;
	if (field === 'stapLoop') return vstrand.stap_loop ?? vstrand.stapLoop;
	return vstrand[field];
}

function compareNumericField(
	before: JsonObject,
	after: JsonObject,
	vh: number,
	field: 'loop' | 'skip' | 'scafLoop' | 'stapLoop',
	groups: Map<string, MutableValueGroup>,
	lengthChanges: ArrayLengthChange[]
): void {
	const left = asNumberArray(logicalArray(before, field));
	const right = asNumberArray(logicalArray(after, field));
	if (!left || !right) return;
	if (left.length !== right.length) {
		lengthChanges.push({
			field,
			count: Math.abs(left.length - right.length),
			vstrands: [vh],
			examples: [
				{ path: `vstrand(${vh}).${field}.length`, before: left.length, after: right.length },
			],
		});
	}
	for (let i = 0; i < Math.max(left.length, right.length); i++) {
		if (left[i] === right[i]) continue;
		const signature = `${String(left[i] ?? '<missing>')}→${String(right[i] ?? '<missing>')}`;
		addValueGroup(groups, field, signature, vh, {
			path: `vstrand(${vh}).${field}[${i}]`,
			before: left[i],
			after: right[i],
		});
	}
}

export function compareCadnanoJson(
	before: JsonObject,
	after: JsonObject,
	label: string
): JsonComparison {
	const beforeVstrands = asVstrands(before);
	const afterVstrands = asVstrands(after);
	const beforeOrder = beforeVstrands.map(vstrandNumber);
	const afterOrder = afterVstrands.map(vstrandNumber);
	const beforeByNum = new Map(beforeVstrands.map((vstrand) => [vstrandNumber(vstrand), vstrand]));
	const afterByNum = new Map(afterVstrands.map((vstrand) => [vstrandNumber(vstrand), vstrand]));
	const allNumbers = [...new Set([...beforeOrder, ...afterOrder])].sort((a, b) => a - b);

	const addedFields = new Map<string, Set<number>>();
	const removedFields = new Map<string, Set<number>>();
	const renamedFields = new Map<string, Set<number>>();
	const colorOrderOnly = new Map<string, Set<number>>();
	const keyOrderGroups = new Map<string, { before: string[]; after: string[]; vhs: Set<number> }>();
	const tupleGroups = new Map<string, MutableValueGroup>();
	const numericGroups = new Map<string, MutableValueGroup>();
	const scalarGroups = new Map<string, MutableValueGroup>();
	const lengthChanges: ArrayLengthChange[] = [];
	const colorMappingChanges: ColorMappingChange[] = [];

	const knownFields = new Set([
		'row',
		'col',
		'num',
		'scaf',
		'stap',
		'loop',
		'skip',
		'scafLoop',
		'stapLoop',
		'scaf_loop',
		'stap_loop',
		'stap_colors',
		'scaf_colors',
	]);

	for (const vh of allNumbers) {
		const left = beforeByNum.get(vh);
		const right = afterByNum.get(vh);
		if (!left || !right) {
			addValueGroup(scalarGroups, 'vstrand', left ? 'removed' : 'added', vh, {
				path: `vstrand(${vh})`,
				before: left,
				after: right,
			});
			continue;
		}

		const leftKeys = Object.keys(left);
		const rightKeys = Object.keys(right);
		if (leftKeys.join('\u0000') !== rightKeys.join('\u0000')) {
			const transitionKey = `${leftKeys.join('/')}\u0000${rightKeys.join('/')}`;
			const transition = keyOrderGroups.get(transitionKey) ?? {
				before: leftKeys,
				after: rightKeys,
				vhs: new Set<number>(),
			};
			transition.vhs.add(vh);
			keyOrderGroups.set(transitionKey, transition);
		}

		const handledRenames = new Set<string>();
		for (const [camel, snake] of [
			['scafLoop', 'scaf_loop'],
			['stapLoop', 'stap_loop'],
		] as const) {
			if (
				camel in left &&
				!(camel in right) &&
				snake in right &&
				structurallyEqual(left[camel], right[snake])
			) {
				addMapSet(renamedFields, `${camel}→${snake}`, vh);
				handledRenames.add(camel);
				handledRenames.add(snake);
			}
			if (
				snake in left &&
				!(snake in right) &&
				camel in right &&
				structurallyEqual(left[snake], right[camel])
			) {
				addMapSet(renamedFields, `${snake}→${camel}`, vh);
				handledRenames.add(camel);
				handledRenames.add(snake);
			}
		}

		for (const key of leftKeys) {
			if (!(key in right) && !handledRenames.has(key)) addMapSet(removedFields, key, vh);
		}
		for (const key of rightKeys) {
			if (!(key in left) && !handledRenames.has(key)) addMapSet(addedFields, key, vh);
		}

		for (const field of ['row', 'col'] as const) {
			if (left[field] === right[field]) continue;
			addValueGroup(scalarGroups, field, `${String(left[field])}→${String(right[field])}`, vh, {
				path: `vstrand(${vh}).${field}`,
				before: left[field],
				after: right[field],
			});
		}

		compareTupleField(left, right, vh, 'scaf', tupleGroups, lengthChanges);
		compareTupleField(left, right, vh, 'stap', tupleGroups, lengthChanges);
		for (const field of ['loop', 'skip', 'scafLoop', 'stapLoop'] as const) {
			compareNumericField(left, right, vh, field, numericGroups, lengthChanges);
		}

		for (const field of COMPARISON_COLOR_FIELDS) {
			const leftColors = asColorArray(left[field] ?? []);
			const rightColors = asColorArray(right[field] ?? []);
			if (!leftColors || !rightColors || jsonValue(leftColors) === jsonValue(rightColors)) continue;
			const removed = multisetDifference(leftColors, rightColors, colorPairKey);
			const added = multisetDifference(rightColors, leftColors, colorPairKey);
			if (removed.length === 0 && added.length === 0) {
				addMapSet(colorOrderOnly, field, vh);
			} else {
				colorMappingChanges.push({ field, vstrand: vh, added, removed });
			}
		}

		for (const field of leftKeys.filter(
			(key) => rightKeys.includes(key) && !knownFields.has(key)
		)) {
			if (structurallyEqual(left[field], right[field])) continue;
			addValueGroup(scalarGroups, field, 'value changed', vh, {
				path: `vstrand(${vh}).${field}`,
				before: left[field],
				after: right[field],
			});
		}
	}

	const beforePositions = new Map(beforeOrder.map((num, index) => [num, index]));
	const movedCount = afterOrder.filter((num, index) => beforePositions.get(num) !== index).length;
	const tupleChanges = finalizeValueGroups(tupleGroups);
	const numericArrayChanges = finalizeValueGroups(numericGroups);
	const scalarChanges = finalizeValueGroups(scalarGroups);
	const finalizedAdded = finalizeOccurrences(addedFields);
	const finalizedRemoved = finalizeOccurrences(removedFields);
	const finalizedRenamed = finalizeOccurrences(renamedFields);
	const finalizedColorOrder = finalizeOccurrences(colorOrderOnly);

	return {
		label,
		structurallyEqual: structurallyEqual(before, after),
		topLevelKeyOrderChanged:
			Object.keys(before).join('\u0000') !== Object.keys(after).join('\u0000'),
		vstrandOrder: {
			changed: beforeOrder.join(',') !== afterOrder.join(','),
			before: beforeOrder,
			after: afterOrder,
			movedCount,
			sameNumbers:
				[...beforeOrder].sort((a, b) => a - b).join(',') ===
				[...afterOrder].sort((a, b) => a - b).join(','),
			afterIsAscending: afterOrder.every(
				(value, index) => index === 0 || afterOrder[index - 1] <= value
			),
		},
		duplicateVstrandNumbers: {
			before: duplicateNumbers(beforeOrder),
			after: duplicateNumbers(afterOrder),
		},
		keyOrderChanges: [...keyOrderGroups.values()].map((group) => ({
			count: group.vhs.size,
			vstrands: [...group.vhs].sort((a, b) => a - b),
			before: group.before,
			after: group.after,
		})),
		addedFields: finalizedAdded,
		removedFields: finalizedRemoved,
		renamedFields: finalizedRenamed,
		arrayLengthChanges: lengthChanges,
		tupleChanges,
		numericArrayChanges,
		scalarChanges,
		colorOrderOnly: finalizedColorOrder,
		colorMappingChanges,
		totalTupleEntriesChanged: tupleChanges.reduce((total, group) => total + group.count, 0),
		totalNumericEntriesChanged: numericArrayChanges.reduce(
			(total, group) => total + group.count,
			0
		),
		totalColorMappingsChanged: colorMappingChanges.reduce(
			(total, change) => total + change.added.length + change.removed.length,
			0
		),
		totalSchemaOccurrencesChanged:
			finalizedAdded.reduce((total, item) => total + item.count, 0) +
			finalizedRemoved.reduce((total, item) => total + item.count, 0) +
			finalizedRenamed.reduce((total, item) => total + item.count, 0),
		totalPresentationChanges:
			Number(beforeOrder.join(',') !== afterOrder.join(',')) +
			keyOrderGroups.size +
			finalizedColorOrder.reduce((total, item) => total + item.count, 0),
	};
}

/* ------------------------------------------------------------------ *
 * Part snapshots
 * ------------------------------------------------------------------ */

function segmentKey(segment: OligoSegment): string {
	return `${segment.inVirtualHelix.index}:${segment.inStrandIndex}:${segment.fivePrime.index}>${segment.threePrime.index}`;
}

function segmentToken(segment: OligoSegment): string {
	const changes = [...segment.skipsAndInserts]
		.sort((a, b) => a[0] - b[0] || a[1] - b[1])
		.map(([bp, value]) => `${bp}:${value}`)
		.join(',');
	return `${segmentKey(segment)}{${changes}}`;
}

function rotations(values: string[]): string[][] {
	return values.map((_, index) => [...values.slice(index), ...values.slice(0, index)]);
}

/** Circular oligos are keyed by their smallest rotation so a different start segment is not a difference. */
function oligoTopology(oligo: Oligo): string {
	const segments = [...oligo.segments];
	if (segments.length === 0) return '<empty>';
	const fallback = [...segments].sort((a, b) => byCodeUnit(segmentToken(a), segmentToken(b)));
	let current: OligoSegment | null = oligo.isCircular
		? fallback[0]
		: (oligo.fivePrimeEndSegment ?? fallback[0]);
	const ordered: string[] = [];
	const seen = new Set<string>();
	while (current && oligo.segments.has(current) && !seen.has(current.id)) {
		ordered.push(segmentToken(current));
		seen.add(current.id);
		current = current.threePrime.connectedSegment;
	}
	for (const segment of fallback) {
		if (!seen.has(segment.id)) ordered.push(`unlinked:${segmentToken(segment)}`);
	}
	if (!oligo.isCircular) return `linear:${ordered.join('|')}`;
	return `circular:${
		rotations(ordered)
			.map((rotation) => rotation.join('|'))
			.sort()[0]
	}`;
}

export function snapshotPart(part: Part): PartSnapshot {
	const virtualHelices = [...part.virtualHelices]
		.map((vh) => ({
			index: vh.index,
			row: vh.latticeCoords?.row ?? null,
			col: vh.latticeCoords?.col ?? null,
			length: vh.length,
		}))
		.sort((a, b) => a.index - b.index);
	const segments = [...part.segmentsLookup.values()]
		.map((segment) => ({
			key: segmentKey(segment),
			vh: segment.inVirtualHelix.index,
			strand: segment.inStrandIndex,
			fivePrime: segment.fivePrime.index,
			threePrime: segment.threePrime.index,
			skipsAndInserts: [...segment.skipsAndInserts].sort((a, b) => a[0] - b[0] || a[1] - b[1]),
		}))
		.sort((a, b) => byCodeUnit(a.key, b.key));
	const crossovers = [...part.segmentsLookup.values()]
		.flatMap((segment) => {
			const connected = segment.threePrime.connectedSegment;
			if (!connected) return [];
			return [
				`${segment.inVirtualHelix.index}:${segment.inStrandIndex}:${segment.threePrime.index}` +
					`>${connected.inVirtualHelix.index}:${connected.inStrandIndex}:${connected.fivePrime.index}`,
			];
		})
		.sort();
	const oligos = [...part.oligos]
		.map((oligo) => ({
			topology: oligoTopology(oligo),
			circular: oligo.isCircular,
			length: oligo.length,
			color: oligo.color,
		}))
		.sort((a, b) => byCodeUnit(a.topology, b.topology));
	return {
		name: part.name,
		regionKinds: part.regions.map((region) => region.kind).sort(),
		vstrandOrder: [...part.virtualHelices]
			.sort((a, b) => a.listRow - b.listRow)
			.map((vh) => vh.index),
		virtualHelices,
		segments,
		crossovers,
		oligos,
	};
}

export function compareParts(
	before: PartSnapshot,
	after: PartSnapshot,
	label: string
): PartComparison {
	const examples: string[] = [];
	const beforeVhPosition = new Map(before.vstrandOrder.map((vh, index) => [vh, index]));
	const movedVstrandCount = after.vstrandOrder.filter(
		(vh, index) => beforeVhPosition.get(vh) !== index
	).length;
	const vstrandOrderChanged = before.vstrandOrder.join(',') !== after.vstrandOrder.join(',');
	if (vstrandOrderChanged) examples.push(`vstrand order moved ${movedVstrandCount} helices`);

	let metadataChanges = 0;
	if (before.name !== after.name) {
		metadataChanges++;
		examples.push(`name: ${before.name} → ${after.name}`);
	}
	if (before.regionKinds.join(',') !== after.regionKinds.join(',')) {
		metadataChanges++;
		examples.push(`regions: ${before.regionKinds.join(',')} → ${after.regionKinds.join(',')}`);
	}

	const beforeVhs = new Map(before.virtualHelices.map((vh) => [vh.index, vh]));
	const afterVhs = new Map(after.virtualHelices.map((vh) => [vh.index, vh]));
	let virtualHelixChanges = 0;
	for (const index of [...new Set([...beforeVhs.keys(), ...afterVhs.keys()])].sort(
		(a, b) => a - b
	)) {
		const left = beforeVhs.get(index);
		const right = afterVhs.get(index);
		if (structurallyEqual(left, right)) continue;
		virtualHelixChanges++;
		if (examples.length < MAX_EXAMPLES)
			examples.push(`VH ${index}: ${jsonValue(left)} → ${jsonValue(right)}`);
	}

	const beforeSegments = new Map(before.segments.map((segment) => [segment.key, segment]));
	const afterSegments = new Map(after.segments.map((segment) => [segment.key, segment]));
	const segmentsRemoved = [...beforeSegments.keys()].filter(
		(key) => !afterSegments.has(key)
	).length;
	const segmentsAdded = [...afterSegments.keys()].filter((key) => !beforeSegments.has(key)).length;
	let segmentsModified = 0;
	for (const [key, left] of beforeSegments) {
		const right = afterSegments.get(key);
		if (!right || structurallyEqual(left, right)) continue;
		segmentsModified++;
		if (examples.length < MAX_EXAMPLES)
			examples.push(`segment ${key}: ${jsonValue(left)} → ${jsonValue(right)}`);
	}

	const crossoversRemoved = multisetDifference(before.crossovers, after.crossovers, String).length;
	const crossoversAdded = multisetDifference(after.crossovers, before.crossovers, String).length;

	const beforeOligos = new Map(before.oligos.map((oligo) => [oligo.topology, oligo]));
	const afterOligos = new Map(after.oligos.map((oligo) => [oligo.topology, oligo]));
	const oligosRemoved = [...beforeOligos.keys()].filter((key) => !afterOligos.has(key)).length;
	const oligosAdded = [...afterOligos.keys()].filter((key) => !beforeOligos.has(key)).length;
	let oligosModified = 0;
	let colorChanges = 0;
	for (const [key, left] of beforeOligos) {
		const right = afterOligos.get(key);
		if (!right) continue;
		if (left.length !== right.length || left.circular !== right.circular) oligosModified++;
		if (left.color !== right.color) colorChanges++;
		if (
			(left.length !== right.length ||
				left.circular !== right.circular ||
				left.color !== right.color) &&
			examples.length < MAX_EXAMPLES
		) {
			examples.push(`oligo ${key}: ${jsonValue(left)} → ${jsonValue(right)}`);
		}
	}

	const foldnanoPartChanges =
		virtualHelixChanges +
		segmentsAdded +
		segmentsRemoved +
		segmentsModified +
		crossoversAdded +
		crossoversRemoved +
		oligosAdded +
		oligosRemoved +
		oligosModified;
	return {
		label,
		vstrandOrderChanged,
		movedVstrandCount,
		metadataChanges,
		virtualHelixChanges,
		segmentsAdded,
		segmentsRemoved,
		segmentsModified,
		crossoversAdded,
		crossoversRemoved,
		oligosAdded,
		oligosRemoved,
		oligosModified,
		colorChanges,
		foldnanoPartChanges,
		designAndColorChanges: foldnanoPartChanges + colorChanges,
		examples,
	};
}

/* ------------------------------------------------------------------ *
 * Pipeline
 * ------------------------------------------------------------------ */

function plainCadnano(json: CadnanoJSON): JsonObject {
	return parseObject(JSON.stringify(json));
}

export function importCadnano(
	json: JsonObject,
	fallbackName: string
): { cadnano: CadnanoJSON; part: Part } {
	const vstrands = asVstrands(json).map(asVStrandJson);
	const cadnano = new CadnanoJSON(
		typeof json.name === 'string' ? json.name : fallbackName,
		vstrands
	);
	return { cadnano, part: cadnano.toPart() };
}

export function exportCadnano(part: Part): JsonObject {
	const region = part.regions.find(
		(candidate): candidate is LatticedDesignRegion => candidate instanceof LatticedDesignRegion
	);
	if (!region) throw new Error('Imported part has no latticed region to export');
	const result = CadnanoJSON.fromRegion(region, part);
	if (result.droppedCrossRegionConnections !== 0) {
		throw new Error(
			`Export dropped ${result.droppedCrossRegionConnections} cross-region connections`
		);
	}
	return plainCadnano(result.json);
}

/** Independently predict which scaffold colour records the Part makes available to the exporter. */
function expectedScaffoldColorsFromPart(part: Part): Map<number, Array<[number, number]>> {
	const result = new Map<number, Array<[number, number]>>();
	for (const vh of part.virtualHelices) {
		const strandIdx = (vh.index % 2 === 0 ? 0 : 1) as 0 | 1;
		const oligos = new Set<Oligo>();
		for (const segmentId of vh.strandSets[strandIdx].segmentIds) {
			const oligo = part.getSegmentById(segmentId)?.oligo;
			if (oligo) oligos.add(oligo);
		}

		const colors: Array<[number, number]> = [];
		for (const oligo of oligos) {
			let colorSegment: OligoSegment | null = null;
			if (oligo.isCircular) {
				for (const segment of oligo.segments) {
					if (segment.inVirtualHelix !== vh || segment.inStrandIndex !== strandIdx) continue;
					if (!colorSegment || segment.fivePrime.index < colorSegment.fivePrime.index) {
						colorSegment = segment;
					}
				}
			} else {
				for (const segment of oligo.segments) {
					if (
						segment.inVirtualHelix === vh &&
						segment.inStrandIndex === strandIdx &&
						segment.fivePrime.isFree
					) {
						colorSegment = segment;
						break;
					}
				}
			}

			const match = oligo.color.match(/^#([0-9a-fA-F]{6})$/);
			if (colorSegment && match) {
				colors.push([colorSegment.fivePrime.index, parseInt(match[1], 16) & 0xffffff]);
			}
		}
		result.set(vh.index, colors);
	}
	return result;
}

export function readDesignText(file: string): string {
	return fs.readFileSync(path.join(DESIGNS_DIR, file), 'utf-8');
}

export function readDesign(file: string): JsonObject {
	return parseObject(readDesignText(file));
}

function seededRandom(seedText: string): () => number {
	let state = 0x811c9dc5;
	for (let i = 0; i < seedText.length; i++) {
		state ^= seedText.charCodeAt(i);
		state = Math.imul(state, 0x01000193);
	}
	return () => {
		state = Math.imul(state, 1664525) + 1013904223;
		return (state >>> 0) / 0x1_0000_0000;
	};
}

// Keeps report output byte-stable, but masks a real behaviour: uncoloured oligos draw a random colour
// (Oligo.constructor) that the exporter writes out. The "export determinism" suite pins that unseeded.
export function withSeededRandom<T>(seed: string, body: () => T): T {
	const originalRandom = Math.random;
	Math.random = seededRandom(seed);
	try {
		return body();
	} finally {
		Math.random = originalRandom;
	}
}

export function runDesign(file: string, sourceSha256: string): DesignResult {
	let stage = 'read J0';
	return withSeededRandom(file, () => {
		try {
			const J0 = readDesign(file);
			stage = 'import J0 → P1';
			const first = importCadnano(J0, file);
			const expectedScaffoldColors = expectedScaffoldColorsFromPart(first.part);
			const P1 = snapshotPart(first.part);
			stage = 'export P1 → J1';
			const J1 = exportCadnano(first.part);
			stage = 'import J1 → P2';
			const second = importCadnano(J1, file);
			const P2 = snapshotPart(second.part);
			stage = 'export P2 → J2';
			const J2 = exportCadnano(second.part);
			stage = 'import J2 → P3';
			const third = importCadnano(J2, file);
			const P3 = snapshotPart(third.part);

			const originalCadnanoPreservation = checkOriginalCadnanoDataPreservation(
				J0,
				J1,
				first.cadnano.warnings,
				expectedScaffoldColors
			);
			const J0J1 = compareCadnanoJson(J0, J1, 'J0→J1');
			const J1J2 = compareCadnanoJson(J1, J2, 'J1→J2');
			const P1P2 = compareParts(P1, P2, 'P1→P2');
			const P2P3 = compareParts(P2, P3, 'P2→P3');
			const problems = [
				...documentFieldProblems(J0, 'J0'),
				...documentFieldProblems(J1, 'J1'),
				...documentFieldProblems(J2, 'J2'),
			];

			let verdict = 'exact round trip';
			if (!J1J2.structurallyEqual || P2P3.designAndColorChanges > 0)
				verdict = 'recurring differences between comparisons';
			else if (P1P2.foldnanoPartChanges > 0)
				verdict = 'first-pass Foldnano Part change, then stable';
			else if (originalCadnanoPreservation.unexpectedDifferences.length > 0)
				verdict = 'unexpected export differences';
			else if (originalCadnanoPreservation.deletionRelocations.length > 0)
				verdict = 'lossy-but-warned (deletion relocated)';
			else if (P1P2.colorChanges > 0) verdict = 'first-pass metadata change, then stable';
			else if (!J0J1.structurallyEqual || P1P2.vstrandOrderChanged)
				verdict = 'stable normalization';

			return {
				design: file,
				sourceSha256,
				error: null,
				warnings: {
					J0: first.cadnano.warnings,
					J1: second.cadnano.warnings,
					J2: third.cadnano.warnings,
				},
				documentProblems: problems,
				originalCadnanoPreservation,
				J0J1,
				J1J2,
				P1P2,
				P2P3,
				verdict,
			};
		} catch (error) {
			return {
				design: file,
				sourceSha256,
				error: { stage, message: error instanceof Error ? error.message : String(error) },
				warnings: { J0: [], J1: [], J2: [] },
				documentProblems: [],
				originalCadnanoPreservation: null,
				J0J1: null,
				J1J2: null,
				P1P2: null,
				P2P3: null,
				verdict: `failed during ${stage}`,
			};
		}
	});
}
