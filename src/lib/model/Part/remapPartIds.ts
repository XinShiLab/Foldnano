import { v4 as uuidv4, v5 as uuidv5 } from 'uuid';
import type { Part } from './Part.svelte';

type PartJSON = ReturnType<Part['toJSON']>;

/** Fields holding one entity id (an object's own `id`, or a reference to one). */
const ID_FIELDS = new Set([
	'id',
	'planeId',
	'regionId',
	'segmentId',
	'connectedSegmentId',
	'repeatGroupId',
	'groupId',
	'instanceId',
	'sourceOligoId',
	// Sticky-end anchors (`Part.stickyRecords`).
	'oligoId',
]);
/** Fields holding a list of entity ids. */
const ID_LIST_FIELDS = new Set(['vhOrder', 'segmentIds']);
/** Fields holding an id → id map (keys and values are both ids). */
const ID_MAP_FIELDS = new Set(['vhMap']);
/** Fields never rewritten: a linked Part's `source` names ids inside its source design. */
const SKIPPED_FIELDS = new Set(['source']);

/** Namespace for `stableIdsFor`; fixed, so the same inputs always give the same ids. */
const LINKED_COPY_NAMESPACE = 'b8c1d3a4-6f0e-4d52-9a7b-2e5f8c4d1a90';

/**
 * Ids for a linked copy: derived from the copy's own Part id and the source id, so updating the
 * copy keeps every surviving entity's id (active region, hidden regions, selection), while two
 * copies of one source still never share an id.
 */
export function stableIdsFor(copyPartId: string): (oldId: string) => string {
	const namespace = uuidv5(copyPartId, LINKED_COPY_NAMESPACE);
	return (oldId) => uuidv5(oldId, namespace);
}

/**
 * A copy of `json` where every entity id (each `id` field: the Part, planes, regions, helices,
 * oligos, segments, repeat groups…) is replaced by `newId(old)` (a fresh uuid by default), and
 * every reference to one (`planeId`, `regionId`, `vhOrder`, `segmentIds`, end connections, mirror
 * sources…) follows. Only id fields are rewritten: sequences, names and other content stay as
 * they are even when they happen to equal an id.
 */
export function remapPartIds(
	json: PartJSON,
	newId: (oldId: string) => string = () => uuidv4()
): PartJSON {
	const ids = new Map<string, string>();
	const collect = (value: unknown): void => {
		if (Array.isArray(value)) return value.forEach(collect);
		if (value === null || typeof value !== 'object') return;
		for (const [key, child] of Object.entries(value)) {
			if (SKIPPED_FIELDS.has(key)) continue;
			if (key === 'id' && typeof child === 'string' && !ids.has(child))
				ids.set(child, newId(child));
			collect(child);
		}
	};
	const mapId = (value: unknown) => (typeof value === 'string' ? (ids.get(value) ?? value) : value);
	const rewrite = (value: unknown): unknown => {
		if (Array.isArray(value)) return value.map(rewrite);
		if (value === null || typeof value !== 'object') return value;
		return Object.fromEntries(
			Object.entries(value).map(([key, child]) => {
				if (SKIPPED_FIELDS.has(key)) return [key, child];
				if (ID_FIELDS.has(key)) return [key, mapId(child)];
				if (ID_LIST_FIELDS.has(key) && Array.isArray(child)) return [key, child.map(mapId)];
				if (ID_MAP_FIELDS.has(key) && child && typeof child === 'object') {
					return [
						key,
						Object.fromEntries(
							Object.entries(child).map(([from, to]) => [mapId(from) as string, mapId(to)])
						),
					];
				}
				return [key, rewrite(child)];
			})
		);
	};
	collect(json);
	return rewrite(JSON.parse(JSON.stringify(json))) as PartJSON;
}
