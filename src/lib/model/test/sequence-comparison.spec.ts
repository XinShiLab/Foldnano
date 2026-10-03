// @vitest-environment node

// Corpus assertions for the sequence-generation comparison against cadnano 2.5. The comparison itself
// lives in ./sequence/comparison.ts, the provenance contract and report in ./sequence/report.ts, and
// fixture paths in ./sequence/fixtures.ts. Regenerate the reports with UPDATE_SEQUENCE_REPORT=1.

import * as fs from 'fs';

import { afterAll, describe, expect, it } from 'vitest';

import {
	type ColorAgreement,
	compareOligos,
	type DesignResult,
	parseReferenceCSV,
	physicalControl,
	readReferenceCSV,
	routeOf,
	runDesign,
} from './sequence/comparison';
import {
	designNames,
	EXPECTED_DESIGN_COUNT,
	provenance,
	referenceCsvPath,
	REPORT_JSON,
	REPORT_MARKDOWN,
} from './sequence/fixtures';
import {
	EXPECTED_GENERATOR_VERSION,
	EXPECTED_SEQUENCE_SOURCE,
} from './sequence/provenance-contract';
import {
	assertReportable,
	makeJson,
	makeMarkdown,
	PINNED_SEQUENCES,
	PROBE_DESIGN,
	referenceContractProblems,
	runSummaryLine,
	writeReports,
} from './sequence/report';
import { byCodeUnit } from './support/report-output';

const UPDATING = process.env.UPDATE_SEQUENCE_REPORT === '1';
const DESIGN_TIMEOUT_MS = 60_000;

const physical = physicalControl(PROBE_DESIGN);

describe('sequence comparison against cadnano 2.5', () => {
	const results: DesignResult[] = [];

	afterAll(() => {
		if (results.length === 0) return;
		results.sort((left, right) => byCodeUnit(left.design, right.design));
		if (UPDATING) writeReports(results, physical);
		console.log(runSummaryLine(results));
	});

	// The same contract the report guard enforces, so the two cannot drift apart.
	it('the committed reference set satisfies the reference contract', () => {
		expect(referenceContractProblems()).toEqual([]);
	});

	it.each(designNames)(
		'%s generates the same sequences as cadnano 2.5',
		(design) => {
			const result = runDesign(design);
			results.push(result);

			expect(result.error, `the comparison must complete for ${design}`).toBeNull();

			// PRIMARY RESULT: every oligo agrees on endpoints, length and sequence, both directions,
			// with no accepted exception of any kind.
			expect(result.differences, 'no oligo may differ in any way').toEqual([]);
			expect(
				result.unmatchedReferenceRoutes,
				'every cadnano oligo must have a generated counterpart'
			).toEqual([]);
			expect(
				result.unmatchedGeneratedRoutes,
				'every generated oligo must have a cadnano counterpart'
			).toEqual([]);
			expect(result.generatedOligos, 'oligo counts must agree').toBe(result.referenceOligos);
			expect(result.exactMatches, 'every reference oligo must match exactly').toBe(
				result.referenceOligos
			);
			expect(result.verdict).toBe('exact');

			// The scaffold must cover the whole route; otherwise both sides emit matching unsequenced
			// positions and agree trivially.
			expect(result.fillMissing, `the scaffold must cover every position of ${design}`).toBe(0);
			expect(
				result.circularExcluded,
				'both sides must exclude the same number of circular oligos'
			).toBe(provenance.designs[design].circularExcluded);

			// The download a user actually gets must carry the rows this comparison verified.
			expect(result.exporterError, `the CSV exporter must not reject ${design}`).toBeNull();
			expect(
				result.exporterAgrees,
				'the shipped CSV exporter must reproduce the verified rows exactly'
			).toBe(true);
			expect(
				result.modificationsEmpty,
				'the 5′/3′ modification columns are declared empty for this corpus'
			).toBe(true);

			expect(
				result.colors.unexplained,
				'every colour disagreement must be a colour Foldnano generated rather than read'
			).toEqual([]);
			expect(result.colors.matched + result.colors.generated, 'every colour accounted for').toBe(
				result.referenceOligos
			);
		},
		DESIGN_TIMEOUT_MS
	);

	it('the routes that exposed the wrong-API defect keep their full sequences', () => {
		for (const [design, routes] of Object.entries(PINNED_SEQUENCES)) {
			const rows = readReferenceCSV(design);
			const byRoute = new Map(
				rows.map((row) => [routeOf(row), row.sequence.toUpperCase().replace(/\?/g, 'N')])
			);
			for (const [route, expected] of Object.entries(routes)) {
				expect(byRoute.get(route), `${design} ${route}`).toBe(expected);
			}
		}
	});

	it('the sequences are reverse complements of the scaffold, unlike a shuffled control', () => {
		expect(physical.stretches).toBeGreaterThan(1000);
		for (const k of [10, 14, 20]) {
			expect(physical.real[k]).toBeGreaterThan(physical.shuffled[k]);
		}
		// At 14 nt the signal must be unambiguous rather than merely present.
		expect(physical.real[14] / physical.stretches).toBeGreaterThan(0.5);
		expect(physical.shuffled[14] / physical.stretches).toBeLessThan(0.05);
	});

	it('wrapping the scaffold for the reverse-complement window changes no count', () => {
		// Every route is linearised before sequence assignment and never runs past the scaffold's end,
		// so a wrap-around window should only ever find matches a non-wrapped window also finds. Checked
		// rather than asserted by comment: a future change to the linearisation could invalidate it.
		const wrapped = physicalControl(PROBE_DESIGN, true);
		expect(wrapped.stretches).toBe(physical.stretches);
		expect(wrapped.real).toEqual(physical.real);
		expect(wrapped.shuffled).toEqual(physical.shuffled);
	});

	it.skipIf(UPDATING)('the committed reports match this run', () => {
		expect(results).toHaveLength(EXPECTED_DESIGN_COUNT);
		const sorted = [...results].sort((left, right) => byCodeUnit(left.design, right.design));
		const normalise = (text: string) => text.replace(/\r\n/g, '\n');
		expect(fs.existsSync(REPORT_MARKDOWN), 'the markdown report must exist').toBe(true);
		expect(fs.existsSync(REPORT_JSON), 'the JSON report must exist').toBe(true);
		expect(normalise(makeMarkdown(sorted, physical))).toBe(
			normalise(fs.readFileSync(REPORT_MARKDOWN, 'utf-8'))
		);
		expect(normalise(makeJson(sorted, physical))).toBe(
			normalise(fs.readFileSync(REPORT_JSON, 'utf-8'))
		);
	});

	it('matches the documented aggregate result for the corpus', () => {
		expect(results).toHaveLength(EXPECTED_DESIGN_COUNT);
		expect(results.filter((result) => result.verdict !== 'exact')).toEqual([]);
		const totalReference = results.reduce((sum, result) => sum + result.referenceOligos, 0);
		expect(results.reduce((sum, result) => sum + result.exactMatches, 0)).toBe(totalReference);
	});
});

/* ------------------------------------------------------------------ *
 * Reference contract
 * ------------------------------------------------------------------ */

describe('reference contract', () => {
	const clone = () => JSON.parse(JSON.stringify(provenance));

	it('reports no problem for the committed set', () => {
		expect(referenceContractProblems(clone())).toEqual([]);
	});

	it.each([
		['a stale generator version', (p: typeof provenance) => (p.generatorVersion = 1)],
		[
			'sequences from the wrong cadnano API',
			(p: typeof provenance) => (p.sequenceSource = 'Oligo.sequence'),
		],
		['the wrong unsequenced marker', (p: typeof provenance) => (p.unsequencedMarker = ' ')],
		['an unapproved cadnano version', (p: typeof provenance) => (p.cadnano.version = '2.5.0')],
		['an unapproved cadnano commit', (p: typeof provenance) => (p.cadnano.commit = '0'.repeat(40))],
		[
			'an unexpected third modified cadnano file',
			(p: typeof provenance) => p.cadnano.modifiedFiles?.push('cadnano/extra.py'),
		],
		[
			'a tampered cadnano patch',
			(p: typeof provenance) => {
				const files = p.cadnano.modifiedFileSha256;
				if (files) files['cadnano/part/nucleicacidpart.py'] = '0'.repeat(64);
			},
		],
		['a tampered scaffold hash', (p: typeof provenance) => (p.scaffoldSha256 = '0'.repeat(64))],
		[
			'a provenance entry for a design that does not exist',
			(p: typeof provenance) => (p.designs.ghost = p.designs[PROBE_DESIGN]),
		],
		['a missing provenance entry', (p: typeof provenance) => delete p.designs[PROBE_DESIGN]],
	] as [string, (p: typeof provenance) => void][])('rejects %s', (_label, mutate) => {
		const damaged = clone();
		mutate(damaged);
		expect(referenceContractProblems(damaged).length).toBeGreaterThan(0);
	});

	it('pins the generator version and sequence source used to validate this corpus', () => {
		// A change here without updating the generator (scripts/gen_reference_sequences.py) and
		// regenerating the fixtures would otherwise pass silently.
		expect(EXPECTED_GENERATOR_VERSION).toBe(provenance.generatorVersion);
		expect(EXPECTED_SEQUENCE_SOURCE).toBe(provenance.sequenceSource);
	});
});

/* ------------------------------------------------------------------ *
 * Report guard
 * ------------------------------------------------------------------ */

describe('report guard', () => {
	const cleanColors = (): ColorAgreement => ({ matched: 5, generated: 0, unexplained: [] });

	const cleanResult = (design: string): DesignResult => ({
		design,
		error: null,
		scaffoldFile: 'scaf8634.txt',
		scaffoldRouteLength: 100,
		scaffoldCircular: false,
		linearizedAt: null,
		referenceOligos: 5,
		generatedOligos: 5,
		exactMatches: 5,
		nonExactReference: 0,
		nonExactGenerated: 0,
		differences: [],
		unmatchedReferenceRoutes: [],
		unmatchedGeneratedRoutes: [],
		oligoNt: 200,
		unsequencedNt: 0,
		fillLeftover: 0,
		fillMissing: 0,
		circularExcluded: 0,
		scafSlotOligos: 0,
		exporterAgrees: true,
		exporterError: null,
		modificationsEmpty: true,
		colors: cleanColors(),
		verdict: 'exact',
	});

	// The real corpus, not placeholder names: designSetProblems() checks against the actual designs
	// on disk, so a fixture using made-up names would fail that check regardless of what else it tests.
	const cleanResults = (): DesignResult[] => designNames.map(cleanResult);

	const cleanPhysical = () => physical;

	it('accepts a run in which every design completed cleanly', () => {
		expect(() => assertReportable(cleanResults(), cleanPhysical())).not.toThrow();
	});

	it.each([
		['an errored design', (r: DesignResult) => void (r.error = 'boom'), /boom/],
		['a non-exact verdict', (r: DesignResult) => void (r.verdict = 'differences'), /verdict/],
		[
			'an oligo that did not match',
			(r: DesignResult) => void (r.exactMatches = 4),
			/did not match exactly/,
		],
		[
			'a count mismatch between the two sides',
			(r: DesignResult) => void (r.generatedOligos = 4),
			/reference oligos against/,
		],
		[
			'a route left unmatched',
			(r: DesignResult) => void r.unmatchedReferenceRoutes.push('0[1] → 0[2]'),
			/routes left unmatched/,
		],
		[
			'a route position with no scaffold base',
			(r: DesignResult) => void (r.fillMissing = 3),
			/no scaffold base/,
		],
		[
			'an excluded circular oligo',
			(r: DesignResult) => void (r.circularExcluded = 1),
			/circular oligo/,
		],
		[
			'a shipped exporter that disagrees',
			(r: DesignResult) => void (r.exporterAgrees = false),
			/shipped CSV exporter/,
		],
		[
			'a non-empty modification column',
			(r: DesignResult) => void (r.modificationsEmpty = false),
			/modification columns/,
		],
		[
			'an unexplained colour disagreement',
			(r: DesignResult) => void r.colors.unexplained.push('0[1] → 0[2]'),
			/left unexplained/,
		],
	] as [string, (r: DesignResult) => void, RegExp][])(
		'refuses to report %s',
		(_label, damage, expected) => {
			const results = cleanResults();
			damage(results[0]);
			expect(() => assertReportable(results, cleanPhysical())).toThrow(expected);
		}
	);

	it('refuses to report when the physical control signal is too weak', () => {
		const weak = { ...cleanPhysical(), real: { ...cleanPhysical().real, 14: 0 } };
		expect(() => assertReportable(cleanResults(), weak)).toThrow(
			/physical control below threshold/
		);
	});

	it('refuses to report when the physical control negative control is too noisy', () => {
		const noisy = {
			...cleanPhysical(),
			shuffled: { ...cleanPhysical().shuffled, 14: cleanPhysical().stretches },
		};
		expect(() => assertReportable(cleanResults(), noisy)).toThrow(/physical control too noisy/);
	});

	it('refuses to report an incomplete result set', () => {
		expect(() => assertReportable([], cleanPhysical())).toThrow(
			/0 result\(s\) covering 0 distinct design/
		);
	});

	it('refuses to report the same design twice in place of a missing one', () => {
		const results = cleanResults();
		results[1] = cleanResult(results[0].design);
		expect(() => assertReportable(results, cleanPhysical())).toThrow(/distinct design/);
	});

	it('refuses to report ten unique names that are not the actual corpus', () => {
		const results = Array.from({ length: EXPECTED_DESIGN_COUNT }, (_, index) =>
			cleanResult(`not-a-real-design-${index}`)
		);
		expect(() => assertReportable(results, cleanPhysical())).toThrow(
			/design\(s\) not in the corpus/
		);
	});
});

/* ------------------------------------------------------------------ *
 * Comparison self-check
 * ------------------------------------------------------------------ */

describe('comparison self-check', () => {
	// A guard nobody has watched trip is not known to work: damage a valid reference and require a
	// report. The endpoint case is the one a Start-End-keyed comparison could not see.
	const reference = readReferenceCSV(PROBE_DESIGN);

	function damaged(mutate: (rows: typeof reference) => void): typeof reference {
		const copy = reference.map((row) => ({ ...row }));
		mutate(copy);
		return copy;
	}

	function firstFullySequenced(rows: typeof reference): (typeof reference)[number] {
		const row = rows.find((candidate) => /^[ACGT]+$/.test(candidate.sequence.trim()));
		if (!row) throw new Error(`${PROBE_DESIGN} has no fully sequenced oligo to damage`);
		return row;
	}

	it('an unmodified reference compares clean against itself', () => {
		const comparison = compareOligos(
			reference,
			reference.map((row) => ({ ...row }))
		);
		expect(comparison.exactMatches).toBe(reference.length);
		expect(comparison.differences).toEqual([]);
		expect(comparison.unmatchedReferenceRoutes).toEqual([]);
		expect(comparison.unmatchedGeneratedRoutes).toEqual([]);
	});

	it('a single changed base is reported as a base mismatch', () => {
		const generated = damaged((rows) => {
			const row = firstFullySequenced(rows);
			const bases = row.sequence.split('');
			const index = bases.findIndex((base) => base === 'A');
			if (index < 0) throw new Error('the chosen oligo has no A to change');
			bases[index] = 'C';
			row.sequence = bases.join('');
		});
		const comparison = compareOligos(reference, generated);
		expect(comparison.exactMatches).toBe(reference.length - 1);
		expect(comparison.differences.map((difference) => difference.kind)).toEqual(['baseMismatch']);
	});

	it('a changed base inside an otherwise unsequenced oligo is still reported', () => {
		// The shape of the two routes that exposed the wrong-API defect: a run of unsequenced
		// positions followed by real bases. A regression there must not read as a gap.
		const withGap = reference.find((row) => /\?/.test(row.sequence) && /[ACGT]/.test(row.sequence));
		if (!withGap) throw new Error(`${PROBE_DESIGN} has no partially sequenced oligo`);
		const generated = reference.map((row) => {
			if (row !== withGap) return { ...row };
			const bases = row.sequence.split('');
			const index = bases.findIndex((base) => 'ACGT'.includes(base));
			bases[index] = bases[index] === 'A' ? 'C' : 'A';
			return { ...row, sequence: bases.join('') };
		});
		const comparison = compareOligos(reference, generated);
		expect(comparison.differences.map((difference) => difference.kind)).toEqual(['baseMismatch']);
	});

	it('a moved endpoint is reported in both directions', () => {
		const generated = damaged((rows) => {
			rows[0].start = '99[7]';
		});
		const comparison = compareOligos(reference, generated);
		expect(comparison.exactMatches).toBe(reference.length - 1);
		expect(comparison.unmatchedReferenceRoutes).toHaveLength(1);
		expect(comparison.unmatchedGeneratedRoutes).toHaveLength(1);
	});

	it('a duplicated sequence cannot be matched twice', () => {
		const generated = damaged((rows) => {
			rows[1] = { ...rows[0] };
		});
		const comparison = compareOligos(reference, generated);
		expect(comparison.exactMatches).toBe(reference.length - 1);
		expect(comparison.unmatchedReferenceRoutes).toEqual([routeOf(reference[1])]);
	});

	it('a truncated oligo is reported as a length mismatch', () => {
		const generated = damaged((rows) => {
			rows[0].sequence = rows[0].sequence.slice(0, -1);
			rows[0].length -= 1;
		});
		const comparison = compareOligos(reference, generated);
		expect(comparison.differences.map((difference) => difference.kind)).toEqual(['lengthMismatch']);
	});

	it('a malformed reference row is rejected as malformed, not as a disagreement', () => {
		const valid = fs.readFileSync(referenceCsvPath(PROBE_DESIGN), 'utf-8');
		expect(() => parseReferenceCSV(valid.replace(/^0\[84\]/m, 'nonsense'), PROBE_DESIGN)).toThrow(
			/endpoints must look like/
		);
		expect(() => parseReferenceCSV(valid.replace(',26,', ',25,'), PROBE_DESIGN)).toThrow(
			/declares length/
		);
		expect(() => parseReferenceCSV(valid.replace('Start,End', 'start,end'), PROBE_DESIGN)).toThrow(
			/unexpected CSV header/
		);
	});
});
