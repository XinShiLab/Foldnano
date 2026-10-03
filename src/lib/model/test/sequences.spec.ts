import { addLatticeVh } from '$lib/model/test/testHelpers';
/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect, beforeEach } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import type { Part } from '$lib/model/Part';
import type VirtualHelix from '$lib/model/VirtualHelix';

import { generateComplementaryDNA } from '$lib/model/sequences/sequences';

describe('Part Oligo Methods', () => {
	let testDoc: FoldnanoDocument;
	let testPart: Part;
	let vh1: VirtualHelix;
	let vh2: VirtualHelix;

	const exampleSequence = 'ACGTACGTACA';
	const reverseComplementarySequence = 'TGTACGTACGT';
	const additionalSequence = 'XXXX';

	beforeEach(() => {
		testDoc = new FoldnanoDocument();
		testDoc.addNewPart('HONEYCOMB');
		testPart = testDoc.parts[0];
		vh1 = addLatticeVh(testPart, 0, 0);
		vh2 = addLatticeVh(testPart, 0, 1);
	});

	describe('DNA utils', () => {
		it('should generate complementary DNA sequence', () => {
			const compSeq = generateComplementaryDNA(exampleSequence);
			expect(exampleSequence.length).toBe(11);
			expect(exampleSequence.length).toBe(reverseComplementarySequence.length);
			expect(compSeq).toBe(reverseComplementarySequence);
		});
	});

	describe('update own segment sequence ', () => {
		it('updates its own sequence', () => {
			const oligo1 = testPart.createOligo(vh1, 0, 10, '#ff0000');
			// const oligo2 = testPart.createOligo(vh2, 10, 0);
			const sequenceToFill = exampleSequence + additionalSequence; // length 15
			const firstSegment = oligo1.segments.values().next().value;
			const leftover = firstSegment!.updateOwnSequence(0, sequenceToFill);

			expect(firstSegment!.sequence).toBe(exampleSequence);
			expect(leftover).toBe(additionalSequence);
		});

		it('updates its own sequence from middle', () => {
			const oligo1 = testPart.createOligo(vh1, 0, 10, '#ff0000');
			const sequenceToFill = exampleSequence + additionalSequence; // length 15
			const firstSegment = oligo1.segments.values().next().value;
			const leftover = firstSegment!.updateOwnSequence(4, sequenceToFill);
			console.log('firstSegment.sequence after update:', firstSegment!.sequence);
			expect(firstSegment!.sequence).toBe('NNNNACGTACG');
			expect(leftover).toBe('TACAXXXX');
		});

		it('updates its own sequence with a shorter sequence', () => {
			const oligo1 = testPart.createOligo(vh1, 0, 10, '#ff0000');
			const sequenceToFill = 'ACGT'; // length 4
			const firstSegment = oligo1.segments.values().next().value;
			const leftover = firstSegment!.updateOwnSequence(0, sequenceToFill);

			expect(firstSegment!.sequence).toBe('ACGTNNNNNNN');
			expect(leftover).toBe('');
		});
	});

	describe('Fill in a sequence and update its complementary segments', () => {
		it('fills in sequence across segments and updates complementary segments', () => {
			const oligo1 = testPart.createOligo(vh1, 0, 10, '#ff0000');
			const oligo2 = testPart.createOligo(vh1, 10, 0);
			const sequenceToFill = exampleSequence; // length 15
			const firstSegment = oligo1.segments.values().next().value;
			firstSegment!.fillSequence(sequenceToFill);

			expect(firstSegment!.sequence).toBe(exampleSequence);
			// Check complementary segment
			const compSegment = oligo2.segments.values().next().value;
			expect(compSegment!.sequence).toBe(reverseComplementarySequence);
		});
	});
});
