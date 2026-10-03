// src/editor/tools/selectHelpers.ts
import { isLeafAllowed } from '../../core/capabilities';
import type { Category, LeafTarget } from '../../core/modes';
import type { EditorMode } from '../../core/modes';

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

export function isDefined<T>(v: T | undefined | null): v is T {
	return v !== undefined && v !== null;
}
