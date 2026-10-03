import type { SegmentEnd } from '../../model/Oligo';

export interface Selection {
	ends: Set<SegmentEnd>;
	set(ends: SegmentEnd[]): void;
	add(ends: SegmentEnd[]): void;
	remove(ends: SegmentEnd[]): void;
	clear(): void;
}

/** for now to make things cleaner, this Selection context only hold SegmentEnds, either free or connected  */
export function createSelection(): Selection {
	const setEnds = new Set<SegmentEnd>();
	return {
		ends: setEnds,
		set(ends) {
			setEnds.clear();
			ends.forEach((end) => setEnds.add(end));
		},
		add(ends) {
			ends.forEach((end) => setEnds.add(end));
		},
		remove(ends) {
			ends.forEach((end) => setEnds.delete(end));
		},
		clear() {
			setEnds.clear();
		},
	};
}

// export interface Selection {
//   ids: Set<string>;
//   set(ids: string[]): void;
//   add(ids: string[]): void;
//   remove(ids: string[]): void;
//   clear(): void;
// }

// /** for now to make things cleaner, this Selection context only hold SegmentEnds, either free or connected  */
// export function createSelection(): Selection {
//   const setIds = new Set<string>();
//   return {
//     ids: setIds,
//     set(ids) { setIds.clear(); ids.forEach(id => setIds.add(id)); },
//     add(ids) { ids.forEach(id => setIds.add(id)); },
//     remove(ids) { ids.forEach(id => setIds.delete(id)); },
//     clear() { setIds.clear(); },
//   };
// }
