import { addLatticeVh } from '$lib/model/test/testHelpers';
/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect, beforeEach } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import type { Part } from '$lib/model/Part';
import type VirtualHelix from '$lib/model/VirtualHelix';

describe('VirtualHelix Operations', () => {
	let testDoc: FoldnanoDocument;
	let testPart: Part;
	let vh: VirtualHelix;

	beforeEach(() => {
		testDoc = new FoldnanoDocument();
		testDoc.addNewPart('HONEYCOMB');
		testPart = testDoc.parts[0];
		vh = addLatticeVh(testPart, 0, 0);
	});

	describe('VirtualHelix creation and properties', () => {
		it('should create virtual helix with correct properties', () => {
			expect(vh).toBeDefined();
			expect(vh.index).toBe(0);
			expect(vh.latticeCoords!.row).toBe(0);
			expect(vh.latticeCoords!.col).toBe(0);
			expect(vh.inPart).toBe(testPart);
		});

		it('should have a unique id', () => {
			const vh2 = addLatticeVh(testPart, 1, 1);

			expect(vh.id).toBeDefined();
			expect(vh2.id).toBeDefined();
			expect(vh.id).not.toBe(vh2.id);
		});

		it('should have default length from part', () => {
			expect(vh.length).toBe(testPart.maxBase);
		});

		it('should have listRow property', () => {
			expect(typeof vh.listRow).toBe('number');
			expect(vh.listRow).toBe(0);
		});

		it('should create with two strand sets', () => {
			expect(vh.strandSets).toBeDefined();
			expect(vh.strandSets.length).toBe(2);
			expect(vh.strandSets[0].strandIndex).toBe(0);
			expect(vh.strandSets[1].strandIndex).toBe(1);
		});
	});

	describe('VirtualHelix parity', () => {
		it('should calculate even parity correctly (row % 2 === col % 2)', () => {
			const evenVh1 = addLatticeVh(testPart, 0, 0);
			const evenVh2 = addLatticeVh(testPart, 1, 1);

			expect(evenVh1.isEvenParity).toBe(true);
			expect(evenVh2.isEvenParity).toBe(true);
		});

		it('should calculate odd parity correctly (row % 2 !== col % 2)', () => {
			const oddVh1 = addLatticeVh(testPart, 0, 1);
			const oddVh2 = addLatticeVh(testPart, 1, 0);

			expect(oddVh1.isOddParity).toBe(true);
			expect(oddVh2.isOddParity).toBe(true);
		});

		it('should have opposite parity values', () => {
			const vh1 = addLatticeVh(testPart, 0, 0);
			const vh2 = addLatticeVh(testPart, 0, 1);

			expect(vh1.isEvenParity).toBe(true);
			expect(vh1.isOddParity).toBe(false);

			expect(vh2.isEvenParity).toBe(false);
			expect(vh2.isOddParity).toBe(true);
		});
	});

	describe('VirtualHelix scaffold strand', () => {
		it('should return scaffold strand set', () => {
			const scaffoldStrandSet = vh.scaffoldStrandSet;

			expect(scaffoldStrandSet).toBeDefined();
			expect(scaffoldStrandSet).toBe(vh.strandSets[vh.scaffoldStrandIndex]);
		});

		it('should identify scaffold strand index based on parity', () => {
			// vh is created at col=0, row=0 → even parity → scaffold on strand 0
			expect(vh.scaffoldStrandIndex).toBe(0);
		});

		it('should return correct scaffold strand set for different parities', () => {
			const evenVh = addLatticeVh(testPart, 0, 0); // row=0,col=0 → even parity
			const oddVh = addLatticeVh(testPart, 0, 1); // row=0,col=1 → odd parity

			expect(evenVh.scaffoldStrandIndex).toBe(0); // even parity → scaffold on strand 0
			expect(oddVh.scaffoldStrandIndex).toBe(1); // odd parity → scaffold on strand 1
		});
	});

	describe('VirtualHelix length management', () => {
		it('should get length', () => {
			expect(vh.length).toBeGreaterThan(0);
			expect(typeof vh.length).toBe('number');
		});

		it('should set length', () => {
			const initialLength = vh.length;
			const newLength = initialLength + 100;

			vh.length = newLength;

			expect(vh.length).toBe(newLength);
		});

		it('should allow decreasing length (per current implementation)', () => {
			const initialLength = vh.length;
			const newLength = initialLength - 10;

			vh.length = newLength;

			expect(vh.length).toBe(newLength);
		});

		it('should calculate used length correctly', () => {
			// Initially no segments, used length should be 0
			expect(vh.usedLength).toBe(0);
		});

		it('should calculate used length with segments', () => {
			const oligo = testPart.createOligo(vh, 0, 20, '#ff0000');

			const usedLength = vh.usedLength;

			// Used length should be at least 20 (the max index)
			expect(usedLength).toBeGreaterThanOrEqual(20);
		});

		it('should calculate used length across both strand sets', () => {
			testPart.createOligo(vh, 0, 20, '#ff0000'); // strand 0
			testPart.createOligo(vh, 30, 10, '#00ff00'); // strand 1

			const usedLength = vh.usedLength;

			// Used length should be at least 30 (max index across both strands)
			expect(usedLength).toBeGreaterThanOrEqual(30);
		});

		it('should return max used index when multiple segments exist', () => {
			testPart.createOligo(vh, 0, 10, '#ff0000');
			testPart.createOligo(vh, 15, 25, '#00ff00');
			testPart.createOligo(vh, 30, 40, '#0000ff');

			const usedLength = vh.usedLength;

			expect(usedLength).toBe(40);
		});
	});

	describe('VirtualHelix segment management', () => {
		it('should create new segment', () => {
			const segment = vh.createNewSegment(0, 10);

			expect(segment).toBeDefined();
			expect(segment.fivePrime.index).toBe(0);
			expect(segment.threePrime.index).toBe(10);
			expect(segment.inVirtualHelix).toBe(vh);
		});

		it('should add segment to correct strand set', () => {
			const segment = vh.createNewSegment(0, 10);

			expect(vh.strandSets[0].segmentIds.has(segment.id)).toBe(true);
			expect(vh.strandSets[1].segmentIds.has(segment.id)).toBe(false);
		});

		it('should create segment on strand 1 when indices reversed', () => {
			const segment = vh.createNewSegment(10, 0);

			expect(vh.strandSets[1].segmentIds.has(segment.id)).toBe(true);
			expect(vh.strandSets[0].segmentIds.has(segment.id)).toBe(false);
		});

		it('should remove segment from virtual helix', () => {
			const segment = vh.createNewSegment(0, 10);

			expect(vh.strandSets[0].segmentIds.has(segment.id)).toBe(true);

			vh.removeSegment(segment);

			expect(vh.strandSets[0].segmentIds.has(segment.id)).toBe(false);
		});

		it('should throw error when removing segment from wrong VH', () => {
			const vh2 = addLatticeVh(testPart, 1, 1);
			const segment = vh.createNewSegment(0, 10);

			expect(() => {
				vh2.removeSegment(segment);
			}).toThrow('OligoSegment does not belong to this VirtualHelix');
		});

		it('should handle multiple segments in strand set', () => {
			const segment1 = vh.createNewSegment(0, 10);
			const segment2 = vh.createNewSegment(15, 25);

			expect(vh.strandSets[0].segmentIds.size).toBe(2);
			expect(vh.strandSets[0].segmentIds.has(segment1.id)).toBe(true);
			expect(vh.strandSets[0].segmentIds.has(segment2.id)).toBe(true);
		});

		it('should maintain segment tracking after removal', () => {
			const segment1 = vh.createNewSegment(0, 10);
			const segment2 = vh.createNewSegment(15, 25);

			vh.removeSegment(segment1);

			expect(vh.strandSets[0].segmentIds.size).toBe(1);
			expect(vh.strandSets[0].segmentIds.has(segment2.id)).toBe(true);
		});

		it('should reject a duplicate explicit segment id', () => {
			const existing = vh.createNewSegment(0, 10);

			expect(() => vh.createNewSegment(15, 25, existing.id)).toThrow('already exists');
		});
	});

	describe('VirtualHelix JSON serialization', () => {
		it('should serialize to JSON', () => {
			const json = vh.toJSON();

			expect(json.id).toBe(vh.id);
			expect(json.index).toBe(vh.index);
			expect(json.listRow).toBe(vh.listRow);
			expect(json.latticeCoords).toEqual(vh.latticeCoords);
			expect(json.length).toBe(vh.length);
			expect(json.strandSets).toBeDefined();
			expect(json.strandSets.length).toBe(2);
		});

		it('should deserialize from JSON', () => {
			const json = vh.toJSON();
			const restoredVh = testPart.constructor.prototype.constructor.VirtualHelix?.fromJSON?.(
				json,
				testPart
			);

			// The actual VirtualHelix.fromJSON is a static method
			const virtualHelixConstructor = vh.constructor as typeof VirtualHelix;
			const restored = virtualHelixConstructor.fromJSON(json, testPart);

			expect(restored.id).toBe(vh.id);
			expect(restored.index).toBe(vh.index);
			expect(restored.listRow).toBe(vh.listRow);
			expect(restored.latticeCoords).toEqual(vh.latticeCoords);
			expect(restored.length).toBe(vh.length);
		});

		it('should serialize and deserialize with segments', () => {
			testPart.createOligo(vh, 0, 20, '#ff0000');

			const json = vh.toJSON();
			const virtualHelixConstructor = vh.constructor as typeof VirtualHelix;
			const restored = virtualHelixConstructor.fromJSON(json, testPart);

			expect(restored.strandSets[0].segmentIds.size).toBe(vh.strandSets[0].segmentIds.size);
		});
	});

	describe('VirtualHelix integration with Part', () => {
		it('should be accessible from Part', () => {
			expect(testPart.virtualHelices).toContain(vh);
		});

		it('should have correct index in Part', () => {
			const vh2 = addLatticeVh(testPart, 1, 1);

			expect(vh.index).toBe(0);
			expect(vh2.index).toBe(2);
		});

		it('should maintain reference to owning Part', () => {
			expect(vh.inPart).toBe(testPart);
		});
	});

	describe('VirtualHelix strand set operations', () => {
		it('should have independent strand sets', () => {
			const segment0 = vh.createNewSegment(0, 10);
			const segment1 = vh.createNewSegment(10, 0);

			expect(vh.strandSets[0].segmentIds.size).toBe(1);
			expect(vh.strandSets[1].segmentIds.size).toBe(1);
		});

		it('should track segments correctly per strand', () => {
			testPart.createOligo(vh, 0, 10, '#ff0000'); // strand 0
			testPart.createOligo(vh, 20, 10, '#00ff00'); // strand 1

			expect(vh.strandSets[0].segmentIds.size).toBe(1);
			expect(vh.strandSets[1].segmentIds.size).toBe(1);
		});
	});

	describe('VirtualHelix edge cases', () => {
		it('should handle single base segment', () => {
			expect(() => vh.createNewSegment(5, 5)).toThrowError('Segment must have > 1 length.');

			// expect(segment.fivePrime.index).toBe(5);
			// expect(segment.threePrime.index).toBe(5);
			// expect(vh.strandSets[0].segmentIds.has(segment.id)).toBe(true);
		});

		it('should handle full-length segment', () => {
			const segment = vh.createNewSegment(0, vh.length - 1);

			expect(segment.fivePrime.index).toBe(0);
			expect(segment.threePrime.index).toBe(vh.length - 1);
		});

		it('should update used length when segments are removed', () => {
			const oligo = testPart.createOligo(vh, 0, 40, '#ff0000');
			expect(vh.usedLength).toBe(40);

			testPart.removeOligo(oligo);

			expect(vh.usedLength).toBe(0);
		});
	});

	describe('VirtualHelix listRow invariant', () => {
		it('should keep listRow === array index after adding VHs', () => {
			const vh2 = addLatticeVh(testPart, 1, 0);
			const vh3 = addLatticeVh(testPart, 2, 0);

			for (const [i, v] of testPart.virtualHelices.entries()) {
				expect(v.listRow).toBe(i);
			}
		});

		it('should keep listRow === array index after reorder', () => {
			const vh2 = addLatticeVh(testPart, 1, 0);
			const vh3 = addLatticeVh(testPart, 2, 0);

			// Move the first VH to position 2
			testPart.reorderVirtualHelix(vh.index, 2);

			for (const [i, v] of testPart.virtualHelices.entries()) {
				expect(v.listRow).toBe(i);
			}
		});

		it('should move VH to correct position in array after reorder', () => {
			const vh2 = addLatticeVh(testPart, 1, 0);
			const vh3 = addLatticeVh(testPart, 2, 0);

			const origIdx = vh.index;
			testPart.reorderVirtualHelix(origIdx, 2);

			// Moved VH should now be at array index 2
			expect(testPart.virtualHelices[2]).toBe(vh);
			expect(testPart.virtualHelices[2].listRow).toBe(2);
		});

		it('should find segments via spatial index after reorder', () => {
			const vh2 = addLatticeVh(testPart, 1, 0);
			testPart.createOligo(vh, 0, 10, '#ff0000');

			const beforeRow = vh.listRow;
			testPart.reorderVirtualHelix(vh.index, 2);
			const afterRow = vh.listRow;

			expect(afterRow).not.toBe(beforeRow);
			expect(testPart.getEntitiesAt(afterRow, 0, 5).segment).not.toBeNull();
			expect(testPart.getEntitiesAt(beforeRow, 0, 5).segment).toBeNull();
			expect(testPart.getEntitiesAtVh(vh.id, 0, 5).segment).not.toBeNull();
		});
	});

	describe('VirtualHelix with multiple helices', () => {
		it('should maintain independence from other VHs', () => {
			const vh2 = addLatticeVh(testPart, 1, 1);

			const segment1 = vh.createNewSegment(0, 10);
			const segment2 = vh2.createNewSegment(0, 10);

			expect(vh.strandSets[0].segmentIds.has(segment1.id)).toBe(true);
			expect(vh.strandSets[0].segmentIds.has(segment2.id)).toBe(false);

			expect(vh2.strandSets[0].segmentIds.has(segment2.id)).toBe(true);
			expect(vh2.strandSets[0].segmentIds.has(segment1.id)).toBe(false);
		});

		it('should have different used lengths', () => {
			const vh2 = addLatticeVh(testPart, 1, 1);

			testPart.createOligo(vh, 0, 20, '#ff0000');
			testPart.createOligo(vh2, 0, 30, '#00ff00');

			expect(vh.usedLength).toBe(20);
			expect(vh2.usedLength).toBe(30);
		});
	});
});
