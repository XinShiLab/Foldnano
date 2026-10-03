import { addLatticeVh } from '$lib/model/test/testHelpers';
/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect, beforeEach } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import type { Part } from '$lib/model/Part';
import type VirtualHelix from '$lib/model/VirtualHelix';
import type Oligo from '$lib/model/Oligo';
import type { OligoSegment } from '$lib/model/Oligo';

describe('OligoSegment Slot System', () => {
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

	describe('Slot initialization', () => {
		it('should initialize slots from indices', () => {
			const oligo = testPart.createOligo(vh, 0, 10, '#ff0000');
			const segment = oligo.segments.values().next().value!;

			expect(segment.slots).toBeDefined();
			expect(segment.slots.length).toBeGreaterThan(0);
			expect(segment.backboneLength).toBe(11); // 0-10 inclusive
		});

		it('should create slots for each backbone position', () => {
			const oligo = testPart.createOligo(vh, 5, 15, '#ff0000');
			const segment = oligo.segments.values().next().value!;

			// Should have slot for each bp from 5 to 15
			expect(segment.backboneLength).toBe(11);
			expect(segment.slots[0].bpIndex).toBe(5);
			expect(segment.slots[10].bpIndex).toBe(15);
		});

		it('should initialize slots with default sequence (N)', () => {
			const oligo = testPart.createOligo(vh, 0, 5, '#ff0000');
			const segment = oligo.segments.values().next().value!;

			for (const slot of segment.slots) {
				expect(slot.seq).toBe('N');
			}
		});

		it('should order slots correctly for strand 0 (ascending)', () => {
			const oligo = testPart.createOligo(vh, 0, 10, '#ff0000');
			const segment = oligo.segments.values().next().value!;

			for (let i = 0; i < segment.slots.length - 1; i++) {
				expect(segment.slots[i].bpIndex).toBeLessThan(segment.slots[i + 1].bpIndex);
			}
		});

		it('should order slots correctly for strand 1 (descending)', () => {
			const oligo = testPart.createOligo(vh, 10, 0, '#ff0000');
			const segment = oligo.segments.values().next().value!;

			for (let i = 0; i < segment.slots.length - 1; i++) {
				expect(segment.slots[i].bpIndex).toBeGreaterThan(segment.slots[i + 1].bpIndex);
			}
		});
	});

	describe('Slot sequence operations', () => {
		it('should get slot sequence at bp index', () => {
			const oligo = testPart.createOligo(vh, 0, 10, '#ff0000');
			const segment = oligo.segments.values().next().value!;

			expect(segment.slotSeq(0)).toBe('N');
			expect(segment.slotSeq(5)).toBe('N');
			expect(segment.slotSeq(10)).toBe('N');
		});

		it('should return empty string for non-existent bp index', () => {
			const oligo = testPart.createOligo(vh, 5, 15, '#ff0000');
			const segment = oligo.segments.values().next().value!;

			expect(segment.slotSeq(0)).toBe('');
			expect(segment.slotSeq(20)).toBe('');
		});

		it('should assign sequence across slots', () => {
			const oligo = testPart.createOligo(vh, 0, 10, '#ff0000');
			const segment = oligo.segments.values().next().value!;

			oligo.fillSequence('AAAAAAAAAAA');

			expect(segment.sequence).toBe('AAAAAAAAAAA');
			expect(segment.slotSeq(0)).toBe('A');
			expect(segment.slotSeq(5)).toBe('A');
		});

		it('should calculate total nucleotides correctly', () => {
			const oligo = testPart.createOligo(vh, 0, 10, '#ff0000');
			const segment = oligo.segments.values().next().value!;

			expect(segment.totalNucleotides).toBe(11);
			expect(segment.length).toBe(11);
		});

		it('should calculate backbone length vs nucleotide length', () => {
			const oligo = testPart.createOligo(vh, 0, 10, '#ff0000');
			const segment = oligo.segments.values().next().value!;

			// Before modifications, they're equal
			expect(segment.backboneLength).toBe(11);
			expect(segment.totalNucleotides).toBe(11);
		});
	});

	describe('Skip operations', () => {
		it('should add skip at specified index', () => {
			const { segment } = createDuplexOligo();

			segment.addSkipOrInsertion(5, -1);

			expect(segment.slotSeq(5)).toBe('');
			expect(segment.backboneLength).toBe(11); // Same backbone positions
			expect(segment.totalNucleotides).toBe(10); // One less nucleotide
		});

		it('should include skip in skipsAndInserts property', () => {
			const { segment } = createDuplexOligo();

			segment.addSkipOrInsertion(5, -1);

			const skips = segment.skipsAndInserts;
			expect(skips).toContainEqual([5, -1]);
		});

		it('should remove skip correctly', () => {
			const { segment } = createDuplexOligo();

			segment.addSkipOrInsertion(5, -1);
			expect(segment.slotSeq(5)).toBe('');

			segment.removeSkipOrInsertion(5);
			expect(segment.slotSeq(5)).toBe('N');
			expect(segment.totalNucleotides).toBe(11);
		});

		it('should not add duplicate skip', () => {
			const { segment } = createDuplexOligo();

			segment.addSkipOrInsertion(5, -1);
			expect(segment.slotSeq(5)).toBe('');

			// Duplicate skip throws — slot is already modified
			expect(() => segment.addSkipOrInsertion(5, -1)).toThrow();
			expect(segment.slotSeq(5)).toBe('');
		});

		it('should propagate skip to complementary segment', () => {
			const oligo1 = testPart.createOligo(vh, 0, 10, '#ff0000');
			const oligo2 = testPart.createOligo(vh, 10, 0, '#00ff00');

			const segment1 = oligo1.segments.values().next().value!;

			segment1.addSkipOrInsertion(5, -1);

			// Check complementary segment
			const { segment: compSegment } = testPart.getEntitiesAt(vh.listRow, 1, 5);
			if (compSegment) {
				expect(compSegment.slotSeq(5)).toBe('');
			}
		});
	});

	describe('Insertion operations', () => {
		it('should add insertion at specified index', () => {
			const { segment } = createDuplexOligo();

			segment.addSkipOrInsertion(5, 2); // Add 2 insertions

			const slotSeq = segment.slotSeq(5);
			expect(slotSeq.length).toBe(3); // Original + 2 insertions
			expect(segment.backboneLength).toBe(11);
			expect(segment.totalNucleotides).toBe(13);
		});

		it('should include insertion in skipsAndInserts property', () => {
			const { segment } = createDuplexOligo();

			segment.addSkipOrInsertion(5, 2);

			const insertions = segment.skipsAndInserts;
			expect(insertions).toContainEqual([5, 2]);
		});

		it('should remove insertion correctly', () => {
			const { segment } = createDuplexOligo();

			segment.addSkipOrInsertion(5, 2);
			expect(segment.slotSeq(5).length).toBe(3);

			segment.removeSkipOrInsertion(5);
			expect(segment.slotSeq(5).length).toBe(1);
			expect(segment.totalNucleotides).toBe(11);
		});

		it("cumulative insertion: second call appends more N's", () => {
			const { segment } = createDuplexOligo();

			segment.addSkipOrInsertion(5, 2);
			const length1 = segment.slotSeq(5).length; // 3 (1 backbone + 2 insert)

			// Second call is cumulative — appends 2 more N's
			segment.addSkipOrInsertion(5, 2);
			const length2 = segment.slotSeq(5).length; // 5

			expect(length2).toBe(length1 + 2);
		});

		it('should propagate insertion to complementary segment', () => {
			const oligo1 = testPart.createOligo(vh, 0, 10, '#ff0000');
			const oligo2 = testPart.createOligo(vh, 10, 0, '#00ff00');

			const segment1 = oligo1.segments.values().next().value!;

			segment1.addSkipOrInsertion(5, 2);

			// Check complementary segment
			const { segment: compSegment } = testPart.getEntitiesAt(vh.listRow, 1, 5);
			if (compSegment) {
				expect(compSegment.slotSeq(5).length).toBe(3);
			}
		});
	});

	describe('Legacy skipsAndInserts conversion', () => {
		it('should convert to legacy format', () => {
			const { segment } = createDuplexOligo();

			segment.addSkipOrInsertion(3, -1); // skip
			segment.addSkipOrInsertion(7, 1); // insertion

			const legacy = segment.skipsAndInserts;

			expect(legacy).toContainEqual([3, -1]);
			expect(legacy).toContainEqual([7, 1]);
			expect(legacy.length).toBe(2);
		});

		it('should set from legacy format', () => {
			const oligo = testPart.createOligo(vh, 0, 10, '#ff0000');
			const segment = oligo.segments.values().next().value!;

			segment.skipsAndInserts = [
				[3, -1],
				[7, 2],
			];

			expect(segment.slotSeq(3)).toBe('');
			expect(segment.slotSeq(7).length).toBe(3);
		});

		it('should reset existing modifications when setting legacy format', () => {
			const { segment } = createDuplexOligo();

			segment.addSkipOrInsertion(5, -1);
			expect(segment.slotSeq(5)).toBe('');

			// Setting new legacy format should reset
			segment.skipsAndInserts = [[3, -1]];

			expect(segment.slotSeq(5).length).toBe(1); // Reset to normal
			expect(segment.slotSeq(3)).toBe(''); // New skip
		});
	});

	describe('Slot distribution during break', () => {
		it('should distribute slots correctly when breaking segment', () => {
			const oligo = testPart.createOligo(vh, 0, 10, '#ff0000');
			const segment = oligo.segments.values().next().value!;

			oligo.fillSequence('AAAAAAAAAAA');

			const newSegment = segment.breakSegmentAt(5);

			expect(segment.backboneLength).toBe(6); // 0-5
			expect(newSegment?.backboneLength).toBe(5); // 6-10
		});

		it('should preserve slots with modifications during break', () => {
			const { segment } = createDuplexOligo();

			segment.addSkipOrInsertion(3, -1);
			segment.addSkipOrInsertion(7, 2);

			const newSegment = segment.breakSegmentAt(5);

			// First segment should have skip at 3
			expect(segment.slotSeq(3)).toBe('');
			// Second segment should have insertion at 7
			expect(newSegment?.slotSeq(7).length).toBe(3);
		});
	});

	describe('Index mapping', () => {
		it('should map bp index to sequence index', () => {
			const oligo = testPart.createOligo(vh, 0, 10, '#ff0000');
			const segment = oligo.segments.values().next().value!;

			oligo.fillSequence('AAAAAAAAAAA');

			const seqIndices = segment.fromBpIdxToSeqIdx(0);
			expect(seqIndices).toContain(0);

			const seqIndices5 = segment.fromBpIdxToSeqIdx(5);
			expect(seqIndices5).toContain(5);
		});

		it('should return -1 for skipped positions', () => {
			const { segment } = createDuplexOligo();

			segment.addSkipOrInsertion(5, -1);

			const seqIndices = segment.fromBpIdxToSeqIdx(5);
			expect(seqIndices).toEqual([-1]);
		});

		it('should return multiple indices for insertions', () => {
			const { oligo, segment } = createDuplexOligo();

			oligo.fillSequence('AAAAAAAAAAA');
			segment.addSkipOrInsertion(5, 2);

			const seqIndices = segment.fromBpIdxToSeqIdx(5);
			expect(seqIndices.length).toBe(3); // Original + 2 insertions
		});
	});

	describe('Slot takeover during merge', () => {
		it('should take over slots from another segment', () => {
			const oligo1 = testPart.createOligo(vh, 0, 10, '#ff0000');
			const oligo2 = testPart.createOligo(vh, 11, 20, '#00ff00');

			const segment1 = oligo1.segments.values().next().value!;
			const segment2 = oligo2.segments.values().next().value!;

			oligo1.fillSequence('AAAAAAAAAAA');
			oligo2.fillSequence('TTTTTTTTTTT');

			// Merge segment1's 3' to segment2's 5'
			segment1.threePrime.mergeTo(segment2.fivePrime);

			// segment1 should now have slots from both
			expect(segment1.backboneLength).toBeGreaterThan(11);
			expect(segment1.sequence).toContain('A');
			expect(segment1.sequence).toContain('T');
		});
	});

	describe('Complementary sequence propagation', () => {
		it('should fill Ns from complementary segment', () => {
			const oligo1 = testPart.createOligo(vh, 0, 10, '#ff0000');
			const oligo2 = testPart.createOligo(vh, 10, 0, '#00ff00');

			oligo1.fillSequence('AAAAAAAAAAA'); // 11 chars for 0-10 inclusive

			const segment2 = oligo2.segments.values().next().value!;

			// Fill complementary from opposite strand
			segment2.fillNsFromComplementary?.();

			// segment2 should now have complementary sequence (Ts)
			expect(segment2.sequence).toContain('TTTTTTTTTT');
		});
	});

	describe('Slot JSON serialization', () => {
		it('should serialize slots to JSON', () => {
			const { oligo, segment } = createDuplexOligo();

			oligo.fillSequence('AAAAAAAAAAA');
			segment.addSkipOrInsertion(5, -1);

			const json = segment.toJSON();

			expect(json.slots).toBeDefined();
			expect(json.slots.length).toBe(11);
			expect(json.slots.some((s: { seq: string }) => s.seq === '')).toBe(true);
		});

		it('should deserialize slots from JSON', () => {
			const { oligo, segment } = createDuplexOligo();

			oligo.fillSequence('AAAAAAAAAAA');
			segment.addSkipOrInsertion(5, -1);
			segment.addSkipOrInsertion(7, 2);

			const json = segment.toJSON();
			const expectedBackboneLength = segment.backboneLength;
			testPart.removeOligo(oligo);
			const restored = (segment.constructor as typeof OligoSegment).fromJSON(json, testPart);

			expect(restored.backboneLength).toBe(expectedBackboneLength);
			expect(restored.slotSeq(5)).toBe('');
			expect(restored.slotSeq(7).length).toBe(3);
		});
	});

	describe('Edge cases', () => {
		it('should handle empty slot sequence', () => {
			const { segment } = createDuplexOligo();

			segment.addSkipOrInsertion(0, -1);
			expect(segment.slotSeq(0)).toBe('');
			expect(segment.totalNucleotides).toBe(10);
		});

		it('should handle multiple insertions at same position', () => {
			const { segment } = createDuplexOligo();

			segment.addSkipOrInsertion(5, 5); // 5 insertions

			expect(segment.slotSeq(5).length).toBe(6);
			expect(segment.totalNucleotides).toBe(16);
		});

		it('should handle segment with all skips', () => {
			const { segment } = createDuplexOligo(0, 5);

			for (let i = 0; i <= 5; i++) {
				segment.addSkipOrInsertion(i, -1);
			}

			expect(segment.totalNucleotides).toBe(0);
			expect(segment.backboneLength).toBe(6);
		});
	});
});
