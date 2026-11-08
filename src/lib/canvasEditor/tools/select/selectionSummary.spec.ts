import { describe, expect, it } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import type Oligo from '$lib/model/Oligo';
import type { SegmentEnd } from '$lib/model/Oligo';
import { addLatticeVh } from '$lib/model/test/testHelpers';
import {
	countModifications,
	formatSelectionCounts,
	selectionItemCount,
	summarizeEndSelection,
} from './selectionSummary';

function setup() {
	const doc = new FoldnanoDocument();
	const part = doc.addNewPart('HONEYCOMB');
	const vhs = [addLatticeVh(part, 0, 0), addLatticeVh(part, 1, 0)];
	return { part, vhs };
}

const firstSegment = (oligo: Oligo) => Array.from(oligo.segments)[0];

describe('summarizeEndSelection', () => {
	it('is empty for an empty selection', () => {
		const summary = summarizeEndSelection(new Set());
		expect(selectionItemCount(summary)).toBe(0);
		expect(formatSelectionCounts(summary)).toBe('');
	});

	it('counts an oligo with every end selected as one whole oligo', () => {
		const { part, vhs } = setup();
		const oligo = part.createOligo(vhs[0], 0, 10);
		const summary = summarizeEndSelection(new Set(oligo.allEnds));
		expect(summary.oligos).toEqual([oligo]);
		expect(summary.segments).toEqual([]);
		expect(summary.ends).toEqual([]);
		expect(formatSelectionCounts(summary)).toBe('1 oligo');
	});

	it('splits a partial oligo into its selected segments, crossovers and loose ends', () => {
		const { part, vhs } = setup();
		const a = part.createOligo(vhs[0], 0, 20);
		const b = part.createOligo(vhs[1], 20, 0);
		part.createCrossover(a, b, firstSegment(b), 20);
		const [segA, segB] = Array.from(a.segments);
		expect(segB).toBeDefined();
		const crossover = { from: segA.threePrime, to: segB.fivePrime };

		// segA whole (and so the crossover's 3' end), plus the crossover's 5' end on segB.
		const selected = new Set<SegmentEnd>([segA.fivePrime, segA.threePrime, segB.fivePrime]);
		const summary = summarizeEndSelection(selected);

		expect(summary.oligos).toEqual([]);
		expect(summary.segments).toEqual([segA]);
		expect(summary.crossovers).toEqual([crossover]);
		expect(summary.ends).toEqual([]);
		expect(summary.touchedOligos).toEqual([a]);
		expect(formatSelectionCounts(summary)).toBe('1 segment · 1 crossover');
	});

	it('counts ends of different oligos separately', () => {
		const { part, vhs } = setup();
		const a = firstSegment(part.createOligo(vhs[0], 0, 10));
		const b = firstSegment(part.createOligo(vhs[1], 30, 20));
		const summary = summarizeEndSelection(new Set([a.fivePrime, b.threePrime]));
		expect(summary.ends).toEqual([a.fivePrime, b.threePrime]);
		expect(summary.touchedOligos).toHaveLength(2);
		expect(selectionItemCount(summary)).toBe(2);
		expect(formatSelectionCounts(summary)).toBe('2 ends');
	});
});

describe('countModifications', () => {
	it('counts each modification across the given ends and skips unmodified ones', () => {
		const { part, vhs } = setup();
		const a = firstSegment(part.createOligo(vhs[0], 0, 10));
		const b = firstSegment(part.createOligo(vhs[1], 30, 20));
		a.fivePrime.modification = 'biotin';
		b.fivePrime.modification = 'biotin';
		a.threePrime.modification = 'Cy3';
		const ends = [a.fivePrime, a.threePrime, b.fivePrime, b.threePrime];
		expect(countModifications(ends)).toEqual([
			{ name: 'biotin', count: 2 },
			{ name: 'Cy3', count: 1 },
		]);
	});
});
