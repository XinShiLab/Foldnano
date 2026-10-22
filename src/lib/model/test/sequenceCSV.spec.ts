import { describe, expect, it } from 'vitest';
import { collectPartOligoSequences, sequencesToCSV } from '../io/sequenceCSV';
import type Oligo from '../Oligo/Oligo.svelte';
import type { Part } from '../Part';
import { addLatticeVh, makeHoneycombPart } from './testHelpers';

function addCircularOligo(part: Part, isScaffold: boolean): Oligo {
	const vh0 = addLatticeVh(part, 0, 0);
	const vh1 = addLatticeVh(part, 2, 0);
	const oligoA = part.createOligo(vh0, 0, 3);
	const oligoB = part.createOligo(vh1, 3, 0);
	const segA = [...oligoA.segments][0];
	const segB = [...oligoB.segments][0];

	segA.threePrime.connectTo(segB.fivePrime);
	oligoA.addSegment(segB);
	part.oligos.delete(oligoB);
	segB.threePrime.connectTo(segA.fivePrime);
	oligoA.isScaffold = isScaffold;

	expect(oligoA.isCircular).toBe(true);
	return oligoA;
}

describe('sequence CSV export', () => {
	it('exports linear oligos with explicit endpoints', () => {
		const part = makeHoneycombPart('linear-sequence-csv');
		const vh = addLatticeVh(part, 0, 0);
		const oligo = part.createOligo(vh, 0, 3, '#ff0000');
		oligo.updateOwnSequence('ACGT');

		const records = collectPartOligoSequences(part);
		expect(records).toEqual([
			{
				Name: '',
				Start: '0[0]',
				End: '0[3]',
				Sequence: 'ACGT',
				Length: 4,
				Color: '#ff0000',
				Mod5Prime: '',
				Mod3Prime: '',
			},
		]);
		expect(sequencesToCSV(records)).toBe(
			'Name,Start,End,Sequence,Length,Color,Mod5Prime,Mod3Prime\n,0[0],0[3],ACGT,4,#ff0000,,'
		);
	});

	it('exports the oligo name, quoted when it contains a comma', () => {
		const part = makeHoneycombPart('named-sequence-csv');
		const vh = addLatticeVh(part, 0, 0);
		const oligo = part.createOligo(vh, 0, 3, '#ff0000');
		oligo.updateOwnSequence('ACGT');
		oligo.name = 'core, row 1';

		const csv = sequencesToCSV(collectPartOligoSequences(part));
		expect(csv.split('\n')[1]).toBe('"core, row 1",0[0],0[3],ACGT,4,#ff0000,,');
	});

	it('rejects circular scaffold oligos', () => {
		const part = makeHoneycombPart('circular-scaffold-sequence-csv');
		addCircularOligo(part, true);

		expect(() => collectPartOligoSequences(part)).toThrow(/circular scaffold DNA/);
	});

	it('rejects circular staple oligos', () => {
		const part = makeHoneycombPart('circular-staple-sequence-csv');
		addCircularOligo(part, false);

		expect(() => collectPartOligoSequences(part)).toThrow(/circular staple DNA/);
	});
});
