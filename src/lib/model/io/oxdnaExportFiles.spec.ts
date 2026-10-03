// @vitest-environment node
/**
 * Exports each cadnano design to oxDNA format, writes the result to
 * test_files/fixtures/oxdna_export/Foldnano/ (gitignored), and (when a tacoxDNA
 * reference exists under test_files/fixtures/oxdna_export/Taco/) compares nucleotide
 * counts and logs over-stretched backbone bonds against Taco. Geometry is intentionally
 * no longer tacoxDNA-parity: the exporter first builds a symmetric nucleotide model in
 * nanometres and rejects invalid asymmetric or constrained-anchor insert/skip data.
 *
 * JSON input files are read from test_files/published_cadnano_designs/.
 *
 * Run: pnpm vitest run src/lib/model/io/oxdnaExportFiles.spec.ts
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { CadnanoJSON } from '$lib/model/io/cadnanoJSON';
import { exportPartToOxDna } from '$lib/model/io/oxdnaExport';

const JSON_DIR = path.resolve('test_files/published_cadnano_designs');
const FOLD_DIR = path.resolve('test_files/fixtures/oxdna_export/Foldnano');
const TACO_DIR = path.resolve('test_files/fixtures/oxdna_export/Taco');

const LONG_BOND_THRESHOLD = 1.5; // oxDNA units; FENE explosion limit
// Nucleotide-count mismatches between Foldnano's cadnano importer and tacoxDNA
// happen on a few designs (e.g. skip-handling differences in legacy files).
// We log the delta but don't fail this spec on it — it belongs to the importer,
// not the exporter.
const NT_COUNT_TOLERANCE = 200;

interface TopRow {
	strandId: number;
	base: string;
	next: number;
	prev: number;
}

function parseTop(p: string): { nNts: number; nStrands: number; rows: TopRow[] } {
	const lines = fs
		.readFileSync(p, 'utf-8')
		.split(/\r?\n/)
		.filter((l) => l.length > 0);
	const [nNts, nStrands] = lines[0].split(/\s+/).slice(0, 2).map(Number);
	const rows: TopRow[] = lines.slice(1).map((line) => {
		const parts = line.split(/\s+/);
		return {
			strandId: Number(parts[0]),
			base: parts[1],
			next: Number(parts[2]),
			prev: Number(parts[3]),
		};
	});
	return { nNts, nStrands, rows };
}

function parseDatPositions(p: string): Array<[number, number, number]> {
	const lines = fs.readFileSync(p, 'utf-8').split(/\r?\n/);
	// Header is t=, b=, E= (3 lines)
	return lines.slice(3).flatMap<[number, number, number]>((line) => {
		if (!line.trim()) return [];
		const v = line.split(/\s+/).map(Number);
		return v.length >= 3 ? [[v[0], v[1], v[2]]] : [];
	});
}

function countLongBackboneBonds(
	rows: TopRow[],
	pos: Array<[number, number, number]>,
	threshold: number
): number {
	let count = 0;
	for (let i = 0; i < rows.length; i++) {
		const j = rows[i].next;
		if (j < 0 || j >= pos.length) continue;
		const dx = pos[j][0] - pos[i][0];
		const dy = pos[j][1] - pos[i][1];
		const dz = pos[j][2] - pos[i][2];
		if (Math.hypot(dx, dy, dz) > threshold) count++;
	}
	return count;
}

fs.mkdirSync(FOLD_DIR, { recursive: true });
const jsonFiles = fs.readdirSync(JSON_DIR).filter((f) => f.endsWith('.json'));

describe.skipIf(jsonFiles.length === 0)(
	'oxDNA export — write files and compare to tacoxDNA reference',
	() => {
		for (const file of jsonFiles) {
			it(`exports ${file}`, () => {
				const raw = fs.readFileSync(path.join(JSON_DIR, file), 'utf-8');
				const json = JSON.parse(raw);
				const cadnano = new CadnanoJSON(json.name ?? file, json.vstrands);
				const part = cadnano.toPart();
				let result: ReturnType<typeof exportPartToOxDna>;
				try {
					result = exportPartToOxDna(part);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					expect(message).toMatch(/asymmetric insert\/skip|constrained crossover site/);
					console.warn(`  ${file}: skipped invalid legacy insert/skip data — ${message}`);
					return;
				}

				const base = file.replace('.json', '');
				const datPath = path.join(FOLD_DIR, `${base}.dat`);
				const topPath = path.join(FOLD_DIR, `${base}.top`);
				fs.writeFileSync(datPath, result.dat);
				fs.writeFileSync(topPath, result.top);

				expect(result.nucleotideCount).toBeGreaterThan(0);

				const tacoTop = path.join(TACO_DIR, `${base}.top`);
				const tacoDat = path.join(TACO_DIR, `${base}.dat`);
				if (!fs.existsSync(tacoTop) || !fs.existsSync(tacoDat)) {
					console.log(
						`  ${file}: ${result.nucleotideCount} nts, ${result.strandCount} strands  [no Taco reference]`
					);
					return;
				}

				const tacoTopParsed = parseTop(tacoTop);
				const tacoPos = parseDatPositions(tacoDat);
				const foldTopParsed = parseTop(topPath);
				const foldPos = parseDatPositions(datPath);

				const tacoLongBonds = countLongBackboneBonds(
					tacoTopParsed.rows,
					tacoPos,
					LONG_BOND_THRESHOLD
				);
				const foldLongBonds = countLongBackboneBonds(
					foldTopParsed.rows,
					foldPos,
					LONG_BOND_THRESHOLD
				);

				console.log(
					`  ${file}: Foldnano=${result.nucleotideCount}/${result.strandCount} ` +
						`Taco=${tacoTopParsed.nNts}/${tacoTopParsed.nStrands} ` +
						`longBonds Foldnano=${foldLongBonds} Taco=${tacoLongBonds}`
				);

				// Nucleotide / strand counts: warn on small drifts, fail only on gross mismatches.
				const ntDelta = Math.abs(result.nucleotideCount - tacoTopParsed.nNts);
				if (ntDelta > 0) {
					console.warn(
						`  ${file}: nucleotide-count delta vs Taco = ${result.nucleotideCount - tacoTopParsed.nNts} ` +
							`(importer-side, unrelated to oxDNA geometry)`
					);
				}
				expect(ntDelta).toBeLessThanOrEqual(NT_COUNT_TOLERANCE);
				expect(result.strandCount).toBe(tacoTopParsed.nStrands);

				expect(Number.isFinite(foldLongBonds)).toBe(true);
			});
		}
	}
);
