import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { CadnanoJSON } from '../io/cadnanoJSON';
import { checkCadnanoProfile } from '../checks/cadnano';
import { createRepeatGroup, syncRepeatGroups } from '../Part/repeatGroups';
import { Part } from '../Part';
import FoldnanoDocument from '../document.svelte';
import { migrateDocumentJson } from '../documentFormat';
import type { LatticedDesignRegion } from '../Part/DesignRegion';
import { makeHoneycombPart, addLatticeVh } from './testHelpers';

const PUBLISHED_DIR = path.resolve('test_files/published_cadnano_designs');

const rulesOf = (part: Part, region = part.getDefaultRegion()) =>
	checkCadnanoProfile(part, region).map((issue) => `${issue.severity}:${issue.rule}`);

/** VH 0 at (0,0) and VH 1 at (0,1); `vh1Strand` picks which strand of VH 1 the oligo continues on. */
function twoHelixPart(vh1Strand: 0 | 1): Part {
	const part = makeHoneycombPart();
	const vh0 = addLatticeVh(part, 0, 0);
	const vh1 = addLatticeVh(part, 1, 0);
	const a = part.createOligo(vh0, 0, 10);
	const b = vh1Strand === 0 ? part.createOligo(vh1, 11, 20) : part.createOligo(vh1, 20, 11);
	part.connectTwoOligos(a, b);
	return part;
}

describe('checkCadnanoProfile', () => {
	it('finds nothing to report in any published cadnano design', () => {
		for (const file of fs.readdirSync(PUBLISHED_DIR).filter((f) => f.endsWith('.json'))) {
			const raw = JSON.parse(fs.readFileSync(path.join(PUBLISHED_DIR, file), 'utf-8'));
			expect(rulesOf(CadnanoJSON.fromRaw(raw).toPart()), file).toEqual([]);
		}
	});

	it('blocks a connection from a cadnano scaffold path to a staple path', () => {
		const part = twoHelixPart(0);

		expect(rulesOf(part)).toEqual(['error:cadnano-strand-class']);
		// Why it's an error: the exported file can't even be read back.
		const { json } = CadnanoJSON.fromRegion(part.getDefaultRegion() as LatticedDesignRegion, part);
		expect(() => new CadnanoJSON(json.name, json.vstrands).toPart()).toThrow();
	});

	it('accepts a crossover that stays on one cadnano path', () => {
		expect(rulesOf(twoHelixPart(1))).toEqual([]);
	});

	it('warns that repeat-group copies are left out', () => {
		const part = makeHoneycombPart();
		const vh = addLatticeVh(part, 0, 0);
		createRepeatGroup(part, [part.createOligo(vh, 0, 9)], 21);
		syncRepeatGroups(part);

		expect(rulesOf(part)).toEqual(['warning:cadnano-mirror-oligo']);
	});

	it('warns that connections to other regions are cut', () => {
		const raw = JSON.parse(fs.readFileSync(path.resolve('static/hero-design.json'), 'utf-8'));
		const part = FoldnanoDocument.fromJSON(migrateDocumentJson(raw)).parts[0];
		const honeycomb = part.regions.find((r) => r.kind === 'HONEYCOMB')!;

		expect(rulesOf(part, honeycomb)).toContain('warning:cadnano-cross-region');
	});

	it('warns that cadnano will ask about the lattice of a 672-base region, with the right answer', () => {
		for (const [kind, answer] of [
			['HONEYCOMB', 'Answer no'],
			['SQUARE', 'Answer yes'],
		] as const) {
			const part = Part.forType(kind, 'long', undefined, 672);
			addLatticeVh(part, 0, 0);

			const issues = checkCadnanoProfile(part, part.getDefaultRegion());
			expect(issues.map((i) => `${i.severity}:${i.rule}`)).toEqual([
				'warning:cadnano-lattice-length',
			]);
			expect(issues[0].message).toContain(answer);
		}
	});

	it('blocks a freeform region and notes lost metadata', () => {
		const freeform = Part.forType('FREEFORM', 'free');
		expect(rulesOf(freeform)).toEqual(['error:cadnano-no-lattice']);

		const part = makeHoneycombPart();
		const oligo = part.createOligo(addLatticeVh(part, 0, 0), 0, 5);
		oligo.name = 'staple 1';
		expect(checkCadnanoProfile(part, part.getDefaultRegion())).toMatchObject([
			{ rule: 'cadnano-metadata', severity: 'info', message: expect.stringMatching(/oligo names/) },
		]);
	});
});
