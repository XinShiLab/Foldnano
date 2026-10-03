// Renders the committed sequence-comparison reports and refuses to write them from a failing run.
// The JSON report carries the same data in machine-readable form, plus the reverse-complement control.

import * as fs from 'fs';

import { designSetProblems, writeReportFilesAtomically } from '../support/report-output';
import { sha256Text } from '../support/content-hash';
import {
	APPROVED_CADNANO,
	EXPECTED_GENERATOR_VERSION,
	EXPECTED_SEQUENCE_SOURCE,
} from './provenance-contract';
import {
	type ColorAgreement,
	type DesignResult,
	type DifferenceKind,
	type PhysicalControl,
} from './comparison';
import {
	designNames,
	EXPECTED_DESIGN_COUNT,
	MAX_EXAMPLES,
	PROVENANCE_FILE,
	provenance,
	type Provenance,
	REFERENCE_DIR,
	REPORT_JSON,
	REPORT_MARKDOWN,
	SCAFFOLD_DIR,
} from './fixtures';

/** Small square-lattice design used by the self-checks and the physical control's scaffold. */
export const PROBE_DESIGN = '8hb_2ab_8f';

/** Guards the `Oligo.sequence()` defect: 28 real bases dropped after a 17 nt unsequenced run. */
export const PINNED_SEQUENCES: Record<string, Record<string, string>> = {
	'17. Krishnan_NatCommun2016_pin pore': {
		'18[212] → 1[195]': 'NNNNNNNNNNNNNNNNNAGGAGTTAATGTTGCAAATCCCCATTCT',
		'9[196] → 2[168]': 'NNNNNNNNNNNNNNNNNGTACGGTATGAAGATGCAGATCCGGTGT',
	},
};

/* ------------------------------------------------------------------ *
 * Reference contract (the provenance is well-formed and matches disk)
 * ------------------------------------------------------------------ */

/** One definition for the tests and the report guard; separate copies drifted apart once. */
export function referenceContractProblems(prov: Provenance = provenance): string[] {
	const problems: string[] = [];

	if (prov.generatorVersion !== EXPECTED_GENERATOR_VERSION) {
		problems.push(
			`generator version ${prov.generatorVersion}, expected ${EXPECTED_GENERATOR_VERSION}`
		);
	}
	// Exact, not a substring: "not sequenceExport" would satisfy a contains check.
	if (prov.sequenceSource !== EXPECTED_SEQUENCE_SOURCE) {
		problems.push(
			`sequence source is ${JSON.stringify(prov.sequenceSource)}, expected ${JSON.stringify(EXPECTED_SEQUENCE_SOURCE)}`
		);
	}
	if (prov.unsequencedMarker !== '?') {
		problems.push(`unsequenced marker is ${JSON.stringify(prov.unsequencedMarker)}, expected "?"`);
	}
	if (prov.cadnano.version !== APPROVED_CADNANO.version) {
		problems.push(`cadnano version ${prov.cadnano.version}`);
	}
	if (prov.cadnano.commit !== APPROVED_CADNANO.commit) {
		problems.push(`cadnano commit ${prov.cadnano.commit}`);
	}
	// Exactly the two documented compatibility patches, and nothing else.
	const approvedFiles = Object.keys(APPROVED_CADNANO.modifiedFileSha256);
	const modified = prov.cadnano.modifiedFiles ?? [];
	if (modified.length !== approvedFiles.length || modified.some((f, i) => f !== approvedFiles[i])) {
		problems.push(`cadnano modified files are ${JSON.stringify(modified)}`);
	}
	for (const [file, digest] of Object.entries(APPROVED_CADNANO.modifiedFileSha256)) {
		if (prov.cadnano.modifiedFileSha256?.[file] !== digest) {
			problems.push(`cadnano ${file} is not the approved content`);
		}
	}
	if (sha256Text(`${SCAFFOLD_DIR}/scaf8634.txt`) !== prov.scaffoldSha256) {
		problems.push('the scaffold does not match the hash recorded in the provenance');
	}

	// Designs, fixtures and provenance must describe exactly the same set, in both directions, so a
	// stale fixture left by a removed design is rejected rather than silently ignored.
	if (designNames.length !== EXPECTED_DESIGN_COUNT) {
		problems.push(`${designNames.length} designs on disk, expected ${EXPECTED_DESIGN_COUNT}`);
	}
	const entries = fs.readdirSync(REFERENCE_DIR);
	const fixtures = entries
		.filter((file) => file.endsWith('.csv'))
		.map((file) => file.slice(0, -'.csv'.length))
		.sort();
	const recorded = Object.keys(prov.designs).sort();
	if (fixtures.length !== designNames.length || fixtures.some((f, i) => f !== designNames[i])) {
		problems.push('reference CSVs do not match the set of published designs');
	}
	if (recorded.length !== designNames.length || recorded.some((d, i) => d !== designNames[i])) {
		problems.push('provenance entries do not match the set of published designs');
	}
	const stray = entries.filter((file) => !file.endsWith('.csv') && file !== PROVENANCE_FILE);
	if (stray.length > 0) problems.push(`unexpected files in cadnano_ref: ${stray.join(', ')}`);

	return problems;
}

/* ------------------------------------------------------------------ *
 * Report guard
 * ------------------------------------------------------------------ */

/**
 * Every condition a design must meet, shared by the per-design test and the report guard so
 * the two can never enforce different things.
 */
export function designProblems(result: DesignResult): string[] {
	const problems: string[] = [];
	const say = (message: string) => problems.push(`${result.design}: ${message}`);

	if (result.error) {
		say(result.error);
		return problems;
	}

	if (result.verdict !== 'exact') say(`verdict ${result.verdict}`);
	if (result.referenceOligos !== result.generatedOligos) {
		say(`${result.referenceOligos} reference oligos against ${result.generatedOligos} generated`);
	}
	if (result.exactMatches !== result.referenceOligos) {
		say(`${result.referenceOligos - result.exactMatches} oligo(s) did not match exactly`);
	}
	if (result.differences.length > 0) say(`${result.differences.length} sequence difference(s)`);
	if (result.unmatchedReferenceRoutes.length > 0 || result.unmatchedGeneratedRoutes.length > 0) {
		say('routes left unmatched on one side');
	}
	if (result.fillMissing !== 0) say(`${result.fillMissing} route position(s) had no scaffold base`);
	if (result.circularExcluded !== 0) {
		say(`${result.circularExcluded} circular oligo(s) excluded from the comparison`);
	}
	if (result.exporterAgrees !== true) {
		say(
			`the shipped CSV exporter did not reproduce these rows — ${result.exporterError ?? 'rows differ'}`
		);
	}
	if (!result.modificationsEmpty) say('modification columns were not empty');
	if (result.colors.unexplained.length > 0) {
		say(`${result.colors.unexplained.length} colour disagreement(s) left unexplained`);
	}

	return problems;
}

/** Per-design work completes even when the build checks fail, so this guard must be explicit. */
export function assertReportable(results: DesignResult[], physical: PhysicalControl): void {
	const problems = [
		...referenceContractProblems(),
		...designSetProblems(
			results.map((result) => result.design),
			designNames
		),
		...results.flatMap(designProblems),
	];

	if (physical.real[14] / physical.stretches <= 0.5) {
		problems.push('physical control below threshold');
	}
	if (physical.shuffled[14] / physical.stretches >= 0.05) {
		problems.push('physical control too noisy');
	}

	if (problems.length > 0) {
		throw new Error(
			`refusing to write the reports from a failing run:\n  ${problems.join('\n  ')}`
		);
	}
}

/* ------------------------------------------------------------------ *
 * JSON report
 * ------------------------------------------------------------------ */

export function makeJson(results: DesignResult[], physical: PhysicalControl): string {
	return `${JSON.stringify({ physical, designs: results }, null, 2)}\n`;
}

/* ------------------------------------------------------------------ *
 * Markdown rendering
 * ------------------------------------------------------------------ */

const DIFFERENCE_LABELS: Record<DifferenceKind, string> = {
	referenceUnsequenced: 'cadnano left the position unsequenced, Foldnano supplied a base',
	generatedUnsequenced: 'Foldnano left the position unsequenced, cadnano supplied a base',
	baseMismatch: 'the two implementations disagree on a base',
	lengthMismatch: 'the lengths disagree',
};

function percentage(part: number, whole: number): string {
	if (whole === 0) return '0.0%';
	return `${((100 * part) / whole).toFixed(1)}%`;
}

function countKinds(results: DesignResult[], kind: DifferenceKind): number {
	return results.reduce(
		(sum, result) => sum + result.differences.filter((d) => d.kind === kind).length,
		0
	);
}

export function makeMarkdown(results: DesignResult[], physical: PhysicalControl): string {
	const exact = results.filter((result) => result.verdict === 'exact').length;
	const totalReference = results.reduce((sum, r) => sum + r.referenceOligos, 0);
	const totalExact = results.reduce((sum, r) => sum + r.exactMatches, 0);
	const totalNt = results.reduce((sum, r) => sum + r.oligoNt, 0);
	const totalUnsequenced = results.reduce((sum, r) => sum + r.unsequencedNt, 0);
	const totalScafSlotOligos = results.reduce((sum, r) => sum + r.scafSlotOligos, 0);
	const routeLengths = results.map((r) => r.scaffoldRouteLength);

	const lines: string[] = [
		'# Sequence comparison: Foldnano vs cadnano 2.5',
		'',
		'## Method',
		'',
		'Each design in `test_files/published_cadnano_designs/` is read by cadnano 2.5 and by Foldnano,',
		`and both are given the same test scaffold, \`scaf8634\` (it covers every route in the corpus,`,
		`${Math.min(...routeLengths)}–${Math.max(...routeLengths)} nt). cadnano exports sequences with \`Oligo.sequenceExport\`, the method behind its own`,
		'sequence export (`scripts/gen_reference_sequences.py`); Foldnano generates them from its own',
		'topology. Neither side reads the other.',
		'',
		`cadnano ${provenance.cadnano.version}` +
			(provenance.cadnano.commit ? ` (commit \`${provenance.cadnano.commit.slice(0, 12)}\`)` : '') +
			`, Python ${provenance.python}, with two compatibility patches`,
		`(\`${(provenance.cadnano.modifiedFiles ?? []).join('`, `')}\`). The scaffold, every design and every reference`,
		'CSV are hashed into `_provenance.json` and verified on each run.',
		'',
		`- **Compared set:** \`${provenance.inclusionRule}\`. The scaffold is the input, so it is excluded`,
		'  on both sides; neither file format marks the scaffold reliably, so the longest oligo is used.',
		'- **Identity:** an oligo matches only when its 5′ endpoint, 3′ endpoint, length and sequence all',
		'  agree. Matching is one-to-one and checked in both directions.',
		'- **Normalised before comparison:** row order, the unsequenced marker (`?` vs `N`), the',
		'  scaffold row, Foldnano’s modification columns (empty for this corpus, which is checked), and',
		'  colour (Foldnano generates colours the file does not record). Circular scaffold routes are',
		'  opened at the same crossover on both sides.',
		'',
		'## Results',
		'',
		`- Designs compared: ${results.length}/${EXPECTED_DESIGN_COUNT}.`,
		`- **Designs in exact agreement on every oligo: ${exact}/${results.length}.**`,
		`- Oligos matched exactly: ${totalExact}/${totalReference} (${percentage(totalExact, totalReference)}).`,
		`- Base disagreements: ${countKinds(results, 'baseMismatch')}. Length disagreements: ${countKinds(results, 'lengthMismatch')}.`,
		`- Reference oligos with no generated counterpart: ${results.reduce((sum, r) => sum + r.unmatchedReferenceRoutes.length, 0)}.`,
		`- Generated oligos with no reference counterpart: ${results.reduce((sum, r) => sum + r.unmatchedGeneratedRoutes.length, 0)}.`,
		`- Nucleotides compared: ${totalNt}, of which ${totalUnsequenced} (${percentage(totalUnsequenced, totalNt)}) have no scaffold base opposite and are`,
		'  unsequenced in both outputs, at the same positions.',
		`- Designs where the shipped CSV exporter reproduces the compared rows: ${results.filter((r) => r.exporterAgrees === true).length}/${results.length}.`,
		'',
		'## Per-design summary',
		'',
		'| Design | Scaffold route (nt) | Oligos cadnano / Foldnano | Exact matches | Compared nt | Unsequenced nt | Verdict |',
		'|---|---|---|---|---|---|---|',
	];

	for (const result of results) {
		const route = `${result.scaffoldRouteLength}${result.scaffoldCircular ? ' (circular)' : ''}`;
		lines.push(
			`| ${result.design} | ${route} | ${result.referenceOligos}/${result.generatedOligos} | ${result.exactMatches} | ${result.oligoNt} | ${result.unsequencedNt} (${percentage(result.unsequencedNt, result.oligoNt)}) | ${result.verdict} |`
		);
	}

	lines.push(
		'',
		'## Reverse-complement control',
		'',
		'A sanity check that the reference sequences are scaffold-derived: the share of sequenced',
		'stretches containing a reverse-complement match to the scaffold, against the same stretches',
		`shuffled with a fixed seed (\`${physical.seed}\`).`,
		'',
		'| Longest reverse-complement match | Real | Shuffled |',
		'|---|---|---|'
	);
	for (const k of Object.keys(physical.real)
		.map(Number)
		.sort((a, b) => a - b)) {
		lines.push(
			`| ≥ ${k} nt | ${percentage(physical.real[k], physical.stretches)} | ${percentage(physical.shuffled[k], physical.stretches)} |`
		);
	}
	lines.push(
		'',
		'## Known limitations',
		'',
		'- The scaffold itself is not compared: it is the input on both sides, and is checked only',
		'  through the oligos derived from it.',
		`- The compared set is oligos, not staples: it includes ${totalScafSlotOligos} short oligos routed through cadnano’s \`scaf\` slot.`,
		'',
		'## Provenance',
		'',
		'Generated by `src/lib/model/test/sequence-comparison.spec.ts`. Regenerate with:',
		'',
		'```bash',
		'UPDATE_SEQUENCE_REPORT=1 pnpm vitest run src/lib/model/test/sequence-comparison.spec.ts',
		'```',
		'',
		'## Detailed results',
		''
	);

	for (const result of results) {
		lines.push(`### ${result.design}`, '');
		if (result.error) {
			lines.push(`Verdict: **failed** — ${result.error}`, '');
			continue;
		}
		const linearised = result.linearizedAt
			? ` (circular; linearised at vh${result.linearizedAt.from.vh}[${result.linearizedAt.from.bp}] → vh${result.linearizedAt.to.vh}[${result.linearizedAt.to.bp}])`
			: '';
		lines.push(
			`Verdict: **${result.verdict}**`,
			'',
			`- Scaffold: \`${result.scaffoldFile}\` applied to a ${result.scaffoldRouteLength} nt route${linearised}`,
			`- Scaffold bases left over after filling the route: ${result.fillLeftover}; route positions left unfilled: ${result.fillMissing}`,
			`- Oligos: ${result.referenceOligos} reference, ${result.generatedOligos} generated${result.circularExcluded > 0 ? `, ${result.circularExcluded} circular excluded on both sides` : ''}`,
			`- Exact four-field matches: ${result.exactMatches}`,
			`- Unsequenced nucleotides: ${result.unsequencedNt} of ${result.oligoNt}, identical on both sides`,
			`- Reference oligos with no generated counterpart: ${result.unmatchedReferenceRoutes.length}`,
			`- Generated oligos with no reference counterpart: ${result.unmatchedGeneratedRoutes.length}`,
			`- Colour: ${result.colors.matched} identical, ${result.colors.generated} generated by Foldnano because the source file records none`,
			`- Shipped CSV exporter reproduces these rows: ${result.exporterAgrees === true ? 'yes' : `no — ${result.exporterError ?? 'rows differ'}`}`
		);

		if (result.differences.length > 0) {
			const kinds = new Map<DifferenceKind, number>();
			for (const difference of result.differences) {
				kinds.set(difference.kind, (kinds.get(difference.kind) ?? 0) + 1);
			}
			lines.push('', '| Difference | Count | Meaning |', '|---|---:|---|');
			for (const [kind, count] of kinds) {
				lines.push(`| \`${kind}\` | ${count} | ${DIFFERENCE_LABELS[kind]} |`);
			}
			lines.push('', 'Examples:', '');
			for (const difference of result.differences.slice(0, MAX_EXAMPLES)) {
				lines.push(
					`- \`${difference.route}\` — ${difference.kind}, ${difference.differingPositions} position(s) differ` +
						` (lengths ${difference.referenceLength}/${difference.generatedLength})`,
					`  - cadnano:  \`${difference.referenceExcerpt}\``,
					`  - Foldnano: \`${difference.generatedExcerpt}\``
				);
			}
			if (result.differences.length > MAX_EXAMPLES) {
				lines.push(`- … and ${result.differences.length - MAX_EXAMPLES} more`);
			}
		}

		for (const [label, routes] of [
			['Reference oligos with no generated counterpart', result.unmatchedReferenceRoutes],
			['Generated oligos with no reference counterpart', result.unmatchedGeneratedRoutes],
		] as const) {
			if (routes.length === 0) continue;
			lines.push('', `${label}:`, '');
			for (const route of routes.slice(0, MAX_EXAMPLES)) lines.push(`- \`${route}\``);
			if (routes.length > MAX_EXAMPLES) lines.push(`- … and ${routes.length - MAX_EXAMPLES} more`);
		}

		lines.push('');
	}

	return `${lines.join('\n').trimEnd()}\n`;
}

/** One line, not the whole report: printing 20 kB on every run buried the rest of the suite output. */
export function runSummaryLine(results: DesignResult[]): string {
	const oligos = results.reduce((sum, result) => sum + result.referenceOligos, 0);
	const matched = results.reduce((sum, result) => sum + result.exactMatches, 0);
	const nt = results.reduce((sum, result) => sum + result.oligoNt, 0);
	return `sequence comparison: ${results.length} designs, ${matched}/${oligos} oligos exact, ${nt} nt compared`;
}

export function writeReports(results: DesignResult[], physical: PhysicalControl): void {
	assertReportable(results, physical);
	writeReportFilesAtomically([
		{ path: REPORT_JSON, contents: makeJson(results, physical) },
		{ path: REPORT_MARKDOWN, contents: makeMarkdown(results, physical) },
	]);
}

// Re-exported so the spec can build fully typed guard fixtures without importing ./comparison twice.
export type { ColorAgreement };
