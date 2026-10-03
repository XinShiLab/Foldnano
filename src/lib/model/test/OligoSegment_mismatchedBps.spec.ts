import { addLatticeVh } from '$lib/model/test/testHelpers';
import { describe, it, expect, beforeEach } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import type { Part } from '$lib/model/Part';
import type VirtualHelix from '$lib/model/VirtualHelix';
import type Oligo from '$lib/model/Oligo';
import type { OligoSegment } from '$lib/model/Oligo';

describe('OligoSegment.mismatchedBps', () => {
	let testDoc: FoldnanoDocument;
	let testPart: Part;
	let vh: VirtualHelix;

	beforeEach(() => {
		testDoc = new FoldnanoDocument();
		testDoc.addNewPart('HONEYCOMB');
		testPart = testDoc.parts[0];
		vh = addLatticeVh(testPart, 0, 0);
	});

	function createDuplexOligo(
		start = 0,
		end = 10
	): { oligo: Oligo; segment: OligoSegment; compSegment: OligoSegment } {
		const oligo = testPart.createOligo(vh, start, end, '#ff0000');
		const compOligo = testPart.createOligo(vh, end, start, '#00ff00');
		return {
			oligo,
			segment: oligo.segments.values().next().value!,
			compSegment: compOligo.segments.values().next().value!,
		};
	}

	it('reports no mismatch when both sides are unassigned (N)', () => {
		const { segment } = createDuplexOligo();
		expect(segment.mismatchedBps()).toEqual([]);
	});

	it('reports no mismatch when only one side is assigned', () => {
		const { segment } = createDuplexOligo();
		segment.slotForBp(4)!.seq = 'A';
		expect(segment.mismatchedBps()).toEqual([]);
	});

	it('reports no mismatch when both sides are assigned and complementary', () => {
		const { segment, compSegment } = createDuplexOligo();
		segment.slotForBp(4)!.seq = 'A';
		compSegment.slotForBp(4)!.seq = 'T';
		expect(segment.mismatchedBps()).toEqual([]);
	});

	it('reports a mismatch when both sides are assigned and non-complementary', () => {
		const { segment, compSegment } = createDuplexOligo();
		segment.slotForBp(4)!.seq = 'A';
		compSegment.slotForBp(4)!.seq = 'A';
		expect(segment.mismatchedBps()).toEqual([4]);
	});

	it('reports every mismatched bp, not just the first', () => {
		const { segment, compSegment } = createDuplexOligo();
		segment.slotForBp(2)!.seq = 'G';
		compSegment.slotForBp(2)!.seq = 'G';
		segment.slotForBp(4)!.seq = 'A';
		compSegment.slotForBp(4)!.seq = 'T'; // matches, should not appear
		segment.slotForBp(6)!.seq = 'C';
		compSegment.slotForBp(6)!.seq = 'A';
		expect(segment.mismatchedBps()).toEqual([2, 6]);
	});

	it('excludes skip slots even when the complementary base is assigned', () => {
		const { segment, compSegment } = createDuplexOligo();
		segment.slotForBp(4)!.seq = '';
		compSegment.slotForBp(4)!.seq = 'A';
		expect(segment.mismatchedBps()).toEqual([]);
	});

	it('excludes insertion slots even when the complementary base is assigned', () => {
		const { segment, compSegment } = createDuplexOligo();
		segment.slotForBp(4)!.seq = 'AAA';
		compSegment.slotForBp(4)!.seq = 'A';
		expect(segment.mismatchedBps()).toEqual([]);
	});
});
