// src/editor/tools/selectHelpers.ts
import { isLeafAllowed } from '../../core/capabilities';
import type { Category, HitResult, LeafTarget } from '../../core/modes';
import type { EditorMode } from '../../core/modes';
import type { SegmentEnd } from '$lib/model/Oligo';

// const leaves= new Set(["END", "XOVER", "SEGMENT", "OLIGO", "VH_TAG"]) as Set<LeafTarget>;

export function allowedByUserFilter(
	leafOrCat: LeafTarget | Category,
	getSelectFilter?: () => ReadonlySet<LeafTarget | Category>
) {
	const f = getSelectFilter?.();
	// If no filter provided, or empty set, treat as “no restriction”
	if (!f || f.size === 0) return true;
	return f.has(leafOrCat);
}

export function allowedForSelect(
	mode: EditorMode, // 'SELECT'
	leaf: LeafTarget,
	getSelectFilter?: () => ReadonlySet<LeafTarget | Category>
) {
	// must pass BOTH capability rule and user filter
	return isLeafAllowed(mode, leaf) && allowedByUserFilter(leaf, getSelectFilter);
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
