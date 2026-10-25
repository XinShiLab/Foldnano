// src/editor/tools/selectHelpers.ts
import type { Category, HitResult, LeafTarget } from '../../core/modes';
import type { SegmentEnd } from '$lib/model/Oligo';

export function allowedByUserFilter(
	leafOrCat: LeafTarget | Category,
	getSelectFilter?: () => ReadonlySet<LeafTarget | Category>
) {
	const f = getSelectFilter?.();
	// If no filter provided, or empty set, treat as “no restriction”
	if (!f || f.size === 0) return true;
	return f.has(leafOrCat);
}

export function filterHitsByUserFilter(
	hits: HitResult[],
	filter: ReadonlySet<LeafTarget | Category>
): HitResult[] {
	const getFilter = () => filter;
	return hits.filter((h) => {
		// Strand hits must pass both the kind toggle and the SCAF/STAP toggle
		if (h.category === 'SCAF' || h.category === 'STAP') {
			return allowedByUserFilter(h.kind, getFilter) && allowedByUserFilter(h.category, getFilter);
		}
		return (
			allowedByUserFilter(h.kind, getFilter) ||
			allowedByUserFilter(h.category || 'UNKNOWN', getFilter)
		);
	});
}

export function strandCategoryOf(end: SegmentEnd): Category {
	return end.segment.oligo?.isScaffold ? 'SCAF' : 'STAP';
}

/** Drops ends whose strand type (scaffold/staple) is toggled off in the SCAF/STAP filter. */
export function filterEndsByStrandType(
	ends: SegmentEnd[],
	filter: ReadonlySet<LeafTarget | Category>
): SegmentEnd[] {
	return ends.filter((end) => filter.has(strandCategoryOf(end)));
}

export function isDefined<T>(v: T | undefined | null): v is T {
	return v !== undefined && v !== null;
}
