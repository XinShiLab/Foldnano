// @vitest-environment node

// The published-design suite (cadnano-json-roundtrip.spec.ts) only sees files that started in
// cadnano. This corpus builds Foldnano-native designs, one per thing cadnano can't hold, and checks
// the guard the export relies on: whenever export + re-import changes a design, checkCadnanoProfile
// (or the editor-rules check, for states only an imported file can carry) reported it beforehand.

import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { CadnanoJSON } from '../io/cadnanoJSON';
import { AmbiguousLatticeError } from '../io/cadnanoLattice';
import { checkCadnanoProfile } from '../checks/cadnano';
import { checkPartIntegrity } from '../checks/integrity';
import { createRepeatGroup, syncRepeatGroups } from '../Part/repeatGroups';
import { Part } from '../Part';
import type { LatticedDesignRegion } from '../Part/DesignRegion';
import type VirtualHelix from '../VirtualHelix';
import FoldnanoDocument from '../document.svelte';
import { migrateDocumentJson } from '../documentFormat';
import { compareParts, snapshotPart, withSeededRandom } from './roundtrip/comparison';
import { addLatticeVh } from './testHelpers';

interface Case {
	name: string;
	build: () => { part: Part; region: LatticedDesignRegion };
	/** Rules the cadnano profile must report (errors and warnings; info is not listed). */
	flags: string[];
	/** Whether export + re-import changes the design; a flag without loss (e.g. a lattice question) is fine. */
	loses: boolean;
}

function lattice(kind: 'HONEYCOMB' | 'SQUARE', cols: number, maxBase?: number) {
	const part = Part.forType(kind, `${kind.toLowerCase()} test`, undefined, maxBase);
	const vhs = Array.from({ length: cols }, (_, col) => addLatticeVh(part, col, 0));
	return { part, vhs, region: part.getDefaultRegion() as LatticedDesignRegion };
}

/** VH a strand 0 → VH b strand 1: both on cadnano's scaffold path (helix + strand parity even). */
function scaffoldCrossover(part: Part, a: VirtualHelix, b: VirtualHelix, at: number) {
	part.connectTwoOligos(part.createOligo(a, at - 10, at), part.createOligo(b, at + 10, at + 1));
}

function duplex(part: Part, vh: VirtualHelix, from: number, to: number) {
	const forward = part.createOligo(vh, from, to);
	part.createOligo(vh, to, from);
	return [...forward.segments][0];
}

function slot(part: Part, vh: VirtualHelix, strand: 0 | 1, bp: number) {
	return part.getEntitiesAtVh(vh.id, strand, bp).segment!.slots.find((s) => s.bpIndex === bp)!;
}

const CASES: Case[] = [
	{
		name: 'clean honeycomb: crossovers, a symmetric skip and insert',
		build: () => {
			const { part, vhs, region } = lattice('HONEYCOMB', 3);
			scaffoldCrossover(part, vhs[0], vhs[1], 20);
			const seg = duplex(part, vhs[2], 0, 40);
			seg.addSkipOrInsertion(10, -1);
			seg.addSkipOrInsertion(20, 2);
			return { part, region };
		},
		flags: [],
		loses: false,
	},
	{
		name: 'clean square with a crossover',
		build: () => {
			const { part, vhs, region } = lattice('SQUARE', 2);
			scaffoldCrossover(part, vhs[0], vhs[1], 30);
			return { part, region };
		},
		flags: [],
		loses: false,
	},
	{
		name: 'skip left on one strand after its partner strand was deleted',
		build: () => {
			const { part, vhs, region } = lattice('HONEYCOMB', 1);
			const seg = duplex(part, vhs[0], 0, 30);
			seg.addSkipOrInsertion(12, -1);
			part.removeOligo(part.getEntitiesAtVh(vhs[0].id, 1, 12).oligo!);
			return { part, region };
		},
		flags: [],
		loses: false,
	},
	{
		name: 'sequences and oligo names (info only)',
		build: () => {
			const { part, vhs, region } = lattice('HONEYCOMB', 1);
			const oligo = part.createOligo(vhs[0], 0, 9);
			oligo.name = 'named';
			[...oligo.segments][0].sequence = 'ACGTACGTAC';
			return { part, region };
		},
		flags: [],
		loses: false,
	},
	{
		name: 'connection between a cadnano scaffold path and a staple path',
		build: () => {
			const { part, vhs, region } = lattice('HONEYCOMB', 2);
			part.connectTwoOligos(part.createOligo(vhs[0], 0, 10), part.createOligo(vhs[1], 11, 20));
			return { part, region };
		},
		flags: ['cadnano-strand-class'],
		loses: true,
	},
	{
		name: 'different insert on the two strands of one base',
		build: () => {
			const { part, vhs, region } = lattice('HONEYCOMB', 1);
			duplex(part, vhs[0], 0, 30);
			slot(part, vhs[0], 0, 15).seq = 'NN';
			return { part, region };
		},
		flags: ['asymmetric-skip-insert'],
		loses: true,
	},
	{
		name: 'repeat-group copies',
		build: () => {
			const { part, vhs, region } = lattice('HONEYCOMB', 1);
			createRepeatGroup(part, [part.createOligo(vhs[0], 0, 9)], 21);
			syncRepeatGroups(part);
			return { part, region };
		},
		flags: ['cadnano-mirror-oligo'],
		loses: true,
	},
	{
		name: '672-base honeycomb with crossovers (Foldnano settles the lattice)',
		build: () => {
			const { part, vhs, region } = lattice('HONEYCOMB', 2, 672);
			scaffoldCrossover(part, vhs[0], vhs[1], 20);
			return { part, region };
		},
		flags: ['cadnano-lattice-length'],
		loses: false,
	},
	{
		name: 'helix number that does not match its cell parity',
		build: () => {
			const vs = (num: number, col: number) => ({
				num,
				row: 0,
				col,
				scaf: [
					[-1, -1, num, 1],
					[num, 0, -1, -1],
					...Array.from({ length: 19 }, () => [-1, -1, -1, -1]),
				],
				stap: Array.from({ length: 21 }, () => [-1, -1, -1, -1]),
				loop: new Array(21).fill(0),
				skip: new Array(21).fill(0),
			});
			// num 2 on col 1 is an even number on an odd cell.
			const part = CadnanoJSON.fromRaw({ name: 'parity', vstrands: [vs(0, 0), vs(2, 1)] }).toPart();
			return { part, region: part.getDefaultRegion() as LatticedDesignRegion };
		},
		flags: ['helix-cell-parity'],
		loses: false,
	},
	{
		name: 'connections to another region',
		build: () => {
			const file = path.resolve('test_files/fn_designs/minitest3.fn.json');
			const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
			const part = FoldnanoDocument.fromJSON(migrateDocumentJson(raw)).parts[0];
			const region = part.regions.find((r) => r.kind === 'SQUARE') as LatticedDesignRegion;
			return { part, region };
		},
		flags: ['cadnano-cross-region'],
		loses: true,
	},
];

/** The region exported to cadnano JSON and read back the way a user's file would be. */
function exportAndReimport(part: Part, region: LatticedDesignRegion): Part {
	const { json } = CadnanoJSON.fromRegion(region, part);
	const cadnano = CadnanoJSON.fromRaw(JSON.parse(JSON.stringify(json)));
	try {
		return cadnano.toPart();
	} catch (err) {
		// The user's answer to the lattice question, as in the lattice prompt.
		if (err instanceof AmbiguousLatticeError) return cadnano.toPart({ lattice: region.kind });
		throw err;
	}
}

/** Only `region`'s helices and segments; oligos and crossovers aren't split by region, so a
 * multi-region design always shows changes (and must be flagged). */
function regionOnly(part: Part, region: LatticedDesignRegion) {
	const snapshot = snapshotPart(part);
	const inRegion = new Set(
		part.virtualHelices.filter((vh) => vh.regionId === region.id).map((vh) => vh.index)
	);
	return {
		...snapshot,
		regionKinds: [region.kind],
		vstrandOrder: snapshot.vstrandOrder.filter((i) => inRegion.has(i)),
		virtualHelices: snapshot.virtualHelices.filter((vh) => inRegion.has(vh.index)),
		segments: snapshot.segments.filter((seg) => inRegion.has(seg.vh)),
	};
}

describe('Foldnano-native designs through cadnano JSON', () => {
	for (const testCase of CASES) {
		it(testCase.name, () => {
			withSeededRandom(testCase.name, () => {
				const { part, region } = testCase.build();
				const flagged = checkCadnanoProfile(part, region)
					.filter((issue) => issue.severity !== 'info')
					.map((issue) => issue.rule);
				expect([...new Set(flagged)].sort()).toEqual([...testCase.flags].sort());

				let changes: number;
				try {
					const back = exportAndReimport(part, region);
					const comparison = compareParts(
						regionOnly(part, region),
						snapshotPart(back),
						testCase.name
					);
					changes = comparison.foldnanoPartChanges;
				} catch {
					changes = Infinity;
				}
				expect(changes > 0, `${testCase.name}: ${changes} change(s)`).toBe(testCase.loses);
				// The guard: any loss was reported up front.
				if (changes > 0) {
					const editorErrors = checkPartIntegrity(part, new Set([region.id])).filter(
						(issue) => issue.severity === 'error'
					);
					expect(flagged.length + editorErrors.length).toBeGreaterThan(0);
				}
			});
		});
	}

	it('a skip on a crossover base comes back moved, which the editor-rules check reports on open', () => {
		const raw = JSON.parse(
			fs.readFileSync(path.resolve('test_files/published_cadnano_designs/8hb_2ab_8f.json'), 'utf-8')
		);
		const part = CadnanoJSON.fromRaw(raw).toPart();
		const region = part.getDefaultRegion() as LatticedDesignRegion;
		const end = part.segmentsLookup
			.values()
			.toArray()
			.flatMap((seg) => [seg.fivePrime, seg.threePrime])
			.find((e) => e.isConstrained && !e.isFree)!;
		const vh = end.segment.inVirtualHelix;
		for (const strand of [0, 1] as const) {
			const s = part.getEntitiesAtVh(vh.id, strand, end.index).segment?.slots;
			const target = s?.find((x) => x.bpIndex === end.index);
			if (target) target.seq = '';
		}

		// cadnano itself can hold it, so the cadnano profile is silent...
		expect(checkCadnanoProfile(part, region)).toEqual([]);
		// ...but the import moves it off the crossover, and the state was already an editor-rules error.
		const back = exportAndReimport(part, region);
		expect(compareParts(snapshotPart(part), snapshotPart(back), 'skip').segmentsModified).toBe(2);
		expect(checkPartIntegrity(part).map((i) => i.rule)).toContain('skip-insert-on-crossover');
	});
});
