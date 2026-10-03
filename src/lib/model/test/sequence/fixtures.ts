// Paths and the provenance record shared by the sequence-comparison modules.
//
// `_provenance.json` is written by scripts/gen_reference_sequences.py and is the single source of
// truth for the scaffold, the circular break point, and the hashes of every input and output.

import * as fs from 'fs';
import * as path from 'path';

export const DESIGNS_DIR = path.resolve('test_files/published_cadnano_designs');
export const REFERENCE_DIR = path.resolve('test_files/fixtures/sequence_generation/cadnano_ref');
export const SCAFFOLD_DIR = path.resolve('static/scaffolds');
export const REPORT_DIR = path.resolve('test_files/fixtures/sequence_generation');
export const REPORT_JSON = path.join(REPORT_DIR, 'sequence-comparison-report.json');
export const REPORT_MARKDOWN = path.join(REPORT_DIR, 'sequence-comparison-report.md');
export const PROVENANCE_FILE = '_provenance.json';
export const PROVENANCE = path.join(REFERENCE_DIR, PROVENANCE_FILE);
export const SCAFFOLD_FILE = 'scaf8634.txt';

export const EXPECTED_DESIGN_COUNT = 10;
export const MAX_EXAMPLES = 6;

/** A crossover recorded structurally, so both halves can be verified before it is broken. */
export interface BreakPoint {
	from: { vh: number; bp: number };
	to: { vh: number; bp: number };
}

export interface DesignProvenance {
	scaffoldFile: string;
	scaffoldLength: number;
	scaffoldRouteLength: number;
	scaffoldCircular: boolean;
	linearizedAt: BreakPoint | null;
	inclusionRule: string;
	oligos: number;
	oligoNt: number;
	unsequencedNt: number;
	circularExcluded: number;
	sourceSha256: string;
	csvSha256: string;
}

export interface Provenance {
	generatorVersion: number;
	sequenceSource: string;
	unsequencedMarker: string;
	inclusionRule: string;
	cadnano: {
		source: string;
		module: string;
		version: string;
		commit?: string;
		dirty?: boolean;
		modifiedFiles?: string[];
		modifiedFileSha256?: Record<string, string>;
	};
	python: string;
	scaffoldSha256: string;
	designs: Record<string, DesignProvenance>;
}

export const provenance: Provenance = JSON.parse(fs.readFileSync(PROVENANCE, 'utf-8'));

export const designNames = fs
	.readdirSync(DESIGNS_DIR)
	.filter((file) => file.endsWith('.json'))
	.map((file) => path.basename(file, '.json'))
	.sort();

export function readScaffold(file: string): string {
	return fs.readFileSync(path.join(SCAFFOLD_DIR, file), 'utf-8').trim();
}

export function referenceCsvPath(design: string): string {
	return path.join(REFERENCE_DIR, `${design}.csv`);
}

export function designJsonPath(design: string): string {
	return path.join(DESIGNS_DIR, `${design}.json`);
}
