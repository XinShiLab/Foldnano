import { SvelteSet } from 'svelte/reactivity';
import VirtualHelix from './VirtualHelix.svelte';
import { OligoSegment } from '../Oligo';

/**
 * from original cadnano documentation:
 * 
 * StrandSet is a container class for Strands, and provides the several
 * publicly accessible methods for editing strands, including operations
 * for creation, destruction, resizing, splitting, and merging strands.

  * Views may also query StrandSet for information that is useful in
  * determining if edits can be made, such as the bounds of empty space in
  * which a strand can be created or resized.
  */
export default class StrandSet {
	readonly ownerVh: VirtualHelix;
	strandIndex: 0 | 1;
	// oligoSegments: Set<OligoSegment> = new SvelteSet(); // set of OligoSegment objects belonging to this StrandSet
	segmentIds: Set<string> = new SvelteSet();

	// Cache: memoized occupied indices and merged intervals keyed by a cheap "signature" of segments
	// #occupiedCache: SvelteSet<number> | null = null;
	#mergedIntervalsCache: Array<[number, number]> | null = null;
	#segmentsSignature: string | null = null;

	constructor(vh: VirtualHelix, strandIndex: 0 | 1) {
		this.ownerVh = vh;
		this.strandIndex = strandIndex;
	}

	get _oligoSegments() {
		const segments = new SvelteSet<OligoSegment>();
		for (const id of this.segmentIds) {
			const segment = this.ownerVh.inPart.getSegmentById(id);
			if (segment) {
				segments.add(segment);
			}
		}
		return segments;
	}
	toJSON() {
		return {
			strandIndex: this.strandIndex,
			segmentIds: Array.from(this.segmentIds),
		};
	}

	static fromJSON(json: ReturnType<StrandSet['toJSON']>, ownerVh: VirtualHelix): StrandSet {
		const strandSet = new StrandSet(ownerVh, json.strandIndex);
		strandSet.segmentIds = new SvelteSet<string>(json.segmentIds);
		return strandSet;
	}

	get owner() {
		return this.ownerVh;
	}

	get length() {
		return this.ownerVh.length;
	}

	get isEmpty(): boolean {
		return this.segmentIds.size === 0;
	}

	// Build a stable, cheap signature and normalized, sorted ranges
	private getNormalizedRanges(): Array<[number, number]> {
		const ranges: Array<[number, number]> = [];
		for (const id of this.segmentIds) {
			const seg = this.ownerVh.inPart.getSegmentById(id);
			if (!seg) continue;
			const a = seg.fivePrime.index;
			const b = seg.threePrime.index;
			const lo = a <= b ? a : b;
			const hi = a <= b ? b : a;
			ranges.push([lo, hi]);
		}
		ranges.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
		return ranges;
	}

	private getRangesSignature(ranges: Array<[number, number]>): string {
		// e.g. "3-10|12-15|20-25"
		return ranges.map(([lo, hi]) => `${lo}-${hi}`).join('|');
	}

	private getMergedIntervals(): Array<[number, number]> {
		const ranges = this.getNormalizedRanges();
		const signature = this.getRangesSignature(ranges);
		if (
			this.#mergedIntervalsCache &&
			this.#mergedIntervalsCache.length !== 0 &&
			this.#segmentsSignature === signature
		) {
			return this.#mergedIntervalsCache;
		}
		// Merge overlapping/adjacent intervals
		const merged: Array<[number, number]> = [];
		for (const [lo, hi] of ranges) {
			const last = merged[merged.length - 1];
			if (!last) {
				merged.push([lo, hi]);
			} else if (lo <= last[1] + 1) {
				last[1] = Math.max(last[1], hi);
			} else {
				merged.push([lo, hi]);
			}
		}
		this.#mergedIntervalsCache = merged;
		this.#segmentsSignature = signature;
		return merged;
	}

	getSegmentEndIndices(): SvelteSet<number> {
		const endIndices = new SvelteSet<number>();
		for (const id of this.segmentIds) {
			const segment = this.ownerVh.inPart.getSegmentById(id);
			if (!segment) continue;
			endIndices.add(segment.fivePrime.index);
			endIndices.add(segment.threePrime.index);
		}
		return endIndices;
	}

	// Public, cached access to merged occupied intervals (read‑only view)
	get mergedIntervals(): ReadonlyArray<[number, number]> {
		return this.getMergedIntervals();
	}

	// get occupiedIndices(): SvelteSet<number> {
	//   // Memoize the expensive set construction behind a segments signature.
	//   const ranges = this.getNormalizedRanges();
	//   const signature = this.getRangesSignature(ranges);
	//   if (this.#occupiedCache && this.#segmentsSignature === signature) {
	//     return this.#occupiedCache;
	//   }
	//   const occupied = new SvelteSet<number>();
	//   // Still O(total covered length), but only recomputed when segments actually change.
	//   for (const [start, end] of ranges) {
	//     for (let i = start; i <= end; i++) {
	//       occupied.add(i);
	//     }
	//   }
	//   this.#occupiedCache = occupied;
	//   this.#segmentsSignature = signature;
	//   // Invalidate merged cache if it belongs to a different signature (safety if called first)
	//   this.#mergedIntervalsCache = null;
	//   return occupied;
	// }

	isIndexOccupied(index: number): boolean {
		// O(k) where k = number of merged intervals (typically small)
		const intervals = this.getMergedIntervals();

		for (const [lo, hi] of intervals) {
			if (index < lo) break;
			if (index <= hi) return true;
		}
		return false;
	}

	isRangeOccupied(startIndex: number, endIndex: number): boolean {
		// Check if any merged interval intersects [lo, hi]
		const lo = Math.min(startIndex, endIndex);
		const hi = Math.max(startIndex, endIndex);
		const intervals = this.getMergedIntervals();
		for (const [a, b] of intervals) {
			if (b < lo) continue;
			if (a > hi) break;
			return true; // overlap
		}
		return false;
	}

	isIndexOccupiedBy(index: number): OligoSegment | null {
		// O(n) in number of segments, with constant-time range checks (no per-index loops)
		for (const id of this.segmentIds) {
			const segment = this.ownerVh.inPart.getSegmentById(id);
			if (!segment) continue;
			const a = segment.fivePrime.index;
			const b = segment.threePrime.index;
			const lo = a <= b ? a : b;
			const hi = a <= b ? b : a;
			if (index >= lo && index <= hi) {
				return segment;
			}
		}
		return null;
	}

	isRangeOccupiedBy(startIndex: number, endIndex: number): SvelteSet<OligoSegment> {
		// Return segments whose interval overlaps the query range; no per-index iteration
		const occupiedSegments = new SvelteSet<OligoSegment>();
		const lo = Math.min(startIndex, endIndex);
		const hi = Math.max(startIndex, endIndex);
		for (const id of this.segmentIds) {
			const segment = this.ownerVh.inPart.getSegmentById(id);
			if (!segment) continue;
			const a = segment.fivePrime.index;
			const b = segment.threePrime.index;
			const sLo = a <= b ? a : b;
			const sHi = a <= b ? b : a;
			if (sHi >= lo && sLo <= hi) {
				occupiedSegments.add(segment);
			}
		}
		return occupiedSegments;
	}
}
