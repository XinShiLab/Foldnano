import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { CadnanoJSON, type VStrandJSON } from '../io/cadnanoJSON';
import {
	AmbiguousLatticeError,
	crossoverSiteViolations,
	latticeCandidates,
	latticesByLength,
} from '../io/cadnanoLattice';
import type { LatticedDesignRegion } from '../Part/DesignRegion';
import { performReplaceRegion } from '$lib/plugin/result-replacement-operations';

const PUBLISHED_DIR = path.resolve('test_files/published_cadnano_designs');
// 672 = 21 × 32: the shortest length that fits both lattices.
const BOTH_LATTICES = 672;

type Design = { name: string; vstrands: VStrandJSON[] };

function readDesign(file: string): Design {
	return JSON.parse(fs.readFileSync(path.join(PUBLISHED_DIR, file), 'utf-8'));
}

/** Pads every helix with empty bases, keeping the crossovers where they were. */
function padTo(design: Design, length: number): Design {
	return {
		name: design.name,
		vstrands: design.vstrands.map((vs) => {
			const extra = length - vs.scaf.length;
			const empty = () => Array.from({ length: extra }, () => [-1, -1, -1, -1]);
			return {
				...vs,
				scaf: [...vs.scaf, ...empty()],
				stap: [...vs.stap, ...empty()],
				loop: [...vs.loop, ...new Array(extra).fill(0)],
				skip: [...vs.skip, ...new Array(extra).fill(0)],
			} as VStrandJSON;
		}),
	};
}

function withoutCrossovers(design: Design): Design {
	const free = (nt: VStrandJSON['scaf'][number], i: number, num: number) => {
		const [fv, fb, tv, tb] = nt;
		const keepFrom = fv === num && Math.abs(fb - i) === 1;
		const keepTo = tv === num && Math.abs(tb - i) === 1;
		return [keepFrom ? fv : -1, keepFrom ? fb : -1, keepTo ? tv : -1, keepTo ? tb : -1];
	};
	return {
		name: design.name,
		vstrands: design.vstrands.map((vs) => ({
			...vs,
			scaf: vs.scaf.map((nt, i) => free(nt, i, vs.num)),
			stap: vs.stap.map((nt, i) => free(nt, i, vs.num)),
		})) as VStrandJSON[],
	};
}

describe('cadnano lattice detection', () => {
	it('crossover sites pick the length-detected lattice for every published design', () => {
		for (const file of fs.readdirSync(PUBLISHED_DIR).filter((f) => f.endsWith('.json'))) {
			const { vstrands } = readDesign(file);
			const [byLength] = latticesByLength(vstrands[0].scaf.length);
			const other = byLength === 'SQUARE' ? 'HONEYCOMB' : 'SQUARE';
			expect(
				crossoverSiteViolations(vstrands, byLength),
				`${file}: ${byLength} should fit its crossovers better than ${other}`
			).toBeLessThan(crossoverSiteViolations(vstrands, other));
		}
	});

	it('imports a 672-base honeycomb design as honeycomb, not square', () => {
		const design = padTo(readDesign('Force clamp.json'), BOTH_LATTICES);

		expect(latticeCandidates(design.vstrands)).toEqual(['HONEYCOMB']);
		const part = new CadnanoJSON(design.name, design.vstrands).toPart();
		expect(part.getDefaultRegion().kind).toBe('HONEYCOMB');
	});

	it('imports a 672-base square design as square', () => {
		const design = padTo(
			readDesign('NRs_antenna_Cadnano1_2_Staples_cut_colored_64_del_MOD20210922.json'),
			BOTH_LATTICES
		);

		expect(latticeCandidates(design.vstrands)).toEqual(['SQUARE']);
	});

	it('asks for the lattice when nothing tells them apart, and accepts the answer', () => {
		const design = withoutCrossovers(padTo(readDesign('Force clamp.json'), BOTH_LATTICES));
		const cadnano = new CadnanoJSON(design.name, design.vstrands);

		expect(cadnano.latticeCandidates()).toEqual(['SQUARE', 'HONEYCOMB']);
		expect(() => cadnano.toPart()).toThrow(AmbiguousLatticeError);
		expect(cadnano.toPart({ lattice: 'SQUARE' }).getDefaultRegion().kind).toBe('SQUARE');
	});

	it('rejects a requested lattice the crossovers contradict', () => {
		const design = padTo(readDesign('Force clamp.json'), BOTH_LATTICES);

		expect(() =>
			new CadnanoJSON(design.name, design.vstrands).toPart({ lattice: 'SQUARE' })
		).toThrow(/honeycomb crossover sites, not square/);
	});

	it('rejects a requested lattice the length rules out', () => {
		const design = readDesign('Force clamp.json');

		expect(() =>
			new CadnanoJSON(design.name, design.vstrands).toPart({ lattice: 'SQUARE' })
		).toThrow(/can't be square/);
	});

	it('replaces a 672-base honeycomb region from its own cadnano data (plugin path)', () => {
		const design = withoutCrossovers(padTo(readDesign('Force clamp.json'), BOTH_LATTICES));
		const part = new CadnanoJSON(design.name, design.vstrands).toPart({ lattice: 'HONEYCOMB' });
		const region = part.getDefaultRegion() as LatticedDesignRegion;
		const { json } = CadnanoJSON.fromRegion(region, part);
		const vhCount = part.virtualHelices.length;

		performReplaceRegion(part, region, JSON.parse(JSON.stringify(json)));

		expect(part.virtualHelices.length).toBe(vhCount);
	});
});
