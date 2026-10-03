import { addLatticeVh } from '$lib/model/test/testHelpers';
import { describe, it, expect, beforeEach } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import type { Part } from '$lib/model/Part';
import type VirtualHelix from '$lib/model/VirtualHelix';
import type StrandSet from '../VirtualHelix/StrandSet.svelte';

describe('StrandSet Occupancy', () => {
	let testDoc: FoldnanoDocument;
	let testPart: Part;
	let vh: VirtualHelix;

	beforeEach(() => {
		testDoc = new FoldnanoDocument();
		testDoc.addNewPart('HONEYCOMB');
		testPart = testDoc.parts[0];
		vh = addLatticeVh(testPart, 0, 0);
		// testPart.increaseVhsLengthBy(63);
	});

	describe('StrandSet basics', () => {
		it('should have correct strand index', () => {
			expect(vh.strandSets[0].strandIndex).toBe(0);
			expect(vh.strandSets[1].strandIndex).toBe(1);
		});

		it('should reference owner virtual helix', () => {
			expect(vh.strandSets[0].ownerVh).toBe(vh);
			expect(vh.strandSets[1].owner).toBe(vh);
		});

		it('should have same length as virtual helix', () => {
			expect(vh.strandSets[0].length).toBe(vh.length);
			expect(vh.strandSets[1].length).toBe(vh.length);
		});

		it('should be empty initially', () => {
			expect(vh.strandSets[0].isEmpty).toBe(true);
			expect(vh.strandSets[1].isEmpty).toBe(true);
		});

		it('should not be empty after adding segment', () => {
			testPart.createOligo(vh, 0, 10, '#ff0000');

			expect(vh.strandSets[0].isEmpty).toBe(false);
		});
	});

	describe('Segment tracking', () => {
		it('should track segment IDs', () => {
			const oligo = testPart.createOligo(vh, 0, 10, '#ff0000');
			const segment = oligo.segments.values().next().value!;

			expect(vh.strandSets[0].segmentIds.has(segment.id)).toBe(true);
			expect(vh.strandSets[0].segmentIds.size).toBe(1);
		});

		it('should track multiple segments', () => {
			testPart.createOligo(vh, 0, 10, '#ff0000');
			testPart.createOligo(vh, 15, 25, '#00ff00');

			expect(vh.strandSets[0].segmentIds.size).toBe(2);
		});

		it('should remove segment IDs when segment removed', () => {
			const oligo = testPart.createOligo(vh, 0, 10, '#ff0000');
			const segment = oligo.segments.values().next().value!;

			expect(vh.strandSets[0].segmentIds.size).toBe(1);

			vh.removeSegment(segment);

			expect(vh.strandSets[0].segmentIds.size).toBe(0);
		});

		it('should track segments on different strands independently', () => {
			testPart.createOligo(vh, 0, 10, '#ff0000'); // strand 0
			testPart.createOligo(vh, 10, 0, '#00ff00'); // strand 1

			expect(vh.strandSets[0].segmentIds.size).toBe(1);
			expect(vh.strandSets[1].segmentIds.size).toBe(1);
		});
	});

	describe('Single index occupancy', () => {
		it('should detect occupied index', () => {
			testPart.createOligo(vh, 0, 10, '#ff0000');

			expect(vh.strandSets[0].isIndexOccupied(0)).toBe(true);
			expect(vh.strandSets[0].isIndexOccupied(5)).toBe(true);
			expect(vh.strandSets[0].isIndexOccupied(10)).toBe(true);
		});

		it('should detect unoccupied index', () => {
			testPart.createOligo(vh, 0, 10, '#ff0000');

			expect(vh.strandSets[0].isIndexOccupied(15)).toBe(false);
			expect(vh.strandSets[0].isIndexOccupied(20)).toBe(false);
		});

		it('should return false for index in gap between segments', () => {
			testPart.createOligo(vh, 0, 10, '#ff0000');
			testPart.createOligo(vh, 15, 25, '#00ff00');

			expect(vh.strandSets[0].isIndexOccupied(12)).toBe(false);
			expect(vh.strandSets[0].isIndexOccupied(13)).toBe(false);
		});

		it('should handle boundary indices correctly', () => {
			testPart.createOligo(vh, 5, 15, '#ff0000');

			expect(vh.strandSets[0].isIndexOccupied(4)).toBe(false);
			expect(vh.strandSets[0].isIndexOccupied(5)).toBe(true);
			expect(vh.strandSets[0].isIndexOccupied(15)).toBe(true);
			expect(vh.strandSets[0].isIndexOccupied(16)).toBe(false);
		});
	});

	describe('Range occupancy', () => {
		it('should detect occupied range', () => {
			testPart.createOligo(vh, 0, 10, '#ff0000');

			expect(vh.strandSets[0].isRangeOccupied(0, 10)).toBe(true);
			expect(vh.strandSets[0].isRangeOccupied(5, 8)).toBe(true);
		});

		it('should detect unoccupied range', () => {
			testPart.createOligo(vh, 0, 10, '#ff0000');

			expect(vh.strandSets[0].isRangeOccupied(15, 25)).toBe(false);
		});

		it('should detect partial overlap', () => {
			testPart.createOligo(vh, 10, 20, '#ff0000');

			expect(vh.strandSets[0].isRangeOccupied(5, 15)).toBe(true);
			expect(vh.strandSets[0].isRangeOccupied(15, 25)).toBe(true);
		});

		it('should work with reversed indices', () => {
			testPart.createOligo(vh, 10, 20, '#ff0000');

			expect(vh.strandSets[0].isRangeOccupied(20, 10)).toBe(true);
			expect(vh.strandSets[0].isRangeOccupied(15, 5)).toBe(true);
		});

		it('should handle range containing multiple segments', () => {
			testPart.createOligo(vh, 0, 5, '#ff0000');
			testPart.createOligo(vh, 10, 15, '#00ff00');

			expect(vh.strandSets[0].isRangeOccupied(0, 15)).toBe(true);
		});

		it('should return false for range between segments', () => {
			testPart.createOligo(vh, 0, 5, '#ff0000');
			testPart.createOligo(vh, 10, 15, '#00ff00');

			expect(vh.strandSets[0].isRangeOccupied(6, 9)).toBe(false);
		});
	});

	describe('Occupancy by segment', () => {
		it('should return segment occupying index', () => {
			const oligo = testPart.createOligo(vh, 0, 10, '#ff0000');
			const segment = oligo.segments.values().next().value!;

			const occupyingSegment = vh.strandSets[0].isIndexOccupiedBy(5);

			expect(occupyingSegment).toBe(segment);
		});

		it('should return null for unoccupied index', () => {
			testPart.createOligo(vh, 0, 10, '#ff0000');

			const occupyingSegment = vh.strandSets[0].isIndexOccupiedBy(15);

			expect(occupyingSegment).toBeNull();
		});

		it('should return correct segment when multiple exist', () => {
			const oligo1 = testPart.createOligo(vh, 0, 10, '#ff0000');
			const oligo2 = testPart.createOligo(vh, 15, 25, '#00ff00');

			const segment1 = oligo1.segments.values().next().value!;
			const segment2 = oligo2.segments.values().next().value!;

			expect(vh.strandSets[0].isIndexOccupiedBy(5)).toBe(segment1);
			expect(vh.strandSets[0].isIndexOccupiedBy(20)).toBe(segment2);
		});
	});

	describe('Range occupancy by segments', () => {
		it('should return set of segments occupying range', () => {
			const oligo = testPart.createOligo(vh, 0, 10, '#ff0000');
			const segment = oligo.segments.values().next().value!;

			const occupyingSegments = vh.strandSets[0].isRangeOccupiedBy(0, 10);

			expect(occupyingSegments.has(segment)).toBe(true);
			expect(occupyingSegments.size).toBe(1);
		});

		it('should return empty set for unoccupied range', () => {
			testPart.createOligo(vh, 0, 10, '#ff0000');

			const occupyingSegments = vh.strandSets[0].isRangeOccupiedBy(15, 25);

			expect(occupyingSegments.size).toBe(0);
		});

		it('should return multiple segments when range overlaps multiple', () => {
			const oligo1 = testPart.createOligo(vh, 0, 10, '#ff0000');
			const oligo2 = testPart.createOligo(vh, 15, 25, '#00ff00');

			const segment1 = oligo1.segments.values().next().value!;
			const segment2 = oligo2.segments.values().next().value!;

			const occupyingSegments = vh.strandSets[0].isRangeOccupiedBy(0, 25);

			expect(occupyingSegments.size).toBe(2);
			expect(occupyingSegments.has(segment1)).toBe(true);
			expect(occupyingSegments.has(segment2)).toBe(true);
		});

		it('should return segments with partial overlap', () => {
			const oligo = testPart.createOligo(vh, 10, 20, '#ff0000');
			const segment = oligo.segments.values().next().value!;

			const occupyingSegments1 = vh.strandSets[0].isRangeOccupiedBy(5, 15);
			const occupyingSegments2 = vh.strandSets[0].isRangeOccupiedBy(15, 25);

			expect(occupyingSegments1.has(segment)).toBe(true);
			expect(occupyingSegments2.has(segment)).toBe(true);
		});
	});

	describe('Merged intervals', () => {
		it('should return merged intervals for single segment', () => {
			testPart.createOligo(vh, 0, 10, '#ff0000');

			const intervals = vh.strandSets[0].mergedIntervals;

			expect(intervals.length).toBe(1);
			expect(intervals[0]).toEqual([0, 10]);
		});

		it('should return separate intervals for non-overlapping segments', () => {
			testPart.createOligo(vh, 0, 5, '#ff0000');
			testPart.createOligo(vh, 10, 15, '#00ff00');

			const intervals = vh.strandSets[0].mergedIntervals;

			expect(intervals.length).toBe(2);
			expect(intervals).toContainEqual([0, 5]);
			expect(intervals).toContainEqual([10, 15]);
		});

		it('should merge adjacent segments', () => {
			testPart.createOligo(vh, 0, 5, '#ff0000');
			testPart.createOligo(vh, 6, 10, '#00ff00');

			const intervals = vh.strandSets[0].mergedIntervals;

			// Adjacent segments should merge into one interval
			expect(intervals.length).toBe(1);
			expect(intervals[0]).toEqual([0, 10]);
		});

		it('should merge overlapping segments', () => {
			// This shouldn't happen normally, but test the merge logic
			const oligo1 = testPart.createOligo(vh, 0, 10, '#ff0000');
			const segment1 = oligo1.segments.values().next().value!;

			// Break and create overlapping scenario
			testPart.breakOligoAt(oligo1, segment1, 5);

			const intervals = vh.strandSets[0].mergedIntervals;

			// Should still have continuous coverage
			expect(intervals.length).toBeGreaterThanOrEqual(1);
		});

		it('should cache merged intervals', () => {
			testPart.createOligo(vh, 0, 10, '#ff0000');

			const intervals1 = vh.strandSets[0].mergedIntervals;
			const intervals2 = vh.strandSets[0].mergedIntervals;

			// Should return same cached instance
			expect(intervals1).toBe(intervals2);
		});

		it('should invalidate cache when segments change', () => {
			testPart.createOligo(vh, 0, 10, '#ff0000');

			const intervals1 = vh.strandSets[0].mergedIntervals;

			testPart.createOligo(vh, 15, 25, '#00ff00');

			const intervals2 = vh.strandSets[0].mergedIntervals;

			// Cache should be invalidated
			expect(intervals1.length).not.toBe(intervals2.length);
		});
	});

	describe('Segment end indices', () => {
		it('should return all segment end indices', () => {
			testPart.createOligo(vh, 0, 10, '#ff0000');

			const endIndices = vh.strandSets[0].getSegmentEndIndices();

			expect(endIndices.has(0)).toBe(true);
			expect(endIndices.has(10)).toBe(true);
			expect(endIndices.size).toBe(2);
		});

		it('should return ends for multiple segments', () => {
			testPart.createOligo(vh, 0, 10, '#ff0000');
			testPart.createOligo(vh, 15, 25, '#00ff00');

			const endIndices = vh.strandSets[0].getSegmentEndIndices();

			expect(endIndices.has(0)).toBe(true);
			expect(endIndices.has(10)).toBe(true);
			expect(endIndices.has(15)).toBe(true);
			expect(endIndices.has(25)).toBe(true);
			expect(endIndices.size).toBe(4);
		});

		it('should not include non-end indices', () => {
			testPart.createOligo(vh, 0, 10, '#ff0000');

			const endIndices = vh.strandSets[0].getSegmentEndIndices();

			expect(endIndices.has(5)).toBe(false);
		});
	});

	describe('JSON serialization', () => {
		it('should serialize to JSON', () => {
			testPart.createOligo(vh, 0, 10, '#ff0000');

			const json = vh.strandSets[0].toJSON();

			expect(json.strandIndex).toBe(0);
			expect(json.segmentIds).toBeDefined();
			expect(Array.isArray(json.segmentIds)).toBe(true);
		});

		it('should deserialize from JSON', () => {
			testPart.createOligo(vh, 0, 10, '#ff0000');

			const json = vh.strandSets[0].toJSON();
			const strandSetConstructor = vh.strandSets[0].constructor as typeof StrandSet;
			const restored = strandSetConstructor.fromJSON(json, vh);

			expect(restored.strandIndex).toBe(0);
			expect(restored.segmentIds.size).toBe(vh.strandSets[0].segmentIds.size);
		});
	});

	describe('Performance and edge cases', () => {
		it('should handle many segments efficiently', () => {
			// Create 10 non-overlapping segments
			for (let i = 0; i < 10; i++) {
				const start = i * 4;
				const end = start + 2;
				testPart.createOligo(vh, start, end, '#ff0000');
			}

			expect(vh.strandSets[0].segmentIds.size).toBe(10);

			// Occupancy checks should still be fast
			expect(vh.strandSets[0].isIndexOccupied(0)).toBe(true);
			expect(vh.strandSets[0].isIndexOccupied(27)).toBe(false);

			const intervals = vh.strandSets[0].mergedIntervals;
			expect(intervals.length).toBe(10);
		});

		it('should handle single-base segments', () => {
			const oligo = testPart.createOligo(vh, 5, 6, '#ff0000');
			const segment = oligo.segments.values().next().value!;

			expect(vh.strandSets[0].isIndexOccupied(5)).toBe(true);
			expect(vh.strandSets[0].isIndexOccupied(6)).toBe(true);
			expect(vh.strandSets[0].isIndexOccupiedBy(5)).toBe(segment);
		});

		it('should handle reversed strand correctly', () => {
			testPart.createOligo(vh, 10, 0, '#ff0000'); // strand 1

			expect(vh.strandSets[1].isIndexOccupied(0)).toBe(true);
			expect(vh.strandSets[1].isIndexOccupied(10)).toBe(true);
			expect(vh.strandSets[1].isIndexOccupied(5)).toBe(true);
		});

		it('should handle edge of VH length', () => {
			const maxIdx = vh.length - 1;
			testPart.createOligo(vh, maxIdx - 5, maxIdx, '#ff0000');

			expect(vh.strandSets[0].isIndexOccupied(maxIdx)).toBe(true);
			expect(vh.strandSets[0].isIndexOccupied(maxIdx - 3)).toBe(true);
		});
	});
});
