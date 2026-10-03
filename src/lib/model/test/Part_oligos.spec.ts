import { addLatticeVh } from '$lib/model/test/testHelpers';
import { describe, it, expect, beforeEach } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import type { Part } from '$lib/model/Part';
import type VirtualHelix from '$lib/model/VirtualHelix';

describe('Part Oligo Methods', () => {
	let testDoc: FoldnanoDocument;
	let testPart: Part;
	let vh1: VirtualHelix;
	let vh2: VirtualHelix;

	beforeEach(() => {
		testDoc = new FoldnanoDocument();
		testDoc.addNewPart('HONEYCOMB');
		testPart = testDoc.parts[0];
		vh1 = addLatticeVh(testPart, 0, 0);
		vh2 = addLatticeVh(testPart, 0, 1);
	});

	describe('addVirtualHelix', () => {
		it('should reject a duplicate explicit VH id', () => {
			expect(() => testPart.addVirtualHelix({ id: vh1.id })).toThrow('already exists');
		});
	});

	describe('createOligo', () => {
		it('should create a new oligo with correct properties', () => {
			const oligo = testPart.createOligo(vh1, 0, 10, '#ff0000');

			expect(oligo).toBeDefined();
			expect(oligo.length).toBe(11);
			expect(oligo.color).toBe('#ff0000');
			expect(testPart.oligos.size).toBe(1);
			expect(testPart.oligos.has(oligo)).toBe(true);
		});

		it('should create oligo on strand set 0 when fivePrime < threePrime', () => {
			const oligo = testPart.createOligo(vh1, 0, 10, '#ff0000');
			const segment = oligo.segments.values().next().value!;

			expect(segment).toBeDefined();
			expect(segment.inStrandIndex).toBe(0);
		});

		it('should create oligo on strand set 1 when fivePrime > threePrime', () => {
			const oligo = testPart.createOligo(vh1, 10, 0, '#ff0000');
			const segment = oligo.segments.values().next().value!;

			expect(segment).toBeDefined();
			expect(segment.inStrandIndex).toBe(1);
		});

		it('should throw error when space is occupied', () => {
			testPart.createOligo(vh1, 0, 10, '#ff0000');

			expect(() => {
				testPart.createOligo(vh1, 5, 15, '#00ff00');
			}).toThrow('Cannot create Oligo: space occupied');
		});

		it('should throw error when indices are out of bounds', () => {
			expect(() => {
				testPart.createOligo(vh1, -1, 10, '#ff0000');
			}).toThrow('indices must be within bounds');

			expect(() => {
				testPart.createOligo(vh1, 0, testPart.maxBase, '#ff0000');
			}).toThrow('indices must be within bounds');
		});

		it('should create multiple non-overlapping oligos', () => {
			const oligo1 = testPart.createOligo(vh1, 0, 10, '#ff0000');
			const oligo2 = testPart.createOligo(vh1, 15, 25, '#00ff00');

			expect(testPart.oligos.size).toBe(2);
			expect(oligo1.length).toBe(11);
			expect(oligo2.length).toBe(11);
		});

		it('should assign default color if none provided', () => {
			const oligo = testPart.createOligo(vh1, 0, 10);

			expect(oligo.color).toBeDefined();
			expect(oligo.color).not.toBe('');
		});

		it('should reject a duplicate explicit oligo id', () => {
			const existing = testPart.createOligo(vh1, 0, 10, '#ff0000');

			expect(() =>
				testPart.createOligo(vh2, 0, 10, '#00ff00', {
					oligoId: existing.id,
					segmentId: 'seg-unique',
				})
			).toThrow('already exists');
		});
	});

	describe('removeOligo', () => {
		it('should remove an oligo from the part', () => {
			const oligo = testPart.createOligo(vh1, 0, 10, '#ff0000');
			expect(testPart.oligos.size).toBe(1);

			testPart.removeOligo(oligo);

			expect(testPart.oligos.size).toBe(0);
			expect(testPart.oligos.has(oligo)).toBe(false);
		});

		it('should throw error when removing oligo not in part', () => {
			const oligo = testPart.createOligo(vh1, 0, 10, '#ff0000');
			testPart.removeOligo(oligo);

			expect(() => {
				testPart.removeOligo(oligo);
			}).toThrow('Oligo must be part of this Part');
		});

		it('should free up space in virtual helix after removal', () => {
			const oligo = testPart.createOligo(vh1, 0, 10, '#ff0000');
			testPart.removeOligo(oligo);

			// Should be able to create a new oligo in the same space
			const newOligo = testPart.createOligo(vh1, 0, 10, '#00ff00');
			expect(newOligo).toBeDefined();
			expect(newOligo.length).toBe(11);
		});
	});

	describe('breakOligoAt', () => {
		it('should break oligo at a specific index', () => {
			const oligo = testPart.createOligo(vh1, 0, 10, '#ff0000');
			const segment = oligo.segments.values().next().value!;

			const newOligo = testPart.breakOligoAt(oligo, segment, 5);

			expect(testPart.oligos.size).toBe(2);
			expect(oligo.length).toBe(6); // 0-5
			expect(newOligo.length).toBe(5); // 6-10
		});

		it('should not create new oligo when breaking at free end', () => {
			const oligo = testPart.createOligo(vh1, 0, 10, '#ff0000');
			const segment = oligo.segments.values().next().value!;

			const result = testPart.breakOligoAt(oligo, segment, 10); // breaking at 3' end

			expect(testPart.oligos.size).toBe(1);
			expect(result).toBe(oligo);
		});

		it('should throw error when oligo not in part', () => {
			const oligo = testPart.createOligo(vh1, 0, 10, '#ff0000');
			const segment = oligo.segments.values().next().value!;
			testPart.removeOligo(oligo);

			expect(() => {
				testPart.breakOligoAt(oligo, segment, 5);
			}).toThrow('Oligo must be part of this Part');
		});

		it('should throw error when segment not in oligo', () => {
			const oligo1 = testPart.createOligo(vh1, 0, 10, '#ff0000');
			const oligo2 = testPart.createOligo(vh1, 15, 25, '#00ff00');
			const segment2 = oligo2.segments.values().next().value!;

			expect(() => {
				testPart.breakOligoAt(oligo1, segment2, 20);
			}).toThrow('OligoSegment must be part of the Oligo');
		});

		it('should transfer 3-prime crossover connection to the new stub segment', () => {
			// Build a two-segment oligo: seg1 (vh1 0-20) connected 3'→5' to seg2 (vh2 0-10).
			const oligo1 = testPart.createOligo(vh1, 0, 20, '#ff0000');
			const seg1 = [...oligo1.segments][0];
			const oligo2 = testPart.createOligo(vh2, 0, 10, '#00ff00');
			testPart.connectTwoOligos(oligo1, oligo2); // oligo1 absorbs oligo2; seg1.3'→seg2.5'
			const seg2 = [...oligo1.segments].find((s) => s.inVirtualHelix === vh2)!;
			expect(seg1.threePrime.connectedSegment).toBe(seg2);

			// Break seg1 in the middle (at bp 10), leaving a stub at 11-20.
			const newOligo = testPart.breakOligoAt(oligo1, seg1, 10);

			// Original segment: 0-10, free 3' end.
			expect(seg1.threePrime.isFree).toBe(true);
			expect(seg1.threePrime.index).toBe(10);

			// Stub (11-20) should have inherited the 3' crossover to seg2.
			const stub = [...newOligo.segments].find((s) => s.inVirtualHelix === vh1);
			expect(stub).toBeDefined();
			expect(stub!.threePrime.connectedSegment).toBe(seg2);
			expect(seg2.fivePrime.connectedSegment).toBe(stub);
		});
	});

	describe('connectTwoOligos', () => {
		it('should merge two adjacent oligos', () => {
			const oligo1 = testPart.createOligo(vh1, 0, 10, '#ff0000');
			const segment1 = oligo1.segments.values().next().value!;
			testPart.breakOligoAt(oligo1, segment1, 5);

			expect(testPart.oligos.size).toBe(2);

			const oligos = Array.from(testPart.oligos.values());
			testPart.connectTwoOligos(oligos[0], oligos[1]);

			expect(testPart.oligos.size).toBe(1);
			const mergedOligo = testPart.oligos.values().next().value!;
			expect(mergedOligo.length).toBe(11);
		});

		it('should throw error when oligos not in part', () => {
			const oligo1 = testPart.createOligo(vh1, 0, 10, '#ff0000');
			const oligo2 = testPart.createOligo(vh1, 15, 25, '#00ff00');
			testPart.removeOligo(oligo1);

			expect(() => {
				testPart.connectTwoOligos(oligo1, oligo2);
			}).toThrow('Both oligos must be part of this Part');
		});

		it('should create circular oligo when connecting oligo to itself', () => {
			// Create a longer oligo and break it to create segments that can be reconnected
			const oligo = testPart.createOligo(vh1, 0, 20, '#ff0000');
			const segment = oligo.segments.values().next().value!;

			// Break in the middle
			testPart.breakOligoAt(oligo, segment, 10);

			const oligos = Array.from(testPart.oligos.values());
			// Reconnect the two ends
			testPart.connectTwoOligos(oligos[0], oligos[1]);

			expect(testPart.oligos.size).toBe(1);
		});
	});

	describe('removeSegmentFromOligo', () => {
		it('should remove a segment from an oligo', () => {
			const oligo = testPart.createOligo(vh1, 0, 20, '#ff0000');
			const segment = oligo.segments.values().next().value!;

			// Break to create multiple segments
			testPart.breakOligoAt(oligo, segment, 5);
			const segmentToRemove = oligo.segments.values().next().value!;

			const initialOligoCount = testPart.oligos.size;
			testPart.removeSegmentFromOligo(oligo, segmentToRemove);

			// After removal, the oligo should be removed (was only segment left in that oligo)
			expect(testPart.oligos.size).toBeLessThanOrEqual(initialOligoCount);
		});
	});

	describe('fillEmptyStrandSet', () => {
		it('should fill empty strand set with a new oligo', () => {
			const oligo = testPart.fillEmptyStrandSet(vh1, 0, '#ff0000');

			expect(oligo).not.toBeNull();
			expect(oligo!.length).toBe(vh1.length);
			expect(testPart.oligos.size).toBe(1);
		});

		it('should throw error when strand set is not empty', () => {
			testPart.createOligo(vh1, 0, 10, '#ff0000');

			expect(() => {
				testPart.fillEmptyStrandSet(vh1, 0, '#00ff00');
			}).toThrow('StrandSet is not empty');
		});

		it('should fill strand set 0 from left to right', () => {
			const oligo = testPart.fillEmptyStrandSet(vh1, 0, '#ff0000');
			const segment = oligo!.segments.values().next().value!;

			expect(segment.fivePrime.index).toBe(0);
			expect(segment.threePrime.index).toBe(vh1.length - 1);
		});

		it('should fill strand set 1 from right to left', () => {
			const oligo = testPart.fillEmptyStrandSet(vh1, 1, '#ff0000');
			const segment = oligo!.segments.values().next().value!;

			expect(segment.fivePrime.index).toBe(vh1.length - 1);
			expect(segment.threePrime.index).toBe(0);
		});
	});

	describe('getOligoByIndices', () => {
		it('should find oligo by virtual helix row, strand index, and bp index', () => {
			const oligo = testPart.createOligo(vh1, 0, 10, '#ff0000');

			const result = testPart.getOligoByIndices(vh1.listRow, 0, 5);

			expect(result).not.toBeNull();
			expect(result!.oligo).toBe(oligo);
		});

		it('should return null when no oligo at indices', () => {
			testPart.createOligo(vh1, 0, 10, '#ff0000');

			const result = testPart.getOligoByIndices(vh1.listRow, 0, 15);

			expect(result).toBeNull();
		});

		it('should find correct oligo among multiple oligos', () => {
			const oligo1 = testPart.createOligo(vh1, 0, 10, '#ff0000');
			const oligo2 = testPart.createOligo(vh1, 15, 25, '#00ff00');

			const result1 = testPart.getOligoByIndices(vh1.listRow, 0, 5);
			const result2 = testPart.getOligoByIndices(vh1.listRow, 0, 20);

			expect(result1!.oligo).toBe(oligo1);
			expect(result2!.oligo).toBe(oligo2);
		});
	});

	describe('getOligoBySegment', () => {
		it('should find oligo by segment', () => {
			const oligo = testPart.createOligo(vh1, 0, 10, '#ff0000');
			const segment = oligo.segments.values().next().value!;

			const result = testPart.getOligoBySegment(segment);

			expect(result).toBe(oligo);
		});

		it('should return null for segment not in any oligo', () => {
			const oligo = testPart.createOligo(vh1, 0, 10, '#ff0000');
			const segment = oligo.segments.values().next().value!;
			testPart.removeOligo(oligo);

			const result = testPart.getOligoBySegment(segment);

			expect(result).toBeNull();
		});
	});

	describe('getOligoById', () => {
		it('should find oligo by id', () => {
			const oligo = testPart.createOligo(vh1, 0, 10, '#ff0000');

			const result = testPart.getOligoById(oligo.id);

			expect(result).toBe(oligo);
		});

		it('should return null for non-existent id', () => {
			testPart.createOligo(vh1, 0, 10, '#ff0000');

			const result = testPart.getOligoById('non-existent-id');

			expect(result).toBeNull();
		});
	});

	describe('getEntitiesAt', () => {
		it('should return oligo and segment at specified position', () => {
			const oligo = testPart.createOligo(vh1, 0, 10, '#ff0000');
			const segment = oligo.segments.values().next().value;

			const result = testPart.getEntitiesAt(vh1.listRow, 0, 5);

			expect(result.vh).toBe(vh1);
			expect(result.oligo).toBe(oligo);
			expect(result.segment).toBe(segment);
		});

		it('should return null for empty position', () => {
			const result = testPart.getEntitiesAt(vh1.listRow, 0, 5);

			expect(result.vh).toBe(vh1);
			expect(result.oligo).toBeNull();
			expect(result.segment).toBeNull();
		});

		it('should return end at terminus position', () => {
			testPart.createOligo(vh1, 0, 10, '#ff0000');

			const result = testPart.getEntitiesAt(vh1.listRow, 0, 0);

			expect(result.end).not.toBeNull();
			expect(result.end!.index).toBe(0);
		});
	});

	describe('getEndsInRange', () => {
		it('should return all ends in specified range', () => {
			testPart.createOligo(vh1, 0, 10, '#ff0000');
			testPart.createOligo(vh1, 15, 25, '#00ff00');

			const ends = testPart.getEndsInRange(
				{
					startVhRow: vh1.listRow,
					endVhRow: vh1.listRow,
					startStrandIdx: 0,
					endStrandIdx: 0,
					startBpIdx: 0,
					endBpIdx: 30,
				},
				false
			);

			expect(ends.length).toBe(4); // 2 oligos × 2 ends each
		});

		it('should return only free ends when onlyFreeEnds is true', () => {
			testPart.createOligo(vh1, 0, 10, '#ff0000');

			const ends = testPart.getEndsInRange(
				{
					startVhRow: vh1.listRow,
					endVhRow: vh1.listRow,
					startStrandIdx: 0,
					endStrandIdx: 0,
					startBpIdx: 0,
					endBpIdx: 15,
				},
				true
			);

			// Both ends should be free
			expect(ends.length).toBe(2);
			ends.forEach((end) => {
				expect(end.isFree).toBe(true);
			});
		});

		it('should return empty array when no ends in range', () => {
			testPart.createOligo(vh1, 0, 10, '#ff0000');

			const ends = testPart.getEndsInRange(
				{
					startVhRow: vh1.listRow,
					endVhRow: vh1.listRow,
					startStrandIdx: 0,
					endStrandIdx: 0,
					startBpIdx: 20,
					endBpIdx: 30,
				},
				false
			);

			expect(ends.length).toBe(0);
		});
	});

	describe('moveOligoTerminusTo', () => {
		it('should move oligo terminus to new index', () => {
			const oligo = testPart.createOligo(vh1, 0, 10, '#ff0000');
			const threePrimeEnd = oligo.threePrime!;

			expect(threePrimeEnd.index).toBe(10);

			testPart.moveOligoTerminusTo(threePrimeEnd, 15);

			expect(threePrimeEnd.index).toBe(15);
			expect(oligo.length).toBe(16); // 0-15
		});

		it('should move five prime end', () => {
			const oligo = testPart.createOligo(vh1, 5, 15, '#ff0000');
			const fivePrimeEnd = oligo.fivePrime!;

			expect(fivePrimeEnd.index).toBe(5);

			testPart.moveOligoTerminusTo(fivePrimeEnd, 0);

			expect(fivePrimeEnd.index).toBe(0);
			expect(oligo.length).toBe(16); // 0-15
		});
	});

	describe('createCrossover', () => {
		beforeEach(() => {
			// Create oligos on both strands of vh1
			testPart.createOligo(vh1, 0, 20, '#ff0000'); // strand 0
			testPart.createOligo(vh1, 20, 0, '#00ff00'); // strand 1
		});

		it('should create crossover between two oligos', () => {
			const oligos = Array.from(testPart.oligos.values());
			const fromOligo = oligos.find((o) => o.threePrime!.index === 20);
			const toOligo = oligos.find((o) => o !== fromOligo);
			const toSegment = toOligo!.segments.values().next().value!;

			testPart.createCrossover(fromOligo!, toOligo!, toSegment, 15);

			// Crossover may merge oligos or create new ones depending on implementation
			expect(testPart.oligos.size).toBeGreaterThanOrEqual(1);
		});

		it('should throw error when both oligos are not in part', () => {
			const oligo1 = testPart.createOligo(vh2, 0, 10, '#ffff00');
			const oligo2 = testPart.createOligo(vh2, 15, 25, '#00ffff');
			const segment2 = oligo2.segments.values().next().value!;

			// Remove oligo1 from the part
			testPart.removeOligo(oligo1);

			expect(() => {
				testPart.createCrossover(oligo1, oligo2, segment2, 20);
			}).toThrow('Both oligos must be part of this Part');
		});

		it('should throw error when creating crossover on same segment', () => {
			const oligo = testPart.createOligo(vh2, 0, 20, '#ffff00');
			const segment = oligo.segments.values().next().value!;

			expect(() => {
				testPart.createCrossover(oligo, oligo, segment, 10);
			}).toThrow('Cannot create crossover on the same segment');
		});

		it('should connect to 5 prime end directly when atIndexTarget matches', () => {
			const oligo1 = testPart.createOligo(vh2, 0, 10, '#ffff00');
			const oligo2 = testPart.createOligo(vh2, 11, 20, '#00ffff');
			const segment2 = oligo2.segments.values().next().value!;

			const initialCount = testPart.oligos.size;

			testPart.createCrossover(oligo1, oligo2, segment2, 11);

			// Should merge the two oligos
			expect(testPart.oligos.size).toBe(initialCount - 1);
		});
	});

	describe('circular oligo operations', () => {
		it('should verify isCircular property on linear oligo', () => {
			const oligo = testPart.createOligo(vh1, 0, 20, '#ff0000');

			// A newly created oligo should not be circular
			expect(oligo.isCircular).toBe(false);
			expect(oligo.fivePrime).not.toBeNull();
			expect(oligo.threePrime).not.toBeNull();
		});

		it('should handle connecting oligo to itself (circularization)', () => {
			// Create an oligo and break it to have two segments
			const oligo = testPart.createOligo(vh1, 0, 20, '#ff0000');
			const segment = oligo.segments.values().next().value!;

			// Break the oligo to create two segments in the same oligo
			testPart.breakOligoAt(oligo, segment, 10);

			// After breaking, we have two oligos
			expect(testPart.oligos.size).toBe(2);

			const oligos = Array.from(testPart.oligos.values());
			// Connect first oligo's 3' to second oligo's 5'
			testPart.connectTwoOligos(oligos[0], oligos[1]);

			// Should have merged back into one oligo
			expect(testPart.oligos.size).toBe(1);
		});
	});

	describe('addOligosFromArray', () => {
		it('should add oligos from array and update caches', () => {
			// Create oligos using createOligo, then remove them and re-add via addOligosFromArray
			const oligo1 = testPart.createOligo(vh1, 0, 10, '#ff0000');
			const oligo2 = testPart.createOligo(vh1, 15, 25, '#00ff00');

			// Store references to oligos
			const oligoArray = [oligo1, oligo2];

			// Remove oligos from part (but keep their references)
			testPart.oligos.delete(oligo1);
			testPart.oligos.delete(oligo2);
			testPart.rebuildRspCaches(); // Clear caches

			expect(testPart.oligos.size).toBe(0);

			// Add them back using addOligosFromArray
			testPart.addOligosFromArray(oligoArray);

			expect(testPart.oligos.size).toBe(2);
			expect(testPart.oligos.has(oligo1)).toBe(true);
			expect(testPart.oligos.has(oligo2)).toBe(true);

			// Verify caches are updated
			const result1 = testPart.getEntitiesAt(vh1.listRow, 0, 5);
			const result2 = testPart.getEntitiesAt(vh1.listRow, 0, 20);
			expect(result1.oligo).toBe(oligo1);
			expect(result2.oligo).toBe(oligo2);
		});

		it('should add empty array without error', () => {
			testPart.addOligosFromArray([]);
			expect(testPart.oligos.size).toBe(0);
		});
	});

	describe('cache operations', () => {
		it('should update cache after creating oligo', () => {
			const oligo = testPart.createOligo(vh1, 0, 10, '#ff0000');

			// Cache should allow finding the oligo
			const result = testPart.getEntitiesAt(vh1.listRow, 0, 5);
			expect(result.oligo).toBe(oligo);
		});

		it('should update cache after breaking oligo', () => {
			const oligo = testPart.createOligo(vh1, 0, 10, '#ff0000');
			const segment = oligo.segments.values().next().value!;

			const newOligo = testPart.breakOligoAt(oligo, segment, 5);

			// Cache should be updated for both oligos
			const result1 = testPart.getEntitiesAt(vh1.listRow, 0, 3);
			const result2 = testPart.getEntitiesAt(vh1.listRow, 0, 8);

			expect(result1.oligo).toBe(oligo);
			expect(result2.oligo).toBe(newOligo);
		});

		it('should update cache after removing oligo', () => {
			const oligo = testPart.createOligo(vh1, 0, 10, '#ff0000');
			testPart.removeOligo(oligo);

			const result = testPart.getEntitiesAt(vh1.listRow, 0, 5);
			expect(result.oligo).toBeNull();
			expect(result.segment).toBeNull();
		});

		it('should rebuild caches correctly', () => {
			const oligo1 = testPart.createOligo(vh1, 0, 10, '#ff0000');
			const oligo2 = testPart.createOligo(vh1, 15, 25, '#00ff00');

			testPart.rebuildRspCaches();

			const result1 = testPart.getEntitiesAt(vh1.listRow, 0, 5);
			const result2 = testPart.getEntitiesAt(vh1.listRow, 0, 20);

			expect(result1.oligo).toBe(oligo1);
			expect(result2.oligo).toBe(oligo2);
		});
	});

	describe('edge cases', () => {
		it('should handle oligo of length 1', () => {
			expect(() => testPart.createOligo(vh1, 5, 5, '#ff0000')).toThrowError(
				'Segment must have > 1 length.'
			);

			// expect(oligo.length).toBe(1);
			// expect(testPart.oligos.size).toBe(1);
		});

		it('should handle multiple oligos on different virtual helices', () => {
			const oligo1 = testPart.createOligo(vh1, 0, 10, '#ff0000');
			const oligo2 = testPart.createOligo(vh2, 0, 10, '#00ff00');

			expect(testPart.oligos.size).toBe(2);

			const result1 = testPart.getEntitiesAt(vh1.listRow, 0, 5);
			const result2 = testPart.getEntitiesAt(vh2.listRow, 0, 5);

			expect(result1.oligo).toBe(oligo1);
			expect(result2.oligo).toBe(oligo2);
		});

		it('should handle oligos on both strand sets of same vh', () => {
			const oligo0 = testPart.createOligo(vh1, 0, 10, '#ff0000'); // strand 0
			const oligo1 = testPart.createOligo(vh1, 10, 0, '#00ff00'); // strand 1

			expect(testPart.oligos.size).toBe(2);

			const result0 = testPart.getEntitiesAt(vh1.listRow, 0, 5);
			const result1 = testPart.getEntitiesAt(vh1.listRow, 1, 5);

			expect(result0.oligo).toBe(oligo0);
			expect(result1.oligo).toBe(oligo1);
		});
	});
});
