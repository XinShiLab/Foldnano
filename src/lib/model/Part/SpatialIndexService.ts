import { SvelteMap } from 'svelte/reactivity';
import type Oligo from '../Oligo';
import type { SegmentEnd } from '../Oligo';
import type OligoSegment from '../Oligo/OligoSegment.svelte';

/**
 * SpatialIndexService
 *
 * A dedicated service for managing spatial indexing and caching of oligo segments
 * and their ends in (row, strand, base-pair) coordinate space.
 *
 * This service provides O(1) lookups for:
 * - Finding which segment occupies a given (row, strand, bp) position
 * - Finding segment ends at a given position
 * - Mapping segments back to their parent oligos
 *
 * The cache uses numeric keys (packed coordinates) to minimize memory overhead
 * and reduce garbage collection pressure.
 */
export class SpatialIndexService {
	// Use per-VH packed numeric keys to reduce string alloc/GC pressure.
	// Inner key format: strandIdx * 1_000_000 + bpIdx
	private _vhCoordToSegmentCache = new SvelteMap<string, Map<number, OligoSegment>>();
	private _vhCoordToEndsCache = new SvelteMap<string, Map<number, SegmentEnd[]>>();
	private _segmentIdToOligo = new SvelteMap<string, Oligo>();

	/**
	 * Packs (strand, bp) coordinates into a single numeric key.
	 * Assumes bpIdx < 1_000_000.
	 */
	private _strandBpKey(strandIdx: 0 | 1, bpIdx: number): number {
		return strandIdx * 1_000_000 + bpIdx;
	}

	private _getOrCreateSegmentCache(vhId: string): Map<number, OligoSegment> {
		let cache = this._vhCoordToSegmentCache.get(vhId);
		if (!cache) {
			cache = new Map<number, OligoSegment>();
			this._vhCoordToSegmentCache.set(vhId, cache);
		}
		return cache;
	}

	private _getOrCreateEndsCache(vhId: string): Map<number, SegmentEnd[]> {
		let cache = this._vhCoordToEndsCache.get(vhId);
		if (!cache) {
			cache = new Map<number, SegmentEnd[]>();
			this._vhCoordToEndsCache.set(vhId, cache);
		}
		return cache;
	}

	/**
	 * Caches a segment end at its coordinate position.
	 */
	private _cacheEnd(end: SegmentEnd): void {
		const vhId = end.segment.inVirtualHelix.id;
		const { strandIdx, bpIdx } = end.ntIndices;
		const key = this._strandBpKey(strandIdx, bpIdx);
		const cache = this._getOrCreateEndsCache(vhId);
		const arr = cache.get(key) ?? [];
		if (!arr.includes(end)) arr.push(end);
		cache.set(key, arr);
	}

	/**
	 * Caches a segment's entire range in the spatial index.
	 * This allows O(1) lookup of which segment occupies any position.
	 */
	cacheSegmentRange(oligo: Oligo, segment: OligoSegment): void {
		this._segmentIdToOligo.set(segment.id, oligo);
		const vhId = segment.inVirtualHelix.id;
		const strandIdx = segment.inStrandIndex;
		const start = Math.min(segment.fivePrime.index, segment.threePrime.index);
		const end = Math.max(segment.fivePrime.index, segment.threePrime.index);
		const cache = this._getOrCreateSegmentCache(vhId);

		// Cache every base pair position in the segment's range
		for (let bp = start; bp <= end; bp++) {
			const key = this._strandBpKey(strandIdx, bp);
			cache.set(key, segment);
		}

		// Cache the segment's two ends
		this._cacheEnd(segment.fivePrime);
		this._cacheEnd(segment.threePrime);
	}

	/**
	 * Removes a segment's range from the spatial index.
	 */
	uncacheSegmentRange(segment: OligoSegment): void {
		const vhId = segment.inVirtualHelix.id;
		const strandIdx = segment.inStrandIndex;
		const start = Math.min(segment.fivePrime.index, segment.threePrime.index);
		const end = Math.max(segment.fivePrime.index, segment.threePrime.index);
		const segmentCache = this._vhCoordToSegmentCache.get(vhId);
		const endsCache = this._vhCoordToEndsCache.get(vhId);

		// Remove every base pair position in the segment's range
		for (let bp = start; bp <= end; bp++) {
			const key = this._strandBpKey(strandIdx, bp);
			if (segmentCache?.get(key) === segment) {
				segmentCache.delete(key);
			}
		}

		// Remove segment ends
		const rmEnd = (endObj: SegmentEnd) => {
			const k = this._strandBpKey(endObj.ntIndices.strandIdx, endObj.ntIndices.bpIdx);
			const arr = endsCache?.get(k);
			if (!arr) return;
			const idx = arr.indexOf(endObj);
			if (idx !== -1) arr.splice(idx, 1);
			if (arr.length === 0) endsCache?.delete(k);
			else endsCache?.set(k, arr);
		};

		rmEnd(segment.fivePrime);
		rmEnd(segment.threePrime);
		if (segmentCache?.size === 0) this._vhCoordToSegmentCache.delete(vhId);
		if (endsCache?.size === 0) this._vhCoordToEndsCache.delete(vhId);
		this._segmentIdToOligo.delete(segment.id);
	}

	/**
	 * Caches all segments of an oligo.
	 */
	cacheOligo(oligo: Oligo): void {
		for (const segment of oligo.segments) {
			this.cacheSegmentRange(oligo, segment);
		}
	}

	/**
	 * Removes all segments of an oligo from the cache.
	 */
	uncacheOligo(oligo: Oligo): void {
		for (const segment of oligo.segments) {
			this.uncacheSegmentRange(segment);
		}
	}

	/**
	 * Completely rebuilds the spatial index from a collection of oligos.
	 */
	rebuildFromOligos(oligos: Iterable<Oligo>): void {
		this._vhCoordToSegmentCache.clear();
		this._vhCoordToEndsCache.clear();
		this._segmentIdToOligo.clear();

		for (const oligo of oligos) {
			this.cacheOligo(oligo);
		}
	}

	/**
	 * Queries the spatial index for a segment at the given coordinates.
	 * Returns null if no segment occupies that position.
	 */
	getSegmentAt(vhId: string, strandIdx: 0 | 1, bpIdx: number): OligoSegment | null {
		const key = this._strandBpKey(strandIdx, bpIdx);
		return this._vhCoordToSegmentCache.get(vhId)?.get(key) || null;
	}

	/**
	 * Queries the spatial index for segment ends at the given coordinates.
	 * Returns an empty array if no ends exist at that position.
	 */
	getEndsAt(vhId: string, strandIdx: 0 | 1, bpIdx: number): SegmentEnd[] {
		const key = this._strandBpKey(strandIdx, bpIdx);
		return this._vhCoordToEndsCache.get(vhId)?.get(key) || [];
	}

	/**
	 * Gets the parent oligo for a given segment.
	 * Returns null if the mapping is not cached.
	 */
	getOligoBySegmentId(segmentId: string): Oligo | null {
		return this._segmentIdToOligo.get(segmentId) || null;
	}

	/**
	 * Manually sets the oligo for a segment ID (for backfilling cache misses).
	 */
	setOligoForSegment(segmentId: string, oligo: Oligo): void {
		this._segmentIdToOligo.set(segmentId, oligo);
	}

	/**
	 * Clears all caches. Useful for testing or full resets.
	 */
	clear(): void {
		this._vhCoordToSegmentCache.clear();
		this._vhCoordToEndsCache.clear();
		this._segmentIdToOligo.clear();
	}
}
