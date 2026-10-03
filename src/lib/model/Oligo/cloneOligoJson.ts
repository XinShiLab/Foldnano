import { v4 as uuidv4 } from 'uuid';
import type Oligo from './Oligo.svelte';

export type OligoJSON = ReturnType<Oligo['toJSON']>;

/**
 * Deep-copies a whole oligo's JSON with fresh oligo/segment ids, shifted along the helix
 * axis by `bpOffset`. Every crossover must be internal to the oligo (true for a whole
 * oligo), so `connectedSegmentId`s are remapped through the old→new segment id map.
 * Repeat-group membership is not copied: a copy is neither an original nor a mirror.
 */
export function cloneOligoJsonWithOffset(
	json: OligoJSON,
	bpOffset: number,
	makeId: () => string = uuidv4
): OligoJSON {
	const segmentIdMap = new Map(json.segments.map((s) => [s.id, makeId()]));
	const remap = (id: string | null): string | null => {
		if (id === null) return null;
		const mapped = segmentIdMap.get(id);
		if (!mapped) throw new Error(`Segment ${id} is connected outside the copied oligo`);
		return mapped;
	};

	return {
		...json,
		id: makeId(),
		repeatGroupId: undefined,
		mirrorOf: undefined,
		segments: json.segments.map((seg) => {
			const newId = segmentIdMap.get(seg.id)!;
			return {
				...seg,
				id: newId,
				fivePrime: {
					...seg.fivePrime,
					segmentId: newId,
					index: seg.fivePrime.index + bpOffset,
					connectedSegmentId: remap(seg.fivePrime.connectedSegmentId),
				},
				threePrime: {
					...seg.threePrime,
					segmentId: newId,
					index: seg.threePrime.index + bpOffset,
					connectedSegmentId: remap(seg.threePrime.connectedSegmentId),
				},
				slots: seg.slots.map((s) => ({ bpIndex: s.bpIndex + bpOffset, seq: s.seq })),
			};
		}),
	};
}
