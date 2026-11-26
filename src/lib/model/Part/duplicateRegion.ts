import { v4 as uuidv4 } from 'uuid';
import type { Part, RepeatGroup } from './Part.svelte';
import { nextGroupName, oligoFingerprint } from './repeatGroups';
import { DesignRegion } from './DesignRegion';
import { Plane } from './Plane.svelte';
import Oligo, { type MirrorTag } from '../Oligo/Oligo.svelte';
import type { OligoJSON } from '../Oligo/cloneOligoJson';
import VirtualHelix from '../VirtualHelix/VirtualHelix.svelte';
import { BACKBONE_RADIUS_NM, BACKBONE_RISE_NM } from '../geometry3d/dnaGeometry';

type SegmentJSON = OligoJSON['segments'][number];

/** An offset that moves every VH index past the part's current ones. Even, so lattice parity
 * conventions tied to the index (cadnano IO) carry over to the copies. */
export function evenVhIndexOffset(part: Part): number {
	const maxIndex = Math.max(-1, ...part.virtualHelices.map((vh) => vh.index));
	return (maxIndex + 1) % 2 === 0 ? maxIndex + 1 : maxIndex + 2;
}

/** Clearance (nm) between the original region and its copy, past the helix surfaces. */
const COPY_GAP_NM = 5;
const EMPTY_REGION_SHIFT_NM = 10;

/**
 * Adds an independent copy of a region: a new plane (shifted along the plane's `u` so the copy
 * sits beside the original in 3D), a new region inserted after it, its helices and every strand
 * on them. Nothing in the copy is linked to the original region. A repeat group that lies wholly
 * inside the region is carried over as a new group of the copy's own (its copied originals and
 * mirrors); copies of any other group's oligos are plain. A strand that crosses into another
 * region is copied only up to the boundary; the cut crossovers become free ends, and a strand cut
 * into several pieces becomes one oligo per piece. Call inside a `snapshotTx`.
 */
export function duplicateRegion(part: Part, regionId: string): DesignRegion {
	const region = part.getRegionById(regionId);
	if (!region) throw new Error(`Region ${regionId} not found`);
	const plane = part.getPlaneById(region.planeId);
	if (!plane) throw new Error(`Plane ${region.planeId} of region ${region.name} not found`);

	const sourceVhs = region.vhOrder
		.map((id) => part.getVhById(id))
		.filter((vh): vh is VirtualHelix => vh !== null);

	const indexOffset = evenVhIndexOffset(part);
	const vhIndexMap = new Map(sourceVhs.map((vh) => [vh.index, vh.index + indexOffset]));
	const vhIdMap = new Map(sourceVhs.map((vh) => [vh.id, uuidv4()]));

	const isInside = (oligo: Oligo) =>
		[...oligo.segments].every((seg) => vhIndexMap.has(seg.inVirtualHelix.index));
	const groupCopies = copyContainedGroups(part, isInside);

	const segmentIdMap = new Map<string, string>();
	const oligoIdMap = new Map<string, string>();
	const oligoJsons: OligoJSON[] = [];
	const mirrorCopies: { copyId: string; tag: MirrorTag; groupCopy: GroupCopy }[] = [];
	for (const oligo of part.oligos) {
		const inside = oligo.toJSON().segments.filter((seg) => vhIndexMap.has(seg.inVirtualHelixIndex));
		if (inside.length === 0) continue;
		for (const piece of connectedPieces(inside)) {
			for (const seg of piece) segmentIdMap.set(seg.id, uuidv4());
			const json = copyPiece(oligo, piece, segmentIdMap, vhIndexMap);
			oligoIdMap.set(oligo.id, json.id);
			const groupId = oligo.repeatGroupId ?? oligo.mirrorOf?.groupId;
			const groupCopy = groupId ? groupCopies.get(groupId) : undefined;
			if (groupCopy && oligo.mirrorOf) {
				mirrorCopies.push({ copyId: json.id, tag: oligo.mirrorOf, groupCopy });
			} else if (groupCopy) {
				json.repeatGroupId = groupCopy.group.id;
			}
			oligoJsons.push(json);
		}
	}

	const newPlane = Plane.fromJSON({
		...plane.toJSON(),
		u: { ...plane.u },
		v: { ...plane.v },
		normal: { ...plane.normal },
		id: uuidv4(),
		name: part.nextPlaneName(),
		origin: shiftedOrigin(part, plane, sourceVhs),
	});
	part.addPlane(newPlane);

	const newRegion = DesignRegion.fromJSON({
		...region.toJSON(),
		id: uuidv4(),
		name: part.nextRegionName(region.kind),
		planeId: newPlane.id,
		vhOrder: region.vhOrder.flatMap((id) => vhIdMap.get(id) ?? []),
	});
	part.insertRegionAfter(regionId, newRegion);

	const newVhs = sourceVhs.map((vh) => {
		const json = vh.toJSON();
		return VirtualHelix.fromJSON(
			{
				...json,
				id: vhIdMap.get(vh.id)!,
				index: vhIndexMap.get(vh.index)!,
				regionId: newRegion.id,
				latticeCoords: json.latticeCoords ? { ...json.latticeCoords } : json.latticeCoords,
				localFrame: json.localFrame && JSON.parse(JSON.stringify(json.localFrame)),
				strandSets: json.strandSets.map((ss) => ({
					...ss,
					segmentIds: ss.segmentIds.flatMap((id) => segmentIdMap.get(id) ?? []),
				})),
			},
			part
		);
	});
	part.virtualHelices = [...part.virtualHelices, ...newVhs];

	const copies = oligoJsons.map((json) => Oligo.fromJSON(json, part));
	part.addOligosFromArray(copies);

	// Mirror tags carry a fingerprint that includes the VH index, so they are re-derived from the
	// copied source; the sync then sees each copied mirror as up to date and keeps it.
	const copyById = new Map(copies.map((copy) => [copy.id, copy]));
	for (const { copyId, tag, groupCopy } of mirrorCopies) {
		const copy = copyById.get(copyId)!;
		const source = copyById.get(oligoIdMap.get(tag.sourceOligoId)!)!;
		copy.mirrorOf = {
			groupId: groupCopy.group.id,
			instanceId: groupCopy.instanceIdMap.get(tag.instanceId)!,
			sourceOligoId: source.id,
			structure: oligoFingerprint(source, 0, false),
		} satisfies MirrorTag;
	}
	for (const { group } of groupCopies.values()) part.repeatGroups.push(group);
	return newRegion;
}

interface GroupCopy {
	group: RepeatGroup;
	instanceIdMap: Map<string, string>;
}

/** New groups (same offsets, fresh ids and names) for each repeat group whose originals and
 * mirrors all lie wholly inside the region, keyed by the source group's id. */
function copyContainedGroups(part: Part, isInside: (oligo: Oligo) => boolean) {
	const members = new Map<string, Oligo[]>();
	for (const oligo of part.oligos) {
		const groupId = oligo.repeatGroupId ?? oligo.mirrorOf?.groupId;
		if (groupId) members.set(groupId, [...(members.get(groupId) ?? []), oligo]);
	}
	const copies = new Map<string, GroupCopy>();
	const taken = { repeatGroups: [...part.repeatGroups] };
	for (const group of part.repeatGroups) {
		const oligos = members.get(group.id) ?? [];
		if (!oligos.some((o) => !o.mirrorOf) || !oligos.every(isInside)) continue;
		const instanceIdMap = new Map(group.instances.map((i) => [i.id, uuidv4()]));
		const copy: RepeatGroup = {
			id: uuidv4(),
			name: nextGroupName(taken),
			instances: group.instances.map((i) => ({ ...i, id: instanceIdMap.get(i.id)! })),
		};
		taken.repeatGroups.push(copy);
		copies.set(group.id, { group: copy, instanceIdMap });
	}
	return copies;
}

/** Groups segments into the chains their crossovers still join once the outside ones are gone. */
function connectedPieces(segments: SegmentJSON[]): SegmentJSON[][] {
	const byId = new Map(segments.map((seg) => [seg.id, seg]));
	const seen = new Set<string>();
	const pieces: SegmentJSON[][] = [];
	for (const start of segments) {
		if (seen.has(start.id)) continue;
		const piece: SegmentJSON[] = [];
		const stack = [start];
		seen.add(start.id);
		while (stack.length > 0) {
			const seg = stack.pop()!;
			piece.push(seg);
			for (const id of [seg.fivePrime.connectedSegmentId, seg.threePrime.connectedSegmentId]) {
				const next = id ? byId.get(id) : undefined;
				if (next && !seen.has(next.id)) {
					seen.add(next.id);
					stack.push(next);
				}
			}
		}
		pieces.push(piece);
	}
	return pieces;
}

function copyPiece(
	oligo: Oligo,
	piece: SegmentJSON[],
	segmentIdMap: Map<string, string>,
	vhIndexMap: Map<number, number>
): OligoJSON {
	const copyEnd = (end: SegmentJSON['fivePrime'], segmentId: string) => {
		const connected = end.connectedSegmentId ? segmentIdMap.get(end.connectedSegmentId) : null;
		return {
			...end,
			segmentId,
			connectedSegmentId: connected ?? null,
			isConstrained: connected ? end.isConstrained : false,
		};
	};
	const json = oligo.toJSON();
	return {
		...json,
		id: uuidv4(),
		repeatGroupId: undefined,
		mirrorOf: undefined,
		segments: piece.map((seg) => {
			const id = segmentIdMap.get(seg.id)!;
			return {
				...seg,
				id,
				inVirtualHelixIndex: vhIndexMap.get(seg.inVirtualHelixIndex)!,
				fivePrime: copyEnd(seg.fivePrime, id),
				threePrime: copyEnd(seg.threePrime, id),
				slots: seg.slots.map((s) => ({ ...s })),
			};
		}),
	};
}

/** The plane origin moved along `u` past the region's helices, so the copy doesn't overlap. */
function shiftedOrigin(part: Part, plane: Plane, vhs: VirtualHelix[]): Plane['origin'] {
	const { origin, u } = plane;
	const along = (p: { x: number; y: number; z: number }) =>
		(p.x - origin.x) * u.x + (p.y - origin.y) * u.y + (p.z - origin.z) * u.z;
	let min = Infinity;
	let max = -Infinity;
	for (const vh of vhs) {
		const frame = part.getVirtualHelixFrame(vh);
		const span = vh.length * BACKBONE_RISE_NM;
		const end = {
			x: frame.origin.x + frame.axis.x * span,
			y: frame.origin.y + frame.axis.y * span,
			z: frame.origin.z + frame.axis.z * span,
		};
		for (const p of [frame.origin, end]) {
			const d = along(p);
			min = Math.min(min, d);
			max = Math.max(max, d);
		}
	}
	const shift =
		vhs.length > 0 ? max - min + 2 * BACKBONE_RADIUS_NM + COPY_GAP_NM : EMPTY_REGION_SHIFT_NM;
	return { x: origin.x + u.x * shift, y: origin.y + u.y * shift, z: origin.z + u.z * shift };
}
