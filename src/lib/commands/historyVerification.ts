import FoldnanoDocument, { type DocSnapshot } from '$lib/model/document.svelte';
import { SpatialIndexService } from '$lib/model/Part/SpatialIndexService';
import { applyAtomicChanges, type HistoryEntry } from './historyChanges';

const sortKeys = (value: unknown): unknown => {
	if (Array.isArray(value)) return value.map(sortKeys);
	if (value === null || typeof value !== 'object') return value;
	return Object.fromEntries(
		Object.keys(value)
			.sort()
			.map((key) => [key, sortKeys((value as Record<string, unknown>)[key])])
	);
};

/** Deep copy with object keys sorted and order-insensitive collections sorted: `virtualHelices`
 * (display order lives in `listRow`, not array position) and `strandSets[].segmentIds` (a set
 * serialized as an array). */
export function canonicalSnapshot(snapshot: DocSnapshot): DocSnapshot {
	const copy = sortKeys(JSON.parse(JSON.stringify(snapshot))) as DocSnapshot;
	for (const part of copy.parts) {
		part.virtualHelices.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
		for (const vh of part.virtualHelices) {
			for (const strandSet of vh.strandSets) strandSet.segmentIds.sort();
		}
	}
	return copy;
}

/** Path and values of the first difference between two JSON values, or null when equal. */
export function firstDifference(actual: unknown, expected: unknown, path = ''): string | null {
	if (JSON.stringify(actual) === JSON.stringify(expected)) return null;
	if (
		typeof actual !== 'object' ||
		typeof expected !== 'object' ||
		actual === null ||
		expected === null
	) {
		const show = (value: unknown) => JSON.stringify(value)?.slice(0, 200);
		return `${path || '<root>'}: got ${show(actual)}, expected ${show(expected)}`;
	}
	const a = actual as Record<string, unknown>;
	const b = expected as Record<string, unknown>;
	for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
		const difference = firstDifference(a[key], b[key], `${path}.${key}`);
		if (difference) return difference;
	}
	return path || '<root>';
}

/** Replays `entry` on a scratch copy of `after`: undo must reproduce `before` and redo must
 * reproduce `after`. Returns a description of the first mismatch, or null. */
export function verifyHistoryEntry(
	before: DocSnapshot,
	after: DocSnapshot,
	entry: HistoryEntry
): string | null {
	const scratch = FoldnanoDocument.fromJSON(after);
	const check = (step: 'undo' | 'redo', expected: DocSnapshot): string | null => {
		try {
			applyAtomicChanges(scratch, step === 'undo' ? entry.undo : entry.redo);
		} catch (err) {
			return `${step} threw: ${err instanceof Error ? err.message : String(err)}`;
		}
		const difference = firstDifference(
			canonicalSnapshot(scratch.toJSON()),
			canonicalSnapshot(expected)
		);
		return (
			difference &&
			`${step} does not restore the ${step === 'undo' ? 'pre' : 'post'}-edit document at ${difference}`
		);
	};
	return check('undo', before) ?? check('redo', after);
}

/** First way the live document's derived state disagrees with the model it derives from, or
 * null: `segmentsLookup` and `segment.oligo` must match `part.oligos`, and the live spatial index
 * must match one rebuilt from scratch, position by position. `toJSON` can't see any of these. */
export function findDerivedStateMismatch(doc: FoldnanoDocument): string | null {
	for (const part of doc.parts) {
		for (const oligo of part.oligos) {
			for (const segment of oligo.segments) {
				if (part.getSegmentById(segment.id) !== segment) {
					return `segmentsLookup is stale for segment ${segment.id}`;
				}
				if (segment.oligo !== oligo) return `segment ${segment.id} resolves to the wrong oligo`;
			}
		}
		const rebuilt = new SpatialIndexService();
		rebuilt.rebuildFromOligos(part.oligos);
		for (const vh of part.virtualHelices) {
			for (const strandIdx of [0, 1] as const) {
				for (let bp = 0; bp < vh.length; bp++) {
					const live = part.getEntitiesAtVh(vh.id, strandIdx, bp);
					const segment = rebuilt.getSegmentAt(vh.id, strandIdx, bp);
					const ends = rebuilt.getEndsAt(vh.id, strandIdx, bp);
					const end = segment
						? (ends.find((e) => e.segment === segment) ?? null)
						: (ends[0] ?? null);
					const oligo = segment ? rebuilt.getOligoBySegmentId(segment.id) : null;
					const where = `VH ${vh.index} strand ${strandIdx} bp ${bp}`;
					if (live.segment !== segment) return `spatial index segment is stale at ${where}`;
					if (live.oligo !== oligo) return `spatial index oligo is stale at ${where}`;
					if (live.end !== end) return `spatial index end is stale at ${where}`;
				}
			}
		}
	}
	return null;
}
