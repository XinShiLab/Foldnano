// Renders the two committed round-trip reports and refuses to write them from a failing run.
// The JSON report is a machine-readable summary: the classified outcome per design plus the source
// hash it was produced from, which is what makes a stale report detectable.

import * as fs from 'fs';
import * as path from 'path';

import {
	byCodeUnit,
	designSetProblems,
	writeReportFilesAtomically,
} from '../support/report-output';
import {
	type CadnanoScopeAgreement,
	type ColorMappingChange,
	describeOriginalCadnanoDifference,
	type DeletionRelocation,
	DESIGNS_DIR,
	type DesignResult,
	type JsonComparison,
	MAX_EXAMPLES,
	type OriginalCadnanoDifference,
	type OriginalCadnanoPreservationReport,
	type PartComparison,
} from './comparison';
import { jsonValue, structurallyEqual } from './validation';

export const REPORT_DIR = path.resolve('test_files/fixtures/cadnano_roundtrip');
export const REPORT_JSON = path.join(REPORT_DIR, 'cadnano-roundtrip-report.json');
export const REPORT_MARKDOWN = path.join(REPORT_DIR, 'cadnano-roundtrip-report.md');
export const EXPECTED_DESIGN_COUNT = 10;

/** The actual corpus on disk, so the report guard checks against real designs, not a count. */
export const EXPECTED_DESIGN_NAMES = fs
	.readdirSync(DESIGNS_DIR)
	.filter((file) => file.endsWith('.json'))
	.sort();

/** The reviewed baseline: the only lossy conversions this corpus is known to produce. */
export const EXPECTED_DELETION_RELOCATIONS: Record<string, DeletionRelocation[]> = {
	'4FSF_25_2b_complete_full_loopbackscaffold.json': [
		{ vstrand: 10, fromBase: 68, toBase: 67 },
		{ vstrand: 11, fromBase: 68, toBase: 67 },
		{ vstrand: 34, fromBase: 68, toBase: 67 },
		{ vstrand: 35, fromBase: 68, toBase: 67 },
		{ vstrand: 58, fromBase: 68, toBase: 67 },
		{ vstrand: 59, fromBase: 68, toBase: 67 },
		{ vstrand: 82, fromBase: 68, toBase: 67 },
		{ vstrand: 83, fromBase: 68, toBase: 67 },
	],
	'righthanded_turbine_only.json': [{ vstrand: 48, fromBase: 385, toBase: 386 }],
};

/* ------------------------------------------------------------------ *
 * Report guard
 * ------------------------------------------------------------------ */

/**
 * Every condition a design must meet, in one place, so the per-design test and the publication
 * guard can never enforce different things.
 */
export function designProblems(result: DesignResult): string[] {
	const problems: string[] = [];
	const say = (message: string) => problems.push(`${result.design}: ${message}`);

	if (result.error) {
		say(`${result.error.stage} — ${result.error.message}`);
		return problems;
	}

	for (const problem of result.documentProblems) say(problem);

	const preservation = result.originalCadnanoPreservation;
	if (!preservation) {
		say('no cadnano preservation report');
	} else {
		for (const difference of preservation.unexpectedDifferences) {
			say(`unclassified in-scope difference — ${describeOriginalCadnanoDifference(difference)}`);
		}
		const expected = EXPECTED_DELETION_RELOCATIONS[result.design] ?? [];
		if (!structurallyEqual(preservation.deletionRelocations, expected)) {
			say(
				`deletion relocations ${jsonValue(preservation.deletionRelocations)} ` +
					`do not match the reviewed baseline ${jsonValue(expected)}`
			);
		}
		if (preservation.agreement.exactInScopeAgreement !== (expected.length === 0)) {
			say('the exact-agreement verdict does not match the reviewed baseline');
		}
	}

	if (!result.J0J1) say('no J0–J1 comparison, which is the primary result');

	if (!result.P1P2) say('no P1–P2 comparison');
	else if (result.P1P2.designAndColorChanges !== 0) {
		say(`${result.P1P2.designAndColorChanges} Part change(s) on the first re-import`);
	}

	if (!result.J1J2) say('no J1–J2 comparison');
	else if (!result.J1J2.structurallyEqual) say('the next export introduces recurring differences');

	if (!result.P2P3) say('no P2–P3 comparison');
	else if (result.P2P3.designAndColorChanges !== 0) {
		say(`${result.P2P3.designAndColorChanges} Part change(s) on the second round trip`);
	}

	if (result.sourceSha256.length !== 64) say('no source hash, so staleness cannot be detected');

	return problems;
}

/** Per-design work completes even when a design errored, so this guard must be explicit. */
export function assertReportable(results: DesignResult[]): void {
	const problems = [
		...designSetProblems(
			results.map((result) => result.design),
			EXPECTED_DESIGN_NAMES
		),
		...results.flatMap(designProblems),
	];

	if (problems.length > 0) {
		throw new Error(
			`refusing to write the reports from a failing run:\n  ${problems.join('\n  ')}`
		);
	}
}

/* ------------------------------------------------------------------ *
 * JSON summary
 * ------------------------------------------------------------------ */

interface DesignAudit {
	design: string;
	sourceSha256: string;
	verdict: string;
	error: { stage: string; message: string } | null;
	documentProblems: string[];
	importWarnings: { J0: string[]; J1: string[]; J2: string[] };
	agreement: CadnanoScopeAgreement | null;
	unexpectedDifferences: OriginalCadnanoDifference[];
	deletionRelocations: DeletionRelocation[];
	representationOnlyChanges: number;
	generatedMetadataChanges: number;
	warnedLossySkipEntries: number;
	scaffoldColorsInvented: number;
	vstrandsReordered: number;
	colorOrderVstrands: number;
	firstReimportPartChanges: number | null;
	nextExportStructurallyEqual: boolean | null;
	secondRoundTripPartChanges: number | null;
}

function colorOrderVstrands(comparison: JsonComparison | null): number {
	return (comparison?.colorOrderOnly ?? []).reduce((sum, item) => sum + item.count, 0);
}

function auditRecord(result: DesignResult): DesignAudit {
	const preservation = result.originalCadnanoPreservation;
	return {
		design: result.design,
		sourceSha256: result.sourceSha256,
		verdict: result.verdict,
		error: result.error,
		documentProblems: result.documentProblems,
		importWarnings: result.warnings,
		agreement: preservation?.agreement ?? null,
		unexpectedDifferences: preservation?.unexpectedDifferences ?? [],
		deletionRelocations: preservation?.deletionRelocations ?? [],
		representationOnlyChanges: preservation?.representationOnlyChanges.length ?? 0,
		generatedMetadataChanges: preservation?.generatedMetadataChanges.length ?? 0,
		warnedLossySkipEntries: preservation?.warnedLossyDifferences.length ?? 0,
		scaffoldColorsInvented: preservation?.scaffoldColorsInvented ?? 0,
		vstrandsReordered: result.J0J1?.vstrandOrder.movedCount ?? 0,
		colorOrderVstrands: colorOrderVstrands(result.J0J1),
		firstReimportPartChanges: result.P1P2?.designAndColorChanges ?? null,
		nextExportStructurallyEqual: result.J1J2?.structurallyEqual ?? null,
		secondRoundTripPartChanges: result.P2P3?.designAndColorChanges ?? null,
	};
}

export function makeReportJson(results: DesignResult[]): string {
	const summary = {
		designs: results.length,
		exactInScopeAgreement: results.filter(
			(result) => result.originalCadnanoPreservation?.agreement.exactInScopeAgreement
		).length,
		unexpectedDifferences: results.reduce(
			(sum, result) =>
				sum + (result.originalCadnanoPreservation?.unexpectedDifferences.length ?? 0),
			0
		),
		warnedDeletionRelocations: results.reduce(
			(sum, result) => sum + (result.originalCadnanoPreservation?.deletionRelocations.length ?? 0),
			0
		),
	};
	const payload = { summary, designs: results.map(auditRecord) };
	return `${JSON.stringify(payload, null, 2)}\n`;
}

/* ------------------------------------------------------------------ *
 * Markdown rendering
 * ------------------------------------------------------------------ */

function markdownCell(value: string): string {
	return value.replaceAll('|', '\\|').replaceAll('\n', '<br>');
}

function listNumbers(values: number[]): string {
	if (values.length === 0) return 'none';
	const sorted = [...new Set(values)].sort((a, b) => a - b);
	const ranges: string[] = [];
	let start = sorted[0];
	let previous = sorted[0];
	for (const value of sorted.slice(1)) {
		if (value === previous + 1) {
			previous = value;
			continue;
		}
		ranges.push(start === previous ? String(start) : `${start}–${previous}`);
		start = value;
		previous = value;
	}
	ranges.push(start === previous ? String(start) : `${start}–${previous}`);
	return ranges.join(', ');
}

function hexColor(value: number): string {
	return `0x${value.toString(16).toUpperCase().padStart(6, '0')}`;
}

/** Collapse per-VH colour churn into one line per (field, direction, colour). */
function summarizeColorMappings(changes: ColorMappingChange[]): string[] {
	interface ColorGroup {
		field: string;
		kind: 'Added' | 'Removed';
		color: number;
		vstrands: Set<number>;
	}
	const groups = new Map<string, ColorGroup>();
	for (const change of changes) {
		for (const [kind, pairs] of [
			['Added', change.added],
			['Removed', change.removed],
		] as const) {
			for (const [, color] of pairs) {
				const key = `${change.field}|${kind}|${color}`;
				const group = groups.get(key) ?? {
					field: change.field,
					kind,
					color,
					vstrands: new Set<number>(),
				};
				group.vstrands.add(change.vstrand);
				groups.set(key, group);
			}
		}
	}
	return [...groups.values()]
		.sort((a, b) => b.vstrands.size - a.vstrands.size || byCodeUnit(a.field, b.field))
		.map((group) => {
			const note =
				group.field === 'scaf_colors' && group.kind === 'Added'
					? ' (scaffold colour generated at import)'
					: '';
			return `- ${group.kind} \`${group.field}\` entries with colour \`${hexColor(group.color)}\` on ${group.vstrands.size} vstrands: ${listNumbers([...group.vstrands])}${note}`;
		});
}

function yesNo(value: boolean): string {
	return value ? 'yes' : 'no';
}

function originalCadnanoPreservationDetails(report: OriginalCadnanoPreservationReport): string[] {
	const lines = ['#### Cadnano interchange data — J0 vs J1', ''];
	lines.push(
		`- All compared data identical after ignoring presentation differences: ${yesNo(report.allComparedDataEqual)}`
	);
	lines.push(
		`- In-scope agreement: virtual-helix geometry ${yesNo(report.agreement.virtualHelixGeometry)}; ` +
			`strand/crossover topology ${yesNo(report.agreement.strandAndCrossoverTopology)}; ` +
			`loops ${yesNo(report.agreement.loops)}; skips exactly ${yesNo(report.agreement.skipsExactly)}; ` +
			`source colours ${yesNo(report.agreement.sourceColors)}`
	);
	lines.push(`- **Unexpected differences: ${report.unexpectedDifferences.length}**`);
	lines.push(
		`- Classified changes: ${report.representationOnlyChanges.length} representation-only; ` +
			`${report.generatedMetadataChanges.length} generated metadata; ` +
			`${report.deletionRelocations.length} warned lossy deletion relocations ` +
			`(${report.warnedLossyDifferences.length} changed skip entries)`
	);
	for (const move of report.deletionRelocations.slice(0, MAX_EXAMPLES)) {
		lines.push(
			`- Warned deletion relocation: VH ${move.vstrand}, bp ${move.fromBase} → ${move.toBase}`
		);
	}
	for (const difference of report.unexpectedDifferences.slice(0, MAX_EXAMPLES)) {
		lines.push(`- UNEXPECTED ${describeOriginalCadnanoDifference(difference)}`);
	}
	lines.push('');
	return lines;
}

function comparisonDetails(comparison: JsonComparison): string[] {
	const lines: string[] = [];
	lines.push(`#### ${comparison.label} — Raw JSON differences`);
	lines.push('');
	lines.push(
		`- Structurally equal (ignoring object-key order): ${yesNo(comparison.structurallyEqual)}`
	);
	if (comparison.vstrandOrder.changed) {
		lines.push(
			`- Vstrand order changed: ${comparison.vstrandOrder.movedCount} moved; same number set: ${yesNo(comparison.vstrandOrder.sameNumbers)}; output ascending: ${yesNo(comparison.vstrandOrder.afterIsAscending)} (presentation only)`
		);
	}
	for (const item of comparison.renamedFields) {
		lines.push(
			`- Renamed field \`${item.field}\` on ${item.count} vstrands: ${listNumbers(item.vstrands)} (schema-spelling normalization)`
		);
	}
	for (const item of comparison.addedFields) {
		const classification =
			item.field === 'segments' || item.field === 'warnings'
				? 'non-cadnano field emitted by the exporter'
				: item.field === 'scaf_colors'
					? 'scaffold colour generated at import'
					: 'schema addition';
		lines.push(
			`- Added field \`${item.field}\` on ${item.count} vstrands: ${listNumbers(item.vstrands)} (${classification})`
		);
	}
	for (const item of comparison.removedFields) {
		lines.push(
			`- Removed field \`${item.field}\` on ${item.count} vstrands: ${listNumbers(item.vstrands)}`
		);
	}
	for (const item of comparison.colorOrderOnly) {
		lines.push(
			`- Reordered \`${item.field}\` without mapping changes on ${item.count} vstrands: ${listNumbers(item.vstrands)} (ordering only)`
		);
	}
	lines.push(...summarizeColorMappings(comparison.colorMappingChanges));
	for (const change of comparison.arrayLengthChanges) {
		lines.push(
			`- Changed \`${change.field}\` array length on ${change.vstrands.length} vstrands; example ${change.examples[0]?.path}: ${jsonValue(change.examples[0]?.before)} → ${jsonValue(change.examples[0]?.after)}`
		);
	}
	if (comparison.tupleChanges.length > 0) {
		lines.push('');
		lines.push(
			'| Connection field | Pattern | Count | Vstrands | Repeated occurrences | Examples |'
		);
		lines.push('|---|---|---:|---|---|---|');
		for (const group of comparison.tupleChanges) {
			const examples = group.examples
				.map(
					(example) => `${example.path}: ${jsonValue(example.before)} → ${jsonValue(example.after)}`
				)
				.join('<br>');
			const repeated = group.countsByVstrand
				.filter((item) => item.count > 1)
				.map((item) => `VH ${item.vstrand}: ${item.count}`)
				.join(', ');
			lines.push(
				`| ${group.field} | ${markdownCell(group.signature)} | ${group.count} | ${listNumbers(group.vstrands)} | ${repeated || '1 each'} | ${markdownCell(examples)} |`
			);
		}
	}
	if (comparison.numericArrayChanges.length > 0) {
		lines.push('');
		lines.push('| Numeric field | Change | Count | Vstrands | Examples |');
		lines.push('|---|---|---:|---|---|');
		for (const group of comparison.numericArrayChanges) {
			lines.push(
				`| ${group.field} | ${markdownCell(group.signature)} | ${group.count} | ${listNumbers(group.vstrands)} | ${markdownCell(group.examples.map((example) => example.path).join(', '))} |`
			);
		}
	}
	if (comparison.scalarChanges.length > 0) {
		lines.push('');
		lines.push('| Scalar/structural field | Change | Count | Vstrands |');
		lines.push('|---|---|---:|---|');
		for (const group of comparison.scalarChanges) {
			lines.push(
				`| ${group.field} | ${markdownCell(group.signature)} | ${group.count} | ${listNumbers(group.vstrands)} |`
			);
		}
	}
	if (comparison.keyOrderChanges.length > 0) {
		lines.push('');
		lines.push(
			`- Object-key ordering changed in ${comparison.keyOrderChanges.reduce((sum, group) => sum + group.count, 0)} vstrands across ${comparison.keyOrderChanges.length} ordering patterns (presentation only).`
		);
	}
	lines.push('');
	return lines;
}

function partDetails(comparison: PartComparison): string[] {
	const lines = [
		`#### ${comparison.label}`,
		'',
		`- Vstrand presentation order changed: ${comparison.vstrandOrderChanged ? `yes (${comparison.movedVstrandCount} moved)` : 'no'}`,
		`- Out-of-scope name/region metadata changes: ${comparison.metadataChanges}`,
		`- Virtual-helix geometry changes: ${comparison.virtualHelixChanges}`,
		`- Segments added/removed/modified: ${comparison.segmentsAdded}/${comparison.segmentsRemoved}/${comparison.segmentsModified}`,
		`- Crossovers added/removed: ${comparison.crossoversAdded}/${comparison.crossoversRemoved}`,
		`- Oligos added/removed/modified: ${comparison.oligosAdded}/${comparison.oligosRemoved}/${comparison.oligosModified}`,
		`- Oligo color changes: ${comparison.colorChanges}`,
		`- Total in-scope Foldnano topology changes: ${comparison.foldnanoPartChanges}`,
	];
	for (const example of comparison.examples) lines.push(`- Example: ${example}`);
	lines.push('');
	return lines;
}

function representationSummary(result: DesignResult): string {
	if (!result.J0J1 || !result.originalCadnanoPreservation) return '-';
	const items: string[] = [];
	if (result.J0J1.vstrandOrder.movedCount > 0)
		items.push(`${result.J0J1.vstrandOrder.movedCount} VH positions moved`);
	if (result.originalCadnanoPreservation.selfReferentialExits > 0)
		items.push(
			`${result.originalCadnanoPreservation.selfReferentialExits} connection records rewritten`
		);
	const colorOrder = colorOrderVstrands(result.J0J1);
	if (colorOrder > 0) items.push(`${colorOrder} colour-order VH occurrences`);
	if (
		result.J0J1.topLevelKeyOrderChanged ||
		result.J0J1.keyOrderChanges.length > 0 ||
		result.J0J1.renamedFields.length > 0
	)
		items.push('key/spelling normalization');
	return items.length > 0 ? items.join('; ') : 'none';
}

function generatedMetadataSummary(report: OriginalCadnanoPreservationReport): string {
	return report.scaffoldColorsInvented > 0
		? `${report.scaffoldColorsInvented} scaffold colour entries added`
		: 'none';
}

function deletionRelocationSummary(report: OriginalCadnanoPreservationReport): string {
	if (report.deletionRelocations.length === 0) return 'none';
	const places = report.deletionRelocations
		.map((move) => `VH ${move.vstrand}: ${move.fromBase}→${move.toBase}`)
		.join(', ');
	return `${report.deletionRelocations.length} deletion(s): ${places}`;
}

function classifiedDifferenceSummary(result: DesignResult): string {
	if (!result.J0J1 || !result.originalCadnanoPreservation) return '-';
	const items: string[] = [];
	if (result.J0J1.vstrandOrder.movedCount > 0) {
		items.push(`${result.J0J1.vstrandOrder.movedCount} VH positions reordered`);
	}
	if (result.originalCadnanoPreservation.selfReferentialExits > 0) {
		items.push(
			`${result.originalCadnanoPreservation.selfReferentialExits} equivalent scaffold-tuple rewrites`
		);
	}
	const colorOrder = colorOrderVstrands(result.J0J1);
	if (colorOrder > 0) items.push(`${colorOrder} staple-colour order changes`);
	if (result.originalCadnanoPreservation.scaffoldColorsInvented > 0) {
		const count = result.originalCadnanoPreservation.scaffoldColorsInvented;
		items.push(`${count} scaffold ${count === 1 ? 'colour' : 'colours'} added`);
	}
	if (result.originalCadnanoPreservation.deletionRelocations.length > 0) {
		const count = result.originalCadnanoPreservation.deletionRelocations.length;
		items.push(`${count} warned deletion ${count === 1 ? 'relocation' : 'relocations'}`);
	}
	return items.length > 0 ? items.join('; ') : 'none';
}

export function makeMarkdown(results: DesignResult[]): string {
	const completed = results.filter((result) => !result.error).length;
	const countAgreement = (select: (agreement: CadnanoScopeAgreement) => boolean) =>
		results.filter(
			(result) =>
				result.originalCadnanoPreservation && select(result.originalCadnanoPreservation.agreement)
		).length;
	const exactInScopeAgreement = countAgreement((agreement) => agreement.exactInScopeAgreement);
	const virtualHelixAgreement = countAgreement((agreement) => agreement.virtualHelixGeometry);
	const strandTopologyAgreement = countAgreement(
		(agreement) => agreement.strandAndCrossoverTopology
	);
	const loopAgreement = countAgreement((agreement) => agreement.loops);
	const exactSkipAgreement = countAgreement((agreement) => agreement.skipsExactly);
	const sourceColorAgreement = countAgreement((agreement) => agreement.sourceColors);
	const noUnexpectedDifferences = results.filter(
		(result) => result.originalCadnanoPreservation?.unexpectedDifferences.length === 0
	).length;
	const firstRoundTripPartPreserved = results.filter(
		(result) => result.P1P2?.foldnanoPartChanges === 0
	).length;
	const noRecurringJsonDifferences = results.filter(
		(result) => result.J1J2?.structurallyEqual === true
	).length;
	const noRecurringPartDifferences = results.filter(
		(result) => result.P2P3?.designAndColorChanges === 0
	).length;
	const relocationDesigns = results.filter(
		(result) => (result.originalCadnanoPreservation?.deletionRelocations.length ?? 0) > 0
	);
	const relocatedDeletions = relocationDesigns.reduce(
		(sum, result) => sum + (result.originalCadnanoPreservation?.deletionRelocations.length ?? 0),
		0
	);

	const lines = [
		'# Cadnano round-trip verification',
		'',
		'## Method',
		'',
		'Pipeline: `J0 → P1 → J1 → P2 → J2 → P3` (J = cadnano document, P = Foldnano Part). Each design',
		'in `test_files/published_cadnano_designs` is imported, exported, and re-imported twice, and',
		'checked for:',
		'',
		'- **Cadnano data (J0 vs J1):** virtual-helix geometry, strands and crossovers, loops, skips and',
		'  source colours, matched by vstrand `num`. Ordering-only changes are reported separately, and',
		'  any field outside the compared set is reported rather than skipped.',
		'- **Foldnano Part (P1 vs P2):** the same Part structure after re-import.',
		'- **Stability (J1 vs J2, P2 vs P3):** no further changes on another cycle.',
		'',
		'cadnano is treated as a topology interchange format, not lossless Foldnano storage: UUIDs,',
		'sequences, modifications, oligo names, region information and freeform orientation are out of',
		'scope.',
		'',
		'## Results',
		'',
		`- Completed all stages: ${completed}/${results.length} designs.`,
		`- **Exact agreement for all in-scope cadnano properties: ${exactInScopeAgreement}/${results.length} designs.**`,
		`- Virtual-helix geometry: ${virtualHelixAgreement}/${results.length}; strand/crossover topology: ${strandTopologyAgreement}/${results.length}; loops: ${loopAgreement}/${results.length}; exact skips: ${exactSkipAgreement}/${results.length}; source colours: ${sourceColorAgreement}/${results.length}.`,
		`- No unexpected in-scope differences: ${noUnexpectedDifferences}/${results.length} designs.`,
		`- Warned lossy discrepancies: ${relocatedDeletions} deletions relocated across ${relocationDesigns.length} designs.`,
		`- Foldnano topology preserved on the first re-import: ${firstRoundTripPartPreserved}/${results.length} designs.`,
		`- No recurring raw JSON differences on the next cycle: ${noRecurringJsonDifferences}/${results.length} designs.`,
		`- No recurring Foldnano design-and-color changes: ${noRecurringPartDifferences}/${results.length} designs.`,
		'',
		'### Classified conversions and discrepancies',
		'',
		'| Category | Change | Interpretation | Cited at |',
		'|---|---|---|---|',
		'| Warned lossy discrepancy | A deletion (`skip`) moves one base off a crossover column | The NT/oxDNA model cannot place a deletion on a pinned crossover anchor. The importer relocates it and emits a user-visible warning, so skips do **not** agree exactly. | `VStrand.relocateSkipsOffCrossovers()` |',
		'| Representation-only | A predecessor `[vh, i, …]` at index `i` becomes `[vh, i±1, …]` | The importer tolerates a self-referential crossover-exit encoding and the exporter writes the regular form. Classified only when the successor is unchanged and the selected neighbour already points forward to this base. | `VStrand.buildSegments()`, and `cadnanoJSON_import.spec.ts` "Hilbert curve design (self-referential crossover exits)" |',
		'| Generated metadata | A `scaf_colors` entry appears where the source had none | An uncoloured scaffold oligo receives a generated colour and the exporter writes it. Classified this way only when its vstrand, base index, and colour exactly match a scaffold oligo independently found in P1; unpredicted additions, duplicates, removals, and replacements remain unexpected. | `Oligo.constructor`, `CadnanoJSON.fromRegion()` |',
		'',
		'### Summary',
		'',
		'| Design | Original cadnano data preserved | Classified J0→J1 differences | Round-trip stability |',
		'|---|---|---|---|',
		`| **Aggregate (${results.length} designs)** | Geometry, routing, loops, and colours: ${virtualHelixAgreement}/${results.length}; exact skips: ${exactSkipAgreement}/${results.length} | ${relocatedDeletions} warned deletion relocations in ${relocationDesigns.length} designs; ${results.length - noUnexpectedDifferences} unexpected differences | P1–P2 preserved: ${firstRoundTripPartPreserved}/${results.length}; no further J1–J2 or P2–P3 changes: ${Math.min(noRecurringJsonDifferences, noRecurringPartDifferences)}/${results.length} |`,
	];

	for (const result of results) {
		if (
			!result.originalCadnanoPreservation ||
			!result.J0J1 ||
			!result.J1J2 ||
			!result.P1P2 ||
			!result.P2P3
		) {
			lines.push(`| ${markdownCell(result.design)} | not completed | - | - |`);
			continue;
		}
		const agreement = result.originalCadnanoPreservation.agreement;
		const preserved = agreement.exactInScopeAgreement ? 'yes' : 'except exact skip positions';
		const stable =
			result.P1P2.foldnanoPartChanges === 0 &&
			result.J1J2.structurallyEqual &&
			result.P2P3.designAndColorChanges === 0;
		lines.push(
			`| ${markdownCell(result.design)} | ${preserved} | ${markdownCell(classifiedDifferenceSummary(result))} | ${yesNo(stable)} |`
		);
	}

	lines.push(
		'',
		'Common to all designs: object/field ordering changed, and the exporter added `scaf_colors`,',
		'`segments`, and `warnings` fields. Exact locations are in the detailed table and per-design',
		'results below.',
		'',
		'### Detailed per-design verification table',
		'',
		'| Design | Completed | VH geometry | Strand/crossover topology | Loops | Skips exact | Source colours | Representation-only changes | Generated metadata | Warned lossy discrepancy | Unexpected | Repeat stable |',
		'|---|---|---|---|---|---|---|---|---|---|---:|---|'
	);

	for (const result of results) {
		if (
			!result.originalCadnanoPreservation ||
			!result.J0J1 ||
			!result.J1J2 ||
			!result.P1P2 ||
			!result.P2P3
		) {
			lines.push(`| ${markdownCell(result.design)} | no | - | - | - | - | - | - | - | - | - | - |`);
			continue;
		}
		const agreement = result.originalCadnanoPreservation.agreement;
		const repeatStable = result.J1J2.structurallyEqual && result.P2P3.designAndColorChanges === 0;
		lines.push(
			`| ${markdownCell(result.design)} | yes | ${yesNo(agreement.virtualHelixGeometry)} | ${yesNo(agreement.strandAndCrossoverTopology)} | ${yesNo(agreement.loops)} | ${yesNo(agreement.skipsExactly)} | ${yesNo(agreement.sourceColors)} | ${markdownCell(representationSummary(result))} | ${markdownCell(generatedMetadataSummary(result.originalCadnanoPreservation))} | ${markdownCell(deletionRelocationSummary(result.originalCadnanoPreservation))} | ${result.originalCadnanoPreservation.unexpectedDifferences.length} | ${yesNo(repeatStable)} |`
		);
	}

	lines.push(
		'',
		'## Known limitations',
		'',
		'1. **The exported scaffold colour is randomly generated.** An oligo with no colour in the source',
		'   gets `generateRandomOKLCHColor()` (`Oligo.constructor`), and `CadnanoJSON.fromRegion()` writes',
		'   every oligo colour into `scaf_colors`, so exporting the same design twice produces two',
		'   different files. Pinned by the "export determinism" test in the spec.',
		'2. **Non-cadnano fields are emitted.** Every exported vstrand carries `segments` and `warnings`.',
		'   `CadnanoJSON.fromRegion()` builds clean objects but wraps them in `VStrand` instances, whose',
		'   public `VStrand.segments` and `VStrand.warnings` fields are picked up by `JSON.stringify`. They',
		'   serialize as empty husks (`"segments":[{},{}]`, `"warnings":[]`), which the suite checks rather',
		'   than assumes, so no design data escapes. It remains a schema-cleanliness and',
		'   cadnano-compatibility issue.',
		'3. **`scafLoop`/`stapLoop` are written as `[]` unconditionally** by `CadnanoJSON.fromRegion()`,',
		'   which would discard input data. All ten designs have these empty, so this corpus cannot detect',
		'   it; the J0 vs J1 check would catch it on a design that uses them.',
		'4. **Deletion relocation is lossy, not cosmetic.** The affected designs come out encoding a',
		'   slightly different molecule than went in (a deletion sits on a neighbouring base). It is',
		'   documented and warned, so it is intended behaviour, but it carries its own verdict',
		'   (`lossy-but-warned`) rather than being filed under normalization.',
		relocationDesigns.length > 0
			? `   Affected here: ${relocationDesigns
					.map((result) => {
						const count = result.originalCadnanoPreservation?.deletionRelocations.length ?? 0;
						return `${result.design} (${count} ${count === 1 ? 'deletion' : 'deletions'})`;
					})
					.join(', ')}.`
			: '   Affected here: none.',
		'',
		'## Provenance',
		'',
		'Generated by `src/lib/model/test/cadnano-json-roundtrip.spec.ts`. Regenerate with:',
		'',
		'```bash',
		'UPDATE_CADNANO_REPORT=1 pnpm vitest run src/lib/model/test/cadnano-json-roundtrip.spec.ts',
		'```',
		'',
		'Random colour generation is seeded per design during the reported run, so regenerating produces',
		'byte-identical output. The SHA-256 of each source design, taken over line-ending-normalised',
		'content, is recorded in `cadnano-roundtrip-report.json` beside this file; a design edited without',
		'regenerating is therefore visible from the artefacts alone.',
		'',
		'| Design | Source SHA-256 |',
		'|---|---|'
	);

	for (const result of results) {
		lines.push(`| ${markdownCell(result.design)} | \`${result.sourceSha256}\` |`);
	}

	lines.push('', '## Detailed results', '');

	for (const result of results) {
		lines.push(`### ${result.design}`, '', `Verdict: **${result.verdict}**`, '');
		if (result.error) {
			lines.push(`- Error during ${result.error.stage}: ${result.error.message}`, '');
			continue;
		}
		lines.push(
			`- Import warnings J0/J1/J2: ${result.warnings.J0.length}/${result.warnings.J1.length}/${result.warnings.J2.length}`,
			''
		);
		for (const [stage, warnings] of Object.entries(result.warnings)) {
			for (const warning of warnings) lines.push(`- ${stage} warning: ${warning}`);
		}
		if (result.warnings.J0.length + result.warnings.J1.length + result.warnings.J2.length > 0) {
			lines.push('');
		}
		if (result.originalCadnanoPreservation) {
			lines.push(...originalCadnanoPreservationDetails(result.originalCadnanoPreservation));
		}
		if (result.J0J1) lines.push(...comparisonDetails(result.J0J1));
		if (result.P1P2) lines.push(...partDetails(result.P1P2));
		if (result.J1J2) lines.push(...comparisonDetails(result.J1J2));
		if (result.P2P3) lines.push(...partDetails(result.P2P3));
	}
	return `${lines.join('\n')}\n`;
}

/** One line, not the whole report: printing 40 kB on every run buried the rest of the suite output. */
export function runSummaryLine(results: DesignResult[]): string {
	const exact = results.filter(
		(result) => result.originalCadnanoPreservation?.agreement.exactInScopeAgreement
	).length;
	const relocations = results.reduce(
		(sum, result) => sum + (result.originalCadnanoPreservation?.deletionRelocations.length ?? 0),
		0
	);
	const unexpected = results.reduce(
		(sum, result) => sum + (result.originalCadnanoPreservation?.unexpectedDifferences.length ?? 0),
		0
	);
	return (
		`cadnano round-trip: ${results.length} designs, ${exact} in exact agreement, ` +
		`${relocations} warned deletion relocation(s), ${unexpected} unexpected differences`
	);
}

export function writeReports(results: DesignResult[]): void {
	assertReportable(results);
	writeReportFilesAtomically([
		{ path: REPORT_JSON, contents: makeReportJson(results) },
		{ path: REPORT_MARKDOWN, contents: makeMarkdown(results) },
	]);
}
