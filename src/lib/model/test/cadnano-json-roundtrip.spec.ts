// @vitest-environment node

// Corpus assertions for the cadnano round-trip verification. The comparison itself lives in
// ./roundtrip/comparison.ts, its shape validation in ./roundtrip/validation.ts, and the two committed
// artefacts in ./roundtrip/report.ts. Regenerate the reports with UPDATE_CADNANO_REPORT=1.

import * as fs from 'fs';
import * as path from 'path';

import { afterAll, describe, expect, it } from 'vitest';

import { sha256Text } from './support/content-hash';
import {
	type CadnanoScopeAgreement,
	checkOriginalCadnanoDataPreservation,
	DESIGNS_DIR,
	type DesignResult,
	exportCadnano,
	importCadnano,
	type JsonComparison,
	type OriginalCadnanoDifference,
	type OriginalCadnanoPreservationReport,
	type PartComparison,
	readDesign,
	runDesign,
	vstrandDataIgnoringFormattingForComparison,
	withSeededRandom,
} from './roundtrip/comparison';
import {
	assertReportable,
	designProblems,
	EXPECTED_DELETION_RELOCATIONS,
	EXPECTED_DESIGN_COUNT,
	makeMarkdown,
	makeReportJson,
	REPORT_JSON,
	REPORT_MARKDOWN,
	runSummaryLine,
	writeReports,
} from './roundtrip/report';
import {
	asColorArray,
	asNumberArray,
	asTupleArray,
	asVstrands,
	asVStrandJson,
	deepClone,
	documentFieldProblems,
	type JsonObject,
	structurallyEqual,
} from './roundtrip/validation';

/** Small square-lattice design used by the self-check and determinism tests. */
const PROBE_DESIGN = '8hb_2ab_8f.json';

const UPDATING = process.env.UPDATE_CADNANO_REPORT === '1';

const designFiles = fs
	.readdirSync(DESIGNS_DIR)
	.filter((file) => file.endsWith('.json'))
	.sort();

/* ------------------------------------------------------------------ *
 * Fully typed guard fixtures
 * ------------------------------------------------------------------ */

function cleanAgreement(exact: boolean): CadnanoScopeAgreement {
	return {
		virtualHelixGeometry: true,
		strandAndCrossoverTopology: true,
		loops: true,
		skipsExactly: exact,
		sourceColors: true,
		exactInScopeAgreement: exact,
	};
}

function cleanPreservation(design: string): OriginalCadnanoPreservationReport {
	const relocations = deepClone(EXPECTED_DELETION_RELOCATIONS[design] ?? []);
	return {
		allComparedDataEqual: relocations.length === 0,
		agreement: cleanAgreement(relocations.length === 0),
		representationOnlyChanges: [],
		generatedMetadataChanges: [],
		warnedLossyDifferences: [],
		unexpectedDifferences: [],
		deletionRelocations: relocations,
		selfReferentialExits: 0,
		scaffoldColorsInvented: 0,
	};
}

function cleanJsonComparison(label: string): JsonComparison {
	return {
		label,
		structurallyEqual: true,
		topLevelKeyOrderChanged: false,
		vstrandOrder: {
			changed: false,
			before: [0],
			after: [0],
			movedCount: 0,
			sameNumbers: true,
			afterIsAscending: true,
		},
		duplicateVstrandNumbers: { before: [], after: [] },
		keyOrderChanges: [],
		addedFields: [],
		removedFields: [],
		renamedFields: [],
		arrayLengthChanges: [],
		tupleChanges: [],
		numericArrayChanges: [],
		scalarChanges: [],
		colorOrderOnly: [],
		colorMappingChanges: [],
		totalTupleEntriesChanged: 0,
		totalNumericEntriesChanged: 0,
		totalColorMappingsChanged: 0,
		totalSchemaOccurrencesChanged: 0,
		totalPresentationChanges: 0,
	};
}

function cleanPartComparison(label: string): PartComparison {
	return {
		label,
		vstrandOrderChanged: false,
		movedVstrandCount: 0,
		metadataChanges: 0,
		virtualHelixChanges: 0,
		segmentsAdded: 0,
		segmentsRemoved: 0,
		segmentsModified: 0,
		crossoversAdded: 0,
		crossoversRemoved: 0,
		oligosAdded: 0,
		oligosRemoved: 0,
		oligosModified: 0,
		colorChanges: 0,
		foldnanoPartChanges: 0,
		designAndColorChanges: 0,
		examples: [],
	};
}

function cleanDifference(): OriginalCadnanoDifference {
	return {
		vstrand: 0,
		field: 'scaf',
		index: 0,
		before: [0, 0, 0, 1],
		after: [0, 0, 0, 2],
		category: 'unexpected',
		reason: 'connection tuple changed',
	};
}

function cleanDesignResult(design: string): DesignResult {
	return {
		design,
		sourceSha256: 'a'.repeat(64),
		error: null,
		warnings: { J0: [], J1: [], J2: [] },
		documentProblems: [],
		originalCadnanoPreservation: cleanPreservation(design),
		J0J1: cleanJsonComparison('J0→J1'),
		J1J2: cleanJsonComparison('J1→J2'),
		P1P2: cleanPartComparison('P1→P2'),
		P2P3: cleanPartComparison('P2→P3'),
		verdict: 'exact round trip',
	};
}

/* ------------------------------------------------------------------ *
 * Corpus
 * ------------------------------------------------------------------ */

describe('cadnano published-design round-trip verification', () => {
	const results: DesignResult[] = [];

	afterAll(() => {
		if (results.length === 0) return;
		if (UPDATING) writeReports(results);
		console.log(runSummaryLine(results));
	});

	it('the published-design corpus contains exactly ten JSON files', () => {
		expect(designFiles).toHaveLength(EXPECTED_DESIGN_COUNT);
	});

	it.each(designFiles)(
		'%s survives import → export → re-import',
		(file) => {
			const result = runDesign(file, sha256Text(path.join(DESIGNS_DIR, file)));
			results.push(result);

			// One shared list, also used by the report guard, so the two cannot enforce different
			// things: unclassified differences, relocations at the reviewed coordinates, the agreement
			// verdict, and stability across both further cycles.
			expect(designProblems(result), `${file} must round-trip cleanly`).toEqual([]);
		},
		60_000
	);

	it.skipIf(UPDATING)('the committed reports match this run', () => {
		expect(results).toHaveLength(EXPECTED_DESIGN_COUNT);
		const normalise = (text: string) => text.replace(/\r\n/g, '\n');
		expect(fs.existsSync(REPORT_MARKDOWN), 'the markdown report must exist').toBe(true);
		expect(fs.existsSync(REPORT_JSON), 'the JSON report must exist').toBe(true);
		expect(normalise(makeMarkdown(results))).toBe(
			normalise(fs.readFileSync(REPORT_MARKDOWN, 'utf-8'))
		);
		expect(normalise(makeReportJson(results))).toBe(
			normalise(fs.readFileSync(REPORT_JSON, 'utf-8'))
		);
	});

	it('matches the documented aggregate result for the ten-design corpus', () => {
		expect(results).toHaveLength(EXPECTED_DESIGN_COUNT);
		const reports = results.map((result) => result.originalCadnanoPreservation);
		expect(reports.every((report) => report !== null)).toBe(true);
		expect(reports.filter((report) => report?.agreement.exactInScopeAgreement).length).toBe(8);
		expect(reports.filter((report) => report?.agreement.virtualHelixGeometry).length).toBe(10);
		expect(reports.filter((report) => report?.agreement.strandAndCrossoverTopology).length).toBe(
			10
		);
		expect(reports.filter((report) => report?.agreement.loops).length).toBe(10);
		expect(reports.filter((report) => report?.agreement.skipsExactly).length).toBe(8);
		expect(reports.filter((report) => report?.agreement.sourceColors).length).toBe(10);
		expect(
			reports.reduce((sum, report) => sum + (report?.deletionRelocations.length ?? 0), 0)
		).toBe(9);
		expect(
			reports.reduce((sum, report) => sum + (report?.unexpectedDifferences.length ?? 0), 0)
		).toBe(0);
	});
});

/* ------------------------------------------------------------------ *
 * Report guard
 * ------------------------------------------------------------------ */

describe('the report guard', () => {
	// The baseline design carries the relocations 4FSF is reviewed to have, so the wrong-coordinates
	// case can keep the count identical and change only the position.
	const RELOCATING_DESIGN = '4FSF_25_2b_complete_full_loopbackscaffold.json';

	// The real corpus, not placeholder names: designSetProblems() checks against the actual designs
	// on disk, so a fixture using made-up names would fail that check regardless of what else it tests.
	// RELOCATING_DESIGN is put first so the relocation-specific tests below can mutate results[0].
	const clean = (): DesignResult[] =>
		[RELOCATING_DESIGN, ...designFiles.filter((file) => file !== RELOCATING_DESIGN)].map(
			cleanDesignResult
		);

	it('accepts a run in which every design completed cleanly', () => {
		expect(() => assertReportable(clean())).not.toThrow();
	});

	it('refuses to report when a design errored', () => {
		const results = clean();
		results[0].error = { stage: 'import', message: 'boom' };
		expect(() => assertReportable(results)).toThrow(/refusing to write the reports/);
	});

	it('refuses to report a document field the comparison cannot read', () => {
		const results = clean();
		results[0].documentProblems = ['J1: vstrand 3: unknown field "mystery"'];
		expect(() => assertReportable(results)).toThrow(/unknown field "mystery"/);
	});

	it('refuses to report an unclassified in-scope difference', () => {
		const results = clean();
		results[0].originalCadnanoPreservation!.unexpectedDifferences = [cleanDifference()];
		expect(() => assertReportable(results)).toThrow(/unclassified in-scope difference/);
	});

	it('refuses to report the reviewed number of relocations at the wrong coordinates', () => {
		const results = clean();
		const relocations = results[0].originalCadnanoPreservation!.deletionRelocations;
		expect(relocations.length).toBeGreaterThan(0);
		const before = relocations.length;
		relocations[0].toBase += 1;
		expect(relocations).toHaveLength(before);
		expect(() => assertReportable(results)).toThrow(/reviewed baseline/);
	});

	it('refuses to report a design whose agreement verdict contradicts its relocations', () => {
		const results = clean();
		results[0].originalCadnanoPreservation!.agreement.exactInScopeAgreement = true;
		expect(() => assertReportable(results)).toThrow(/exact-agreement verdict/);
	});

	it.each([
		['originalCadnanoPreservation', /no cadnano preservation report/],
		['J0J1', /no J0–J1 comparison/],
		['P1P2', /no P1–P2 comparison/],
		['J1J2', /no J1–J2 comparison/],
		['P2P3', /no P2–P3 comparison/],
	] as const)('refuses to report when %s is missing', (field, expected) => {
		const results = clean();
		results[0][field] = null;
		expect(() => assertReportable(results)).toThrow(expected);
	});

	it.each(['P1P2', 'P2P3'] as const)('refuses to report an unstable %s', (field) => {
		const results = clean();
		results[0][field]!.designAndColorChanges = 3;
		expect(() => assertReportable(results)).toThrow(/Part change\(s\)/);
	});

	it('refuses to report when the next export is not stable', () => {
		const results = clean();
		results[0].J1J2!.structurallyEqual = false;
		expect(() => assertReportable(results)).toThrow(/recurring differences/);
	});

	it('refuses to report a result with no source hash', () => {
		const results = clean();
		results[0].sourceSha256 = '';
		expect(() => assertReportable(results)).toThrow(/staleness cannot be detected/);
	});

	it('refuses to report an incomplete result set', () => {
		expect(() => assertReportable(clean().slice(1))).toThrow(/distinct design/);
	});

	it('refuses to report the same design twice in place of a missing one', () => {
		const results = clean();
		results[1] = cleanDesignResult(results[0].design);
		expect(() => assertReportable(results)).toThrow(/distinct design/);
	});

	it('refuses to report ten unique names that are not the actual corpus', () => {
		const results = Array.from({ length: EXPECTED_DESIGN_COUNT }, (_, index) =>
			cleanDesignResult(`not-a-real-design-${index}.json`)
		);
		expect(() => assertReportable(results)).toThrow(/design\(s\) not in the corpus/);
	});
});

/* ------------------------------------------------------------------ *
 * Checker self-check
 * ------------------------------------------------------------------ */

describe('round-trip checker self-check', () => {
	// A guard nobody has watched trip is not known to work: damage a valid export and require a report.
	const exported = withSeededRandom(PROBE_DESIGN, () => {
		const { part } = importCadnano(readDesign(PROBE_DESIGN), PROBE_DESIGN);
		return exportCadnano(part);
	});

	function unexpectedDifferenceCount(corrupt: (json: JsonObject) => void): number {
		const damaged = deepClone(exported);
		corrupt(damaged);
		return checkOriginalCadnanoDataPreservation(exported, damaged, []).unexpectedDifferences.length;
	}

	function firstOccupied(
		json: JsonObject,
		field: 'scaf' | 'stap'
	): { vstrand: JsonObject; tuples: number[][]; index: number } {
		for (const vstrand of asVstrands(json)) {
			const tuples = asTupleArray(vstrand[field]) ?? [];
			const index = tuples.findIndex((tuple) => tuple.some((value) => value !== -1));
			if (index !== -1) return { vstrand, tuples, index };
		}
		throw new Error(`no occupied ${field} base found in the probe design`);
	}

	function focusedDocument(overrides: JsonObject = {}): JsonObject {
		return {
			name: 'classification probe',
			vstrands: [
				{
					row: 0,
					col: 0,
					num: 0,
					scaf: [
						[-1, -1, 0, 1],
						[0, 1, 1, 8],
						[-1, -1, -1, -1],
					],
					stap: Array.from({ length: 3 }, () => [-1, -1, -1, -1]),
					loop: [0, 0, 0],
					skip: [0, 0, 0],
					scaf_loop: [],
					stap_loop: [],
					stap_colors: [],
					scaf_colors: [],
					...overrides,
				},
			],
		};
	}

	it('reports nothing when the document is unchanged', () => {
		expect(
			checkOriginalCadnanoDataPreservation(exported, deepClone(exported), []).unexpectedDifferences
		).toEqual([]);
	});

	it('reports a source field it does not know how to compare', () => {
		const source = deepClone(exported);
		// A field the comparison has no case for would otherwise be dropped from both sides.
		asVstrands(source)[0].mystery_field = [1, 2, 3];
		const differences = checkOriginalCadnanoDataPreservation(
			source,
			deepClone(exported),
			[]
		).unexpectedDifferences;
		expect(differences.map((difference) => difference.field)).toContain('mystery_field');
	});

	it('detects an erased staple base', () => {
		expect(
			unexpectedDifferenceCount((json) => {
				const { vstrand, tuples, index } = firstOccupied(json, 'stap');
				tuples[index] = [-1, -1, -1, -1];
				vstrand.stap = tuples;
			})
		).toBeGreaterThan(0);
	});

	it('detects a redirected crossover', () => {
		expect(
			unexpectedDifferenceCount((json) => {
				const { vstrand, tuples, index } = firstOccupied(json, 'scaf');
				tuples[index] = [tuples[index][0], tuples[index][1], 999, tuples[index][3]];
				vstrand.scaf = tuples;
			})
		).toBeGreaterThan(0);
	});

	it('detects a dropped deletion', () => {
		expect(
			unexpectedDifferenceCount((json) => {
				for (const vstrand of asVstrands(json)) {
					const skip = asNumberArray(vstrand.skip) ?? [];
					const index = skip.indexOf(-1);
					if (index === -1) continue;
					skip[index] = 0;
					vstrand.skip = skip;
					return;
				}
				// The probe design has no deletions; fall back to introducing one so the test stays honest.
				const vstrand = asVstrands(json)[0];
				const skip = asNumberArray(vstrand.skip) ?? [];
				skip[0] = -1;
				vstrand.skip = skip;
			})
		).toBeGreaterThan(0);
	});

	it('does not wave through a scaffold colour that was replaced rather than added', () => {
		expect(
			unexpectedDifferenceCount((json) => {
				for (const vstrand of asVstrands(json)) {
					const colors = asColorArray(vstrand.scaf_colors) ?? [];
					if (colors.length === 0) continue;
					vstrand.scaf_colors = [[colors[0][0], 0x123456]];
					return;
				}
				throw new Error('probe design has no scaf_colors to replace');
			})
		).toBeGreaterThan(0);
	});

	it('classifies only a fully validated self-reference rewrite as representation-only', () => {
		const source = focusedDocument();
		const changed = focusedDocument({
			scaf: [
				[-1, -1, 0, 1],
				[0, 0, 1, 8],
				[-1, -1, -1, -1],
			],
		});
		const report = checkOriginalCadnanoDataPreservation(source, changed, []);
		expect(report.representationOnlyChanges).toHaveLength(1);
		expect(report.unexpectedDifferences).toEqual([]);
		expect(report.agreement.strandAndCrossoverTopology).toBe(true);
	});

	it('rejects a lookalike self-reference rewrite when the successor also changes', () => {
		const source = focusedDocument();
		const changed = focusedDocument({
			scaf: [
				[-1, -1, 0, 1],
				[0, 0, 1, 9],
				[-1, -1, -1, -1],
			],
		});
		const report = checkOriginalCadnanoDataPreservation(source, changed, []);
		expect(report.representationOnlyChanges).toEqual([]);
		expect(report.unexpectedDifferences).toHaveLength(1);
		expect(report.agreement.strandAndCrossoverTopology).toBe(false);
	});

	it('classifies a warned and fully matched deletion move as lossy', () => {
		const source = focusedDocument({ skip: [0, -1, 0] });
		const changed = focusedDocument({ skip: [0, 0, -1] });
		const report = checkOriginalCadnanoDataPreservation(source, changed, [
			'VH 0: deletion at crossover bp 1 moved to bp 2',
		]);
		expect(report.deletionRelocations).toEqual([{ vstrand: 0, fromBase: 1, toBase: 2 }]);
		expect(report.warnedLossyDifferences).toHaveLength(2);
		expect(report.unexpectedDifferences).toEqual([]);
		expect(report.agreement.skipsExactly).toBe(false);
	});

	it('rejects a deletion move without its matching warning', () => {
		const report = checkOriginalCadnanoDataPreservation(
			focusedDocument({ skip: [0, -1, 0] }),
			focusedDocument({ skip: [0, 0, -1] }),
			[]
		);
		expect(report.deletionRelocations).toEqual([]);
		expect(report.warnedLossyDifferences).toEqual([]);
		expect(report.unexpectedDifferences).toHaveLength(2);
	});

	it('classifies only an added missing scaffold colour as generated metadata', () => {
		const color = 0x123456;
		const report = checkOriginalCadnanoDataPreservation(
			focusedDocument(),
			focusedDocument({ scaf_colors: [[1, color]] }),
			[],
			new Map([[0, [[1, color]]]])
		);
		expect(report.generatedMetadataChanges).toHaveLength(1);
		expect(report.unexpectedDifferences).toEqual([]);
		expect(report.agreement.sourceColors).toBe(true);
	});

	it('rejects an extra scaffold colour that was not predicted from the imported Part', () => {
		const sourceColor: [number, number] = [0, 0x111111];
		const extraColor: [number, number] = [1, 0x222222];
		const report = checkOriginalCadnanoDataPreservation(
			focusedDocument({ scaf_colors: [sourceColor] }),
			focusedDocument({ scaf_colors: [sourceColor, extraColor] }),
			[],
			new Map([[0, [sourceColor]]])
		);
		expect(report.generatedMetadataChanges).toEqual([]);
		expect(report.unexpectedDifferences).toHaveLength(1);
		expect(report.agreement.sourceColors).toBe(false);
	});

	it('rejects duplicate vstrand numbers even when both documents contain the duplicate', () => {
		const source = focusedDocument();
		const duplicate = deepClone(asVstrands(source)[0]);
		duplicate.row = 1;
		(source.vstrands as unknown[]).push(duplicate);
		const report = checkOriginalCadnanoDataPreservation(source, deepClone(source), []);
		expect(report.unexpectedDifferences).toEqual([
			expect.objectContaining({
				vstrand: 0,
				field: 'vstrand.num.duplicate',
				category: 'unexpected',
			}),
		]);
		expect(report.agreement.virtualHelixGeometry).toBe(false);
		expect(report.agreement.strandAndCrossoverTopology).toBe(false);
	});
});

/* ------------------------------------------------------------------ *
 * Shape validation
 * ------------------------------------------------------------------ */

describe('cadnano document validation', () => {
	const sourceVstrand = (): JsonObject => ({
		row: 0,
		col: 0,
		num: 0,
		scaf: [
			[-1, -1, 0, 1],
			[0, 0, -1, -1],
		],
		stap: [
			[-1, -1, -1, -1],
			[-1, -1, -1, -1],
		],
		loop: [0, 0],
		skip: [0, 0],
		scafLoop: [],
		stapLoop: [],
		stap_colors: [[0, 0x1234ab]],
	});

	const document = (overrides: JsonObject = {}): JsonObject => ({
		name: 'validation probe',
		vstrands: [{ ...sourceVstrand(), ...overrides }],
	});

	it('accepts a well-formed source vstrand', () => {
		expect(() => asVStrandJson(sourceVstrand())).not.toThrow();
	});

	it('rejects a vstrands entry that is not an object', () => {
		const source = document();
		(source.vstrands as unknown[])[0] = 42;
		expect(() => asVstrands(source)).toThrow(/vstrands\[0\] is not an object/);
	});

	it.each([
		['a non-numeric row', { row: 'first' }, /"row" must be an integer/],
		['a fractional col', { col: 1.5 }, /"col" must be an integer/],
		['a scaf entry that is not a four-value tuple', { scaf: [[1, 2]] }, /four-integer tuples/],
		[
			'a fractional value inside a connection tuple',
			{
				scaf: [
					[0, 0.5, -1, -1],
					[-1, -1, -1, -1],
				],
			},
			/four-integer tuples/,
		],
		['a skip array holding a string', { skip: ['x', 0] }, /"skip" must be an array of integers/],
		['per-base arrays of different lengths', { loop: [] }, /"loop" holds 0 bases/],
		['a non-integer scaf_loop', { scaf_loop: ['x'] }, /"scaf_loop" must be an array of integers/],
		['a non-integer stapLoop', { stapLoop: [1.5] }, /"stapLoop" must be an array of integers/],
		[
			'the two loop spellings disagreeing',
			{ scaf_loop: [1], scafLoop: [2] },
			/"scaf_loop" and "scafLoop" disagree/,
		],
		['a colour entry that is not an index/colour pair', { stap_colors: [[0]] }, /integer pairs/],
		[
			'a colour entry indexing a base outside the helix',
			{ scaf_colors: [[9, 0x112233]] },
			/indexes base 9, outside 0–1/,
		],
		[
			'a colour value outside 24-bit RGB',
			{ scaf_colors: [[0, 0x1000000]] },
			/outside 0x000000–0xFFFFFF/,
		],
	] as [string, JsonObject, RegExp][])('rejects %s', (_label, overrides, expected) => {
		expect(() => asVStrandJson({ ...sourceVstrand(), ...overrides })).toThrow(expected);
	});

	it('accepts the two loop spellings when they agree', () => {
		expect(() =>
			asVStrandJson({ ...sourceVstrand(), scaf_loop: [0, 0], scafLoop: [0, 0] })
		).not.toThrow();
	});

	it('reports nothing for a well-formed document', () => {
		expect(documentFieldProblems(document(), 'J0')).toEqual([]);
	});

	it('tolerates the empty husks the exporter emits', () => {
		expect(documentFieldProblems(document({ segments: [{}, {}], warnings: [] }), 'J1')).toEqual([]);
	});

	it.each([
		['a non-empty segments field', { segments: [{ bp: 3 }, {}] }, /"segments" carries content/],
		['a non-empty warnings field', { warnings: ['something'] }, /"warnings" carries content/],
		['an unknown vstrand field', { mystery: 1 }, /unknown field "mystery"/],
	] as [string, JsonObject, RegExp][])('reports %s', (_label, overrides, expected) => {
		const problems = documentFieldProblems(document(overrides), 'J1');
		expect(problems).toHaveLength(1);
		expect(problems[0]).toMatch(expected);
	});

	it('reports an unknown top-level field', () => {
		const problems = documentFieldProblems({ ...document(), extra: 1 }, 'J0');
		expect(problems).toEqual(['J0: unknown top-level field "extra"']);
	});
});

/* ------------------------------------------------------------------ *
 * Export determinism
 * ------------------------------------------------------------------ */

describe('export determinism', () => {
	// Deliberately NOT seeded: this pins the real behaviour that the main suite's seeding masks.
	it('writes a freshly generated scaffold colour into every export', () => {
		const source = readDesign(PROBE_DESIGN);
		const first = exportCadnano(importCadnano(source, PROBE_DESIGN).part);
		const second = exportCadnano(importCadnano(source, PROBE_DESIGN).part);

		expect(
			structurallyEqual(first, second),
			'exporting the same design twice currently produces different files'
		).toBe(false);

		const withoutColors = (json: JsonObject) =>
			vstrandDataIgnoringFormattingForComparison(json).map((vstrand) => {
				const { stap_colors: _stap, scaf_colors: _scaf, ...rest } = vstrand;
				return rest;
			});
		expect(withoutColors(first), 'the non-colour content must be identical between runs').toEqual(
			withoutColors(second)
		);

		const scaffoldColors = (json: JsonObject) =>
			vstrandDataIgnoringFormattingForComparison(json).map((vstrand) => vstrand.scaf_colors);
		expect(
			structurallyEqual(scaffoldColors(first), scaffoldColors(second)),
			'the difference is confined to scaf_colors (Oligo.constructor → CadnanoJSON.fromRegion())'
		).toBe(false);

		// The source file carries no scaffold palette, so these colours are generated, not preserved.
		for (const vstrand of asVstrands(source)) {
			expect(vstrand.scaf_colors ?? []).toEqual([]);
		}
	});
});
