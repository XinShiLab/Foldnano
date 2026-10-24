import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { CadnanoJSON, type VStrandJSON } from '../io/cadnanoJSON';
import { DesignCheckError } from '../checks/designIssue';
import type { LatticedDesignRegion } from '../Part/DesignRegion';
import { cadnanoParser } from '$lib/components/Editor/Toolbar/parsers/cadnanojsonParser';

const PUBLISHED_DIR = path.resolve('test_files/published_cadnano_designs');

function emptyNt(): [number, number, number, number] {
	return [-1, -1, -1, -1];
}

// VH0[0..2] → crossover → VH2[0..2], 21 bases per helix (honeycomb).
function twoHelixDesign(): { name: string; vstrands: VStrandJSON[] } {
	const helix = (num: number, col: number, scaf: VStrandJSON['scaf']): VStrandJSON => ({
		row: 0,
		col,
		num,
		scaf: [...scaf, ...Array.from({ length: 21 - scaf.length }, emptyNt)],
		stap: Array.from({ length: 21 }, emptyNt),
		loop: new Array(21).fill(0),
		skip: new Array(21).fill(0),
	});
	return {
		name: 'Test',
		vstrands: [
			helix(0, 0, [
				[-1, -1, 0, 1],
				[0, 0, 0, 2],
				[0, 1, 2, 0],
			]),
			helix(2, 1, [
				[0, 2, 2, 1],
				[2, 0, 2, 2],
				[2, 1, -1, -1],
			]),
		],
	};
}

function strandArrays(cadnano: CadnanoJSON): string {
	const part = cadnano.toPart();
	const region = part.getDefaultRegion() as LatticedDesignRegion;
	const { json } = CadnanoJSON.fromRegion(region, part);
	return JSON.stringify(json.vstrands.map((vs) => [vs.num, vs.scaf, vs.stap, vs.loop, vs.skip]));
}

describe('CadnanoJSON.fromRaw', () => {
	it('accepts every published cadnano design', () => {
		for (const file of fs.readdirSync(PUBLISHED_DIR).filter((f) => f.endsWith('.json'))) {
			const raw = JSON.parse(fs.readFileSync(path.join(PUBLISHED_DIR, file), 'utf-8'));
			expect(() => CadnanoJSON.fromRaw(raw), file).not.toThrow();
		}
	});

	it('rewrites a self-pointing crossover exit to its neighbour as an info issue', () => {
		const raw = twoHelixDesign();
		raw.vstrands[0].scaf[2] = [0, 2, 2, 0];

		const cadnano = CadnanoJSON.fromRaw(raw);

		expect(cadnano.shapeIssues).toHaveLength(1);
		expect(cadnano.shapeIssues[0]).toMatchObject({
			severity: 'info',
			anchor: { vhIndex: 0, bp: 2 },
		});
		expect(cadnano.warnings).toEqual([]);
		expect(cadnano.vstrands[0].scaf[2]).toEqual([0, 1, 2, 0]);
		expect(strandArrays(cadnano)).toBe(strandArrays(CadnanoJSON.fromRaw(twoHelixDesign())));
	});

	it('imports Hilbert.json (self-pointing exits) the same as the raw constructor', () => {
		const raw = JSON.parse(fs.readFileSync(path.join(PUBLISHED_DIR, 'Hilbert.json'), 'utf-8'));

		const cadnano = CadnanoJSON.fromRaw(raw);

		expect(cadnano.shapeIssues.length).toBeGreaterThan(0);
		expect(cadnano.shapeIssues.every((i) => i.severity === 'info')).toBe(true);
		expect(strandArrays(cadnano)).toBe(strandArrays(new CadnanoJSON(raw.name, raw.vstrands)));
	});

	it('surfaces a discarded one-sided pointer in warnings', () => {
		const raw = twoHelixDesign();
		raw.vstrands[0].scaf[10] = [0, 5, 0, 11];
		raw.vstrands[0].scaf[11] = [0, 10, -1, -1];

		const cadnano = CadnanoJSON.fromRaw(raw);

		expect(cadnano.warnings).toHaveLength(1);
		expect(cadnano.warnings[0]).toMatch(/scaf\[10\].*incoming pointer/);
	});

	it('rejects two helices on one lattice cell', () => {
		const raw = twoHelixDesign();
		raw.vstrands[1].col = 0;

		expect(() => CadnanoJSON.fromRaw(raw)).toThrow(DesignCheckError);
	});

	it('reports the shape error through the file parser', () => {
		const raw = twoHelixDesign();
		raw.vstrands[1].col = 0;
		const meta = { name: 'bad.json', extension: 'json', size: 0, type: 'application/json' };

		expect(() => cadnanoParser.parse(raw as unknown as Record<string, unknown>, meta)).toThrow(
			/Invalid cadnano JSON in file "bad.json": .*shares lattice position/
		);
	});
});
