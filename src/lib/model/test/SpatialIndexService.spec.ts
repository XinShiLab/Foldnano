import { addLatticeVh } from '$lib/model/test/testHelpers';
/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect, beforeEach } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import type { Part } from '$lib/model/Part';
import type VirtualHelix from '$lib/model/VirtualHelix';

describe('SpatialIndexService', () => {
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

	describe('Segment caching', () => {
		it('should cache segment at all positions in range', () => {
			const oligo = testPart.createOligo(vh1, 0, 10, '#ff0000');

			// Check cache at various positions
			const segment1 = testPart.getEntitiesAt(vh1.listRow, 0, 0).segment;
			const segment2 = testPart.getEntitiesAt(vh1.listRow, 0, 5).segment;
			const segment3 = testPart.getEntitiesAt(vh1.listRow, 0, 10).segment;

			expect(segment1).toBeDefined();
			expect(segment1).toBe(segment2);
			expect(segment2).toBe(segment3);
		});

		it('should cache multiple segments independently', () => {
			const oligo1 = testPart.createOligo(vh1, 0, 10, '#ff0000');
			const oligo2 = testPart.createOligo(vh1, 15, 25, '#00ff00');

			const segment1 = oligo1.segments.values().next().value!;
			const segment2 = oligo2.segments.values().next().value!;

			expect(testPart.getEntitiesAt(vh1.listRow, 0, 5).segment).toBe(segment1);
			expect(testPart.getEntitiesAt(vh1.listRow, 0, 20).segment).toBe(segment2);
			expect(testPart.getEntitiesAt(vh1.listRow, 0, 12).segment).toBeNull();
		});

		it('should cache segments on different strands', () => {
			const oligo1 = testPart.createOligo(vh1, 0, 10, '#ff0000'); // strand 0
			const oligo2 = testPart.createOligo(vh1, 10, 0, '#00ff00'); // strand 1

			const segment1 = oligo1.segments.values().next().value!;
			const segment2 = oligo2.segments.values().next().value!;

			expect(testPart.getEntitiesAt(vh1.listRow, 0, 5).segment).toBe(segment1);
			expect(testPart.getEntitiesAt(vh1.listRow, 1, 5).segment).toBe(segment2);
		});

		it('should cache segments on different virtual helices', () => {
			const oligo1 = testPart.createOligo(vh1, 0, 10, '#ff0000');
			const oligo2 = testPart.createOligo(vh2, 0, 10, '#00ff00');

			const segment1 = oligo1.segments.values().next().value!;
			const segment2 = oligo2.segments.values().next().value!;

			expect(testPart.getEntitiesAt(vh1.listRow, 0, 5).segment).toBe(segment1);
			expect(testPart.getEntitiesAt(vh2.listRow, 0, 5).segment).toBe(segment2);
		});

		it('should support direct VH-id lookups', () => {
			const oligo = testPart.createOligo(vh1, 0, 10, '#ff0000');
			const segment = oligo.segments.values().next().value!;

			const byVh = testPart.getEntitiesAtVh(vh1.id, 0, 5);
			const byRow = testPart.getEntitiesAt(vh1.listRow, 0, 5);

			expect(byVh.segment).toBe(segment);
			expect(byVh.segment).toBe(byRow.segment);
			expect(byVh.oligo).toBe(byRow.oligo);
		});
	});

	describe('Segment uncaching', () => {
		it('should remove segment from cache when oligo removed', () => {
			const oligo = testPart.createOligo(vh1, 0, 10, '#ff0000');

			expect(testPart.getEntitiesAt(vh1.listRow, 0, 5).segment).toBeDefined();

			testPart.removeOligo(oligo);

			expect(testPart.getEntitiesAt(vh1.listRow, 0, 5).segment).toBeNull();
		});

		it('should only remove specified segment', () => {
			const oligo1 = testPart.createOligo(vh1, 0, 10, '#ff0000');
			const oligo2 = testPart.createOligo(vh1, 15, 25, '#00ff00');

			const segment2 = oligo2.segments.values().next().value!;

			testPart.removeOligo(oligo1);

			expect(testPart.getEntitiesAt(vh1.listRow, 0, 5).segment).toBeNull();
			expect(testPart.getEntitiesAt(vh1.listRow, 0, 20).segment).toBe(segment2);
		});
	});

	describe('End caching', () => {
		it('should cache segment ends at their positions', () => {
			testPart.createOligo(vh1, 0, 10, '#ff0000');

			const endAt0 = testPart.getEntitiesAt(vh1.listRow, 0, 0).end;
			const endAt10 = testPart.getEntitiesAt(vh1.listRow, 0, 10).end;

			expect(endAt0).toBeDefined();
			expect(endAt10).toBeDefined();
			expect(endAt0?.index).toBe(0);
			expect(endAt10?.index).toBe(10);
		});

		it('should not cache ends at middle positions', () => {
			testPart.createOligo(vh1, 0, 10, '#ff0000');

			const end = testPart.getEntitiesAt(vh1.listRow, 0, 5).end;

			expect(end).toBeNull();
		});

		it('should cache multiple ends at same position', () => {
			const oligo = testPart.createOligo(vh1, 0, 10, '#ff0000');
			const segment = oligo.segments.values().next().value!;

			// Break oligo to create adjacent segments with ends at same position
			testPart.breakOligoAt(oligo, segment, 5);

			const ends = testPart.getEndsInRange(
				{
					startVhRow: vh1.listRow,
					endVhRow: vh1.listRow,
					startStrandIdx: 0,
					endStrandIdx: 0,
					startBpIdx: 5,
					endBpIdx: 6,
				},
				false
			);

			// Should have ends at break point
			expect(ends.length).toBeGreaterThan(0);
		});

		it('should remove ends from cache when segment removed', () => {
			const oligo = testPart.createOligo(vh1, 0, 10, '#ff0000');

			expect(testPart.getEntitiesAt(vh1.listRow, 0, 0).end).toBeDefined();

			testPart.removeOligo(oligo);

			expect(testPart.getEntitiesAt(vh1.listRow, 0, 0).end).toBeNull();
		});
	});

	describe('Oligo-segment mapping', () => {
		it('should map segment to parent oligo', () => {
			const oligo = testPart.createOligo(vh1, 0, 10, '#ff0000');
			const segment = oligo.segments.values().next().value!;

			const foundOligo = testPart.getOligoBySegment(segment);

			expect(foundOligo).toBe(oligo);
		});

		it('should return null for unmapped segment', () => {
			const oligo = testPart.createOligo(vh1, 0, 10, '#ff0000');
			const segment = oligo.segments.values().next().value!;

			testPart.removeOligo(oligo);

			const foundOligo = testPart.getOligoBySegment(segment);

			expect(foundOligo).toBeNull();
		});

		it('should update mapping after oligo merge', () => {
			const oligo1 = testPart.createOligo(vh1, 0, 8, '#ff0000');
			const oligo2 = testPart.createOligo(vh1, 11, 20, '#00ff00');

			const segment1 = oligo1.segments.values().next().value!;
			const segment2 = oligo2.segments.values().next().value!;

			testPart.connectTwoOligos(oligo1, oligo2);

			// After merge, both segments should map to same oligo
			const oligo1AfterMerge = testPart.getOligoBySegment(segment1);
			const oligo2AfterMerge = testPart.getOligoBySegment(segment2);

			expect(oligo1AfterMerge).toBe(oligo2AfterMerge);
			expect(oligo1AfterMerge).not.toBeNull();
		});
	});

	describe('Cache rebuild', () => {
		it('should rebuild cache from oligos', () => {
			const oligo1 = testPart.createOligo(vh1, 0, 10, '#ff0000');
			const oligo2 = testPart.createOligo(vh1, 15, 25, '#00ff00');

			const segment1 = oligo1.segments.values().next().value!;
			const segment2 = oligo2.segments.values().next().value!;

			// Rebuild cache
			testPart.rebuildRspCaches();

			// Should still find segments
			expect(testPart.getEntitiesAt(vh1.listRow, 0, 5).segment).toBe(segment1);
			expect(testPart.getEntitiesAt(vh1.listRow, 0, 20).segment).toBe(segment2);
		});

		it('should clear old cache before rebuild', () => {
			const oligo = testPart.createOligo(vh1, 0, 10, '#ff0000');

			testPart.removeOligo(oligo);

			// Rebuild should not restore removed oligo
			testPart.rebuildRspCaches();

			expect(testPart.getEntitiesAt(vh1.listRow, 0, 5).segment).toBeNull();
		});
	});

	describe('O(1) lookup performance', () => {
		it('should maintain constant lookup time as segment count scales', () => {
			testPart = testDoc.parts[0];
			testPart.increaseVhsLengthBy(210); // Ensure enough length for many segments
			// Measure lookup time with few segments
			const smallSegmentCount = 10;
			for (let i = 0; i < smallSegmentCount; i++) {
				const start = i * 2;
				const end = start + 1;
				testPart.createOligo(vh1, start, end, '#ff0000');
			}

			const iterations = 1000;
			const start1 = performance.now();
			for (let i = 0; i < iterations; i++) {
				testPart.getEntitiesAt(vh1.listRow, 0, 5);
			}
			const time1 = performance.now() - start1;

			// Add many more segments (10x increase)
			const largeSegmentCount = 100;
			for (let i = smallSegmentCount; i < largeSegmentCount; i++) {
				const start = i * 2;
				const end = start + 1;
				testPart.createOligo(vh1, start, end, '#ff0000');
			}

			const start2 = performance.now();
			for (let i = 0; i < iterations; i++) {
				testPart.getEntitiesAt(vh1.listRow, 0, 105);
			}
			const time2 = performance.now() - start2;

			// O(1) lookup: 10x more segments should NOT cause 10x slower lookups
			// Allow 3x slowdown for noise, but true O(n) would be ~10x
			const slowdownFactor = time2 / time1;
			expect(slowdownFactor).toBeLessThan(3);

			// Verify lookups still work correctly
			expect(testPart.getEntitiesAt(vh1.listRow, 0, 5).segment).toBeDefined();
			expect(testPart.getEntitiesAt(vh1.listRow, 0, 105).segment).toBeDefined();
		});

		it('should have direct hash-based access without iteration', () => {
			testPart.increaseVhsLengthBy(210); // Ensure enough length for sparse segments
			// Create segments at sparse positions
			testPart.createOligo(vh1, 0, 5, '#ff0000');
			testPart.createOligo(vh1, 100, 105, '#00ff00'); // Far apart
			testPart.createOligo(vh1, 200, 205, '#0000ff'); // Even farther

			// If spatial index uses iteration, lookup at 200 would be slower
			// than lookup at 0 (has to iterate through more entries)
			// With O(1) hash access, both should be equally fast

			const iterations = 500;

			const start1 = performance.now();
			for (let i = 0; i < iterations; i++) {
				testPart.getEntitiesAt(vh1.listRow, 0, 2);
			}
			const timeFirst = performance.now() - start1;

			const start2 = performance.now();
			for (let i = 0; i < iterations; i++) {
				testPart.getEntitiesAt(vh1.listRow, 0, 202);
			}
			const timeLast = performance.now() - start2;

			// Position shouldn't matter for O(1) lookup
			// Allow 10x variation for measurement noise (JIT warmup, GC, etc.)
			const ratio = Math.max(timeFirst, timeLast) / Math.min(timeFirst, timeLast);
			expect(ratio).toBeLessThan(10);
		});
	});

	describe('Cache updates after mutations', () => {
		it('should update cache after segment break', () => {
			const oligo = testPart.createOligo(vh1, 0, 10, '#ff0000');
			const segment = oligo.segments.values().next().value!;

			const newOligo = testPart.breakOligoAt(oligo, segment, 5);
			const newSegment = newOligo.segments.values().next().value!;

			// Both segments should be cached
			expect(testPart.getEntitiesAt(vh1.listRow, 0, 3).segment).toBe(segment);
			expect(testPart.getEntitiesAt(vh1.listRow, 0, 8).segment).toBe(newSegment);
		});

		it('should update cache after terminus move', () => {
			const oligo = testPart.createOligo(vh1, 0, 10, '#ff0000');
			const segment = oligo.segments.values().next().value!;

			testPart.moveOligoTerminusTo(segment.threePrime, 15);

			// Extended range should be cached
			expect(testPart.getEntitiesAt(vh1.listRow, 0, 12).segment).toBe(segment);
			expect(testPart.getEntitiesAt(vh1.listRow, 0, 15).segment).toBe(segment);
		});

		it('should update end cache after terminus move', () => {
			const oligo = testPart.createOligo(vh1, 0, 10, '#ff0000');

			const endBefore = testPart.getEntitiesAt(vh1.listRow, 0, 10).end;
			expect(endBefore).toBeDefined();

			testPart.moveOligoTerminusTo(oligo.threePrime!, 15);

			// Old position should not have end
			expect(testPart.getEntitiesAt(vh1.listRow, 0, 10).end).toBeNull();
			// New position should have end
			expect(testPart.getEntitiesAt(vh1.listRow, 0, 15).end).toBeDefined();
		});
	});

	describe('Coordinate packing', () => {
		it('should handle different row indices', () => {
			const vh3 = addLatticeVh(testPart, 0, 2);

			testPart.createOligo(vh1, 0, 5, '#ff0000');
			testPart.createOligo(vh2, 0, 5, '#00ff00');
			testPart.createOligo(vh3, 0, 5, '#0000ff');

			// Each VH should have its own cached segment
			expect(testPart.getEntitiesAt(vh1.listRow, 0, 3).segment).toBeDefined();
			expect(testPart.getEntitiesAt(vh2.listRow, 0, 3).segment).toBeDefined();
			expect(testPart.getEntitiesAt(vh3.listRow, 0, 3).segment).toBeDefined();

			// They should be different segments
			const seg1 = testPart.getEntitiesAt(vh1.listRow, 0, 3).segment;
			const seg2 = testPart.getEntitiesAt(vh2.listRow, 0, 3).segment;

			expect(seg1).not.toBe(seg2);
		});

		it('should handle large bp indices', () => {
			// Increase VH length (must be multiple of step=21)
			testPart.increaseVhsLengthBy(105); // 5 * 21

			const oligo = testPart.createOligo(vh1, 100, 120, '#ff0000');
			const segment = oligo.segments.values().next().value!;

			expect(testPart.getEntitiesAt(vh1.listRow, 0, 110).segment).toBe(segment);
		});
	});

	describe('Edge cases', () => {
		it('should handle empty part (no oligos)', () => {
			expect(testPart.getEntitiesAt(vh1.listRow, 0, 5).segment).toBeNull();
			expect(testPart.getEntitiesAt(vh1.listRow, 0, 5).end).toBeNull();
		});

		it('should handle single-base segment', () => {
			const oligo = testPart.createOligo(vh1, 5, 6, '#ff0000');
			const segment = oligo.segments.values().next().value!;

			expect(testPart.getEntitiesAt(vh1.listRow, 0, 5).segment).toBe(segment);
			expect(testPart.getEntitiesAt(vh1.listRow, 0, 6).segment).toBe(segment);
		});

		it('should handle circular oligo', () => {
			const oligo = testPart.createOligo(vh1, 0, 10, '#ff0000');
			const segment = oligo.segments.values().next().value!;

			testPart.breakOligoAt(oligo, segment, 5);

			const oligos = Array.from(testPart.oligos.values());
			testPart.connectTwoOligos(oligos[0], oligos[1]);

			// Segments should still be cached
			expect(testPart.getEntitiesAt(vh1.listRow, 0, 3).segment).toBeDefined();
			expect(testPart.getEntitiesAt(vh1.listRow, 0, 8).segment).toBeDefined();
		});
	});

	describe('Cache consistency', () => {
		it('should maintain consistency across multiple operations', () => {
			const oligo1 = testPart.createOligo(vh1, 0, 10, '#ff0000');
			const oligo2 = testPart.createOligo(vh1, 15, 25, '#00ff00');

			const segment1 = oligo1.segments.values().next().value!;

			// Break first oligo
			testPart.breakOligoAt(oligo1, segment1, 5);

			// Move second oligo terminus
			testPart.moveOligoTerminusTo(oligo2.threePrime!, 30);

			// All positions should be correctly cached
			expect(testPart.getEntitiesAt(vh1.listRow, 0, 3).segment).toBeDefined();
			expect(testPart.getEntitiesAt(vh1.listRow, 0, 8).segment).toBeDefined();
			expect(testPart.getEntitiesAt(vh1.listRow, 0, 20).segment).toBeDefined();
			expect(testPart.getEntitiesAt(vh1.listRow, 0, 28).segment).toBeDefined();
		});

		it('should handle segment ownership changes correctly', () => {
			const oligo1 = testPart.createOligo(vh1, 0, 8, '#ff0000'); // if there's no gap, merge will happen, then segment 2 won't exist
			const oligo2 = testPart.createOligo(vh1, 11, 20, '#00ff00');

			const segment1 = oligo1.segments.values().next().value!;
			const segment2 = oligo2.segments.values().next().value!;

			// Connect oligos
			testPart.connectTwoOligos(oligo1, oligo2);

			// Both segments should map to same oligo after merge
			const owner1 = testPart.getOligoBySegment(segment1);
			const owner2 = testPart.getOligoBySegment(segment2);

			// They should map to the same oligo (which may be either oligo1 or oligo2)
			// note there should be a gap between 8 and 11, so segments should still exist
			expect(owner1).toBe(owner2);
			expect(owner2).toBeDefined();
		});

		it('keeps VH-keyed cache valid after reorder without rebuilding caches', () => {
			addLatticeVh(testPart, 0, 2);
			const oligo = testPart.createOligo(vh1, 0, 10, '#ff0000');
			const segment = oligo.segments.values().next().value!;
			const oldRow = vh1.listRow;

			testPart.reorderVirtualHelix(vh1.index, 2);

			expect(testPart.getEntitiesAtVh(vh1.id, 0, 5).segment).toBe(segment);
			expect(testPart.getEntitiesAt(vh1.listRow, 0, 5).segment).toBe(segment);
			expect(vh1.listRow).not.toBe(oldRow);
			expect(testPart.getEntitiesAt(oldRow, 0, 5).segment).toBeNull();
		});
	});
});
