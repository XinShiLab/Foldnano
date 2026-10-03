// Shape validation for cadnano documents read or written by the round-trip suite. Everything here
// fails loudly: a wrongly typed field that reached the importer as-is would be reported as a design
// difference instead of a malformed file.

import type { VStrandJSON } from '$lib/model/io/cadnanoJSON';

export type JsonObject = Record<string, unknown>;

export function isObject(value: unknown): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseObject(text: string): JsonObject {
	const parsed: unknown = JSON.parse(text);
	if (!isObject(parsed)) throw new Error('Expected a top-level JSON object');
	return parsed;
}

/** Throws rather than filtering: a dropped vstrand would shrink the comparison silently. */
export function asVstrands(json: JsonObject): JsonObject[] {
	if (!Array.isArray(json.vstrands)) throw new Error('Expected top-level vstrands array');
	return json.vstrands.map((vstrand, index) => {
		if (!isObject(vstrand)) throw new Error(`vstrands[${index}] is not an object`);
		return vstrand;
	});
}

export function vstrandNumber(vstrand: JsonObject): number {
	return typeof vstrand.num === 'number' ? vstrand.num : Number.NaN;
}

export function asIntegerArray(value: unknown): number[] | null {
	if (!Array.isArray(value) || !value.every((item) => Number.isInteger(item))) return null;
	return value;
}

export function asNumberArray(value: unknown): number[] | null {
	if (!Array.isArray(value) || !value.every((item) => typeof item === 'number')) return null;
	return value;
}

export function asTupleArray(value: unknown): number[][] | null {
	if (!Array.isArray(value)) return null;
	const tuples: number[][] = [];
	for (const item of value) {
		if (!Array.isArray(item) || item.length !== 4 || !item.every((n) => Number.isInteger(n))) {
			return null;
		}
		tuples.push(item);
	}
	return tuples;
}

export function asColorArray(value: unknown): Array<[number, number]> | null {
	if (!Array.isArray(value)) return null;
	const colors: Array<[number, number]> = [];
	for (const item of value) {
		if (
			!Array.isArray(item) ||
			item.length !== 2 ||
			!Number.isInteger(item[0]) ||
			!Number.isInteger(item[1])
		) {
			return null;
		}
		colors.push([item[0], item[1]]);
	}
	return colors;
}

export function jsonValue(value: unknown): string {
	return JSON.stringify(value);
}

export function deepClone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function deepSorted(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(deepSorted);
	if (!isObject(value)) return value;
	return Object.fromEntries(
		Object.keys(value)
			.sort()
			.map((key) => [key, deepSorted(value[key])])
	);
}

export function structurallyEqual(left: unknown, right: unknown): boolean {
	return JSON.stringify(deepSorted(left)) === JSON.stringify(deepSorted(right));
}

export function duplicateNumbers(values: number[]): number[] {
	const seen = new Set<number>();
	const duplicates = new Set<number>();
	for (const value of values) {
		if (seen.has(value)) duplicates.add(value);
		seen.add(value);
	}
	return [...duplicates].sort((a, b) => a - b);
}

/* ------------------------------------------------------------------ *
 * The compared field set
 * ------------------------------------------------------------------ */

export const COMPARISON_SCALAR_FIELDS = ['row', 'col', 'num'] as const;
export const COMPARISON_TUPLE_FIELDS = ['scaf', 'stap'] as const;
export const COMPARISON_NUMBER_FIELDS = ['loop', 'skip', 'scaf_loop', 'stap_loop'] as const;
export const COMPARISON_COLOR_FIELDS = ['stap_colors', 'scaf_colors'] as const;

/** Every field the comparison reads, plus the camelCase loop spellings cadnano 2 also emits. */
export const COMPARABLE_VSTRAND_FIELDS: ReadonlySet<string> = new Set<string>([
	...COMPARISON_SCALAR_FIELDS,
	...COMPARISON_TUPLE_FIELDS,
	...COMPARISON_NUMBER_FIELDS,
	...COMPARISON_COLOR_FIELDS,
	'scafLoop',
	'stapLoop',
]);

/** Emitted by the exporter and expected to be empty husks; checked, not assumed. */
export const EXPECTED_EMPTY_VSTRAND_FIELDS = ['segments', 'warnings'] as const;

export const KNOWN_VSTRAND_FIELDS: ReadonlySet<string> = new Set<string>([
	...COMPARABLE_VSTRAND_FIELDS,
	...EXPECTED_EMPTY_VSTRAND_FIELDS,
]);

const KNOWN_TOP_LEVEL_FIELDS: ReadonlySet<string> = new Set(['name', 'vstrands']);

/* ------------------------------------------------------------------ *
 * Document-level checks
 * ------------------------------------------------------------------ */

/** True when the value is an empty husk: `{}`, `[]`, or an array of empty objects/arrays. */
function isEmptyHusk(value: unknown): boolean {
	if (Array.isArray(value)) return value.every(isEmptyHusk);
	if (isObject(value)) return Object.keys(value).length === 0;
	return false;
}

/**
 * Fields the comparison cannot read, reported so "no data-bearing field is silently omitted" is a
 * checked statement rather than a claim. `segments` and `warnings` are tolerated only while they stay
 * empty; the moment either carries content it is data the round trip does not compare.
 */
export function documentFieldProblems(json: JsonObject, label: string): string[] {
	const problems: string[] = [];
	for (const field of Object.keys(json)) {
		if (!KNOWN_TOP_LEVEL_FIELDS.has(field)) {
			problems.push(`${label}: unknown top-level field "${field}"`);
		}
	}
	for (const vstrand of asVstrands(json)) {
		const where = `${label}: vstrand ${vstrandNumber(vstrand)}`;
		for (const field of Object.keys(vstrand)) {
			if (!KNOWN_VSTRAND_FIELDS.has(field)) {
				problems.push(`${where}: unknown field "${field}"`);
			}
		}
		for (const field of EXPECTED_EMPTY_VSTRAND_FIELDS) {
			if (field in vstrand && !isEmptyHusk(vstrand[field])) {
				problems.push(`${where}: "${field}" carries content, which the comparison does not read`);
			}
		}
	}
	return problems;
}

/* ------------------------------------------------------------------ *
 * Per-vstrand validation
 * ------------------------------------------------------------------ */

const MAX_COLOR = 0xffffff;

/** Validates shape before casting: a wrongly typed field would otherwise reach the importer as-is. */
export function asVStrandJson(vstrand: JsonObject): VStrandJSON {
	const label = typeof vstrand.num === 'number' ? `vstrand ${vstrand.num}` : 'vstrand';

	for (const field of COMPARISON_SCALAR_FIELDS) {
		if (!Number.isInteger(vstrand[field])) {
			throw new Error(`${label}: "${field}" must be an integer`);
		}
	}
	for (const field of COMPARISON_TUPLE_FIELDS) {
		if (!asTupleArray(vstrand[field])) {
			throw new Error(`${label}: "${field}" must be an array of four-integer tuples`);
		}
	}
	for (const field of ['loop', 'skip'] as const) {
		if (!asIntegerArray(vstrand[field])) {
			throw new Error(`${label}: "${field}" must be an array of integers`);
		}
	}

	// Every per-base array indexes the same helix, so a length mismatch means the file is incoherent.
	const baseCount = (vstrand.scaf as unknown[]).length;
	for (const field of ['stap', 'loop', 'skip'] as const) {
		const length = (vstrand[field] as unknown[]).length;
		if (length !== baseCount) {
			throw new Error(`${label}: "${field}" holds ${length} bases but "scaf" holds ${baseCount}`);
		}
	}

	// Both spellings are accepted on input, so both are validated, and a document carrying the two
	// with different contents is rejected rather than resolved by precedence.
	for (const [snake, camel] of [
		['scaf_loop', 'scafLoop'],
		['stap_loop', 'stapLoop'],
	] as const) {
		for (const field of [snake, camel]) {
			if (field in vstrand && !asIntegerArray(vstrand[field])) {
				throw new Error(`${label}: "${field}" must be an array of integers`);
			}
		}
		if (
			snake in vstrand &&
			camel in vstrand &&
			!structurallyEqual(vstrand[snake], vstrand[camel])
		) {
			throw new Error(`${label}: "${snake}" and "${camel}" disagree`);
		}
	}

	for (const field of COMPARISON_COLOR_FIELDS) {
		if (!(field in vstrand)) continue;
		const colors = asColorArray(vstrand[field]);
		if (!colors) {
			throw new Error(`${label}: "${field}" must be an array of [baseIndex, color] integer pairs`);
		}
		for (const [baseIndex, color] of colors) {
			if (baseIndex < 0 || baseIndex >= baseCount) {
				throw new Error(
					`${label}: "${field}" indexes base ${baseIndex}, outside 0–${baseCount - 1}`
				);
			}
			if (color < 0 || color > MAX_COLOR) {
				throw new Error(`${label}: "${field}" holds colour ${color}, outside 0x000000–0xFFFFFF`);
			}
		}
	}

	return vstrand as unknown as VStrandJSON;
}
