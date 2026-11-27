import { describe, expect, it } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import type { Part } from '$lib/model/Part';
import { addLatticeVh } from '$lib/model/test/testHelpers';
import {
	findStickyMatches,
	sidePositions,
	singleStrandedRuns,
	type SingleStrandedRun,
} from './stickyEnds';

function part(): Part {
	return new FoldnanoDocument(undefined, 'Sticky').addNewPart('HONEYCOMB');
}

let nextCol = 0;
/** A strand on its own helix, 5'→3' from bp `from` to bp `to`, carrying `sequence`. */
function strand(p: Part, sequence: string, from = 0, to = sequence.length - 1) {
	const vh = addLatticeVh(p, nextCol++, 0);
	const oligo = p.createOligo(vh, from, to);
	[...oligo.segments][0].sequence = sequence;
	return { vh, oligo };
}

const basesOf = (runs: SingleStrandedRun[]) => runs.map((run) => run.bases);

describe('singleStrandedRuns', () => {
	it('finds a lone strand and nothing in a duplex', () => {
		const p = part();
		const { vh } = strand(p, 'ACGTACGTAC');
		expect(basesOf(singleStrandedRuns(p))).toEqual(['ACGTACGTAC']);
		const partner = p.createOligo(vh, 9, 0);
		[...partner.segments][0].sequence = 'GTACGTACGT';
		expect(singleStrandedRuns(p)).toEqual([]);
	});

	it('keeps only the overhang of a strand that is paired for part of its length', () => {
		const p = part();
		const { vh, oligo } = strand(p, 'AAAAAAAAAACCCCCGGGGG', 0, 19);
		p.createOligo(vh, 9, 0);
		const [run] = singleStrandedRuns(p);
		expect(run).toMatchObject({ oligoId: oligo.id, start: 10, bases: 'CCCCCGGGGG' });
		expect(run.positions.map((b) => b.bpIndex)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
	});
});

describe('findStickyMatches', () => {
	it('matches two complementary overhangs over their whole length', () => {
		const p = part();
		strand(p, 'GATTACAGGC');
		strand(p, 'GCCTGTAATC');
		const [match, ...rest] = findStickyMatches(singleStrandedRuns(p), 7);
		expect(rest).toEqual([]);
		expect(match).toMatchObject({ length: 10, self: false });
		expect(match.a.offset).toBe(0);
		expect(match.b.offset).toBe(0);
	});

	it('finds a partial overlap and where it sits on each side', () => {
		const p = part();
		strand(p, 'TTTGATTACATTTT');
		strand(p, 'CCCTGTAATCCCC');
		const [match] = findStickyMatches(singleStrandedRuns(p), 7);
		expect(match.length).toBe(7);
		const sides = [match.a, match.b].map((s) => s.run.bases.slice(s.offset, s.offset + s.length));
		expect(sides.sort()).toEqual(['GATTACA', 'TGTAATC']);
		expect(sidePositions(match.a)).toHaveLength(7);
	});

	it('ignores runs shorter than the minimum, which never goes below 5', () => {
		const p = part();
		strand(p, 'TTGATTATT');
		strand(p, 'CCTAATCCC');
		expect(findStickyMatches(singleStrandedRuns(p), 7)).toEqual([]);
		expect(findStickyMatches(singleStrandedRuns(p), 5)).toHaveLength(1);
		expect(findStickyMatches(singleStrandedRuns(p), 2)).toHaveLength(1);
	});

	it('lists one end matching several others, each once', () => {
		const p = part();
		strand(p, 'GATTACAGGC');
		strand(p, 'GCCTGTAATC');
		strand(p, 'TTGCCTGTAATCTT');
		const matches = findStickyMatches(singleStrandedRuns(p), 7);
		expect(matches).toHaveLength(2);
		expect(new Set(matches.map((m) => m.key)).size).toBe(2);
	});

	it('never matches unassigned bases', () => {
		const p = part();
		strand(p, 'GATTNCAGGC');
		strand(p, 'GCCTGTAATC');
		expect(findStickyMatches(singleStrandedRuns(p), 7)).toEqual([]);
	});

	it('marks a self-complementary stretch, which binds another copy of the same strand', () => {
		const p = part();
		strand(p, 'TTACGCGTTT');
		const matches = findStickyMatches(singleStrandedRuns(p), 5);
		expect(matches).toHaveLength(1);
		expect(matches[0]).toMatchObject({ self: true, length: 6 });
	});

	it('matches across Parts', () => {
		const doc = new FoldnanoDocument(undefined, 'Two');
		const arm = doc.addNewPart('HONEYCOMB');
		const base = doc.addNewPart('HONEYCOMB');
		strand(arm, 'GATTACAGGC');
		strand(base, 'GCCTGTAATC');
		const [match] = findStickyMatches([...singleStrandedRuns(arm), ...singleStrandedRuns(base)], 7);
		expect(new Set([match.a.run.partId, match.b.run.partId])).toEqual(new Set([arm.id, base.id]));
	});

	it('stays fast with hundreds of overhangs', () => {
		const random = (n: number, seed: { s: number }) =>
			Array.from({ length: n }, () => {
				seed.s = (seed.s * 1103515245 + 12345) % 2 ** 31;
				return 'ACGT'[seed.s % 4];
			}).join('');
		const seed = { s: 7 };
		const runs: SingleStrandedRun[] = Array.from({ length: 600 }, (_, i) => ({
			partId: 'p',
			oligoId: `o${i}`,
			start: 0,
			bases: random(i % 10 === 0 ? 400 : 20, seed),
			positions: [],
		}));
		const started = performance.now();
		findStickyMatches(runs, 7);
		expect(performance.now() - started).toBeLessThan(500);
	});
});
