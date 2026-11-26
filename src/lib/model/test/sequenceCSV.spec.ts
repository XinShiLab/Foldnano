import { describe, expect, it } from 'vitest';
import {
	collectPartOligoSequences,
	documentNeedsQuantities,
	documentSequencesCSV,
	sequencesToCSV,
} from '../io/sequenceCSV';
import type Oligo from '../Oligo/Oligo.svelte';
import { Part } from '../Part';
import FoldnanoDocument from '../document.svelte';
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

describe('documentSequencesCSV', () => {
	function twoPartDoc() {
		const doc = new FoldnanoDocument(undefined, 'Kit');
		const brick = doc.addPart(Part.forType('HONEYCOMB', 'Brick, big'));
		const vh = addLatticeVh(brick, 0, 0);
		brick.createOligo(vh, 0, 20, '#ff0000');
		doc.assembly.add(brick.id, 'Brick 2');
		const pin = doc.addPart(Part.forType('SQUARE', 'Pin'));
		pin.createOligo(addLatticeVh(pin, 0, 0), 0, 10, '#00ff00');
		return { doc, brick, pin };
	}

	it('keeps the one-Part format for a single Part placed once', () => {
		const { doc, brick, pin } = twoPartDoc();
		doc.removePart(pin.id);
		doc.assembly.remove(doc.assembly.occurrencesOf(brick.id)[1].id);
		expect(documentNeedsQuantities(doc)).toBe(false);
		expect(documentSequencesCSV(doc)).toBe(sequencesToCSV(collectPartOligoSequences(brick)));
	});

	it('adds a quantity for a single Part placed several times', () => {
		const { doc, pin } = twoPartDoc();
		doc.removePart(pin.id);
		expect(documentNeedsQuantities(doc)).toBe(true);
		expect(documentSequencesCSV(doc).split('\n')[1].startsWith('"Brick, big",2,')).toBe(true);
	});

	it('keeps a multi-line oligo name in one row', () => {
		const { doc, brick } = twoPartDoc();
		[...brick.realOligos][0].name = 'first\nsecond';
		const csv = documentSequencesCSV(doc);
		expect(csv).toContain('"Brick, big",2,"first\nsecond",');
		expect(csv.startsWith('Part,Quantity,')).toBe(true);
	});

	it('adds Part and Quantity (instances, hidden ones too) for several Parts', () => {
		const { doc, brick } = twoPartDoc();
		doc.assembly.occurrencesOf(brick.id)[1].visible = false;
		const lines = documentSequencesCSV(doc).split('\n');
		expect(lines[0]).toBe('Part,Quantity,Name,Start,End,Sequence,Length,Color,Mod5Prime,Mod3Prime');
		expect(lines[1].startsWith('"Brick, big",2,')).toBe(true);
		expect(lines[2].startsWith('Pin,1,')).toBe(true);
		expect(lines).toHaveLength(3);
	});
});
