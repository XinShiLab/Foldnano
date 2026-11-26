import { v4 as uuidv4 } from 'uuid';
import type { Part } from './Part.svelte';
import { DesignRegion } from './DesignRegion';
import { Plane } from './Plane.svelte';
import { evenVhIndexOffset } from './duplicateRegion';
import { detachRepeatGroup, oligoFingerprint } from './repeatGroups';
import Oligo from '../Oligo/Oligo.svelte';
import type { OligoJSON } from '../Oligo/cloneOligoJson';
import type OligoSegment from '../Oligo/OligoSegment.svelte';
import VirtualHelix from '../VirtualHelix/VirtualHelix.svelte';
import { BACKBONE_RISE_NM } from '../geometry3d/dnaGeometry';
import { InvalidOperationError } from '../../errors';

export type BpSplitCheck =
	| { ok: true; shift: number; movingSegmentIds: Set<string> }
	| { ok: false; reason: string; blockingSegmentIds: string[] };

export interface BpSplitResult {
	region: DesignRegion;
	shift: number;
	/** Names of repeat groups that had members on both sides and became plain oligos. */
	detachedGroupNames: string[];
}

/**
 * Whether region `regionId` can be split at the boundary just before bp `cut`, and by how much
 * the right part is renumbered. The cut may be any column no strand runs through. The shift is
 * the largest whole number of lattice steps not past the first moved base, so helix twist and
 * crossover sites keep their phase, and a repeat unit lands in the same columns as the first one
 * wherever in the gap the cut is made.
 */
export function analyzeBpSplit(part: Part, regionId: string, cut: number): BpSplitCheck {
	const fail = (reason: string, blockingSegmentIds: string[] = []): BpSplitCheck => ({
		ok: false,
		reason,
		blockingSegmentIds,
	});
	const region = part.getRegionById(regionId);
	if (!region) return fail('Region not found.');
	if (!region.supportsLatticeGrid) {
		return fail('Only lattice regions can be split along the helix axis.');
	}
	if (!Number.isInteger(cut) || cut <= region.minBase || cut >= region.maxBase) {
		return fail('Pick a position inside the region.');
	}

	const blocking: string[] = [];
	const moving = new Set<string>();
	let staying = 0;
	let firstMoved = Infinity;
	for (const segment of regionSegments(part, region)) {
		if (segment.highIndex < cut) staying++;
		else if (segment.lowIndex >= cut) {
			moving.add(segment.id);
			firstMoved = Math.min(firstMoved, segment.lowIndex);
		} else blocking.push(segment.id);
	}
	if (blocking.length > 0) {
		const strands = blocking.length === 1 ? 'A strand runs' : `${blocking.length} strands run`;
		return fail(`${strands} through this position. Break them here first.`, blocking);
	}
	if (moving.size === 0) return fail('Nothing to the right of this position to split off.');
	if (staying === 0) return fail('Nothing would stay left of this position.');
	const shift = Math.floor(firstMoved / region.step) * region.step;
	return { ok: true, shift, movingSegmentIds: moving };
}

/**
 * Splits a lattice region along the helix axis: every strand at or right of bp `cut` moves to a
 * new region (with its own plane, inserted after this one) on fresh copies of the region's
 * helices, renumbered by `-shift` (see `analyzeBpSplit`). The new plane sits `shift` bases further along the normal, so
 * nothing moves in 3D. Oligo and segment ids are kept, so connections across the cut become
 * cross-region connections. The original region is shortened to the cut, rounded up to a whole
 * step. Repeat groups lying wholly on one side are kept; any other group is detached (its mirrors
 * become plain oligos). Call inside a `partSnapshotTx`.
 */
export function splitRegionAtBp(part: Part, regionId: string, cut: number): BpSplitResult {
	const check = analyzeBpSplit(part, regionId, cut);
	if (!check.ok) throw new InvalidOperationError(check.reason);
	const { shift, movingSegmentIds: moving } = check;
	const region = part.getRegionById(regionId)!;
	const plane = part.getPlaneById(region.planeId);
	if (!plane) throw new Error(`Plane ${region.planeId} of region ${region.name} not found`);

	const affected = [...part.oligos].filter((o) => [...o.segments].some((s) => moving.has(s.id)));
	const detachedGroupNames = detachSplitGroups(part, moving);

	const sourceVhs = region.vhOrder
		.map((id) => part.getVhById(id))
		.filter((vh): vh is VirtualHelix => vh !== null);
	const indexOffset = evenVhIndexOffset(part);
	const vhIndexMap = new Map(sourceVhs.map((vh) => [vh.index, vh.index + indexOffset]));
	const vhIdMap = new Map(sourceVhs.map((vh) => [vh.id, uuidv4()]));

	const oligoJsons = affected.map((oligo) => oligo.toJSON());
	for (const oligo of affected) {
		// The tag goes back on with the rewritten JSON; removal alone isn't a mirror edit.
		oligo.mirrorOf = null;
		part.removeOligo(oligo);
	}

	const along = shift * BACKBONE_RISE_NM;
	const newPlane = Plane.fromJSON({
		...plane.toJSON(),
		u: { ...plane.u },
		v: { ...plane.v },
		normal: { ...plane.normal },
		id: uuidv4(),
		name: part.nextPlaneName(),
		origin: {
			x: plane.origin.x + plane.normal.x * along,
			y: plane.origin.y + plane.normal.y * along,
			z: plane.origin.z + plane.normal.z * along,
		},
	});
	part.addPlane(newPlane);

	const newRegion = DesignRegion.fromJSON({
		...region.toJSON(),
		id: uuidv4(),
		name: part.nextRegionName(region.kind),
		planeId: newPlane.id,
		vhOrder: region.vhOrder.flatMap((id) => vhIdMap.get(id) ?? []),
		minBase: Math.max(0, region.minBase - shift),
		maxBase: region.maxBase - shift,
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
				length: vh.length - shift,
				latticeCoords: json.latticeCoords ? { ...json.latticeCoords } : json.latticeCoords,
				localFrame: json.localFrame && JSON.parse(JSON.stringify(json.localFrame)),
				strandSets: json.strandSets.map((ss) => ({ ...ss, segmentIds: [] })),
			},
			part
		);
	});
	part.virtualHelices = [...part.virtualHelices, ...newVhs];

	const rebuilt = oligoJsons.map((json) =>
		Oligo.fromJSON(moveSegments(json, moving, vhIndexMap, shift), part)
	);
	part.addOligosFromArray(rebuilt);
	retagMovedMirrors(part, rebuilt);

	region.truncateVhsTo(Math.ceil(cut / region.step) * region.step);
	return { region: newRegion, shift, detachedGroupNames };
}

function regionSegments(part: Part, region: DesignRegion): OligoSegment[] {
	const segments: OligoSegment[] = [];
	for (const vhId of region.vhOrder) {
		const vh = part.getVhById(vhId);
		if (!vh) continue;
		for (const strandSet of vh.strandSets) {
			for (const id of strandSet.segmentIds) {
				const segment = part.getSegmentById(id);
				if (segment) segments.push(segment);
			}
		}
	}
	return segments;
}

/** Detaches every repeat group that doesn't lie wholly on one side of the cut: a mirror is its
 * source shifted along the same helices, which only survives if both move or both stay. */
function detachSplitGroups(part: Part, moving: Set<string>): string[] {
	const sides = new Map<string, Set<'moves' | 'stays'>>();
	for (const oligo of part.oligos) {
		const groupId = oligo.repeatGroupId ?? oligo.mirrorOf?.groupId;
		if (!groupId) continue;
		const set = sides.get(groupId) ?? new Set();
		for (const segment of oligo.segments) set.add(moving.has(segment.id) ? 'moves' : 'stays');
		sides.set(groupId, set);
	}
	const detached: string[] = [];
	for (const group of [...part.repeatGroups]) {
		if (sides.get(group.id)?.size !== 2) continue;
		detachRepeatGroup(part, group.id);
		detached.push(group.name);
	}
	return detached;
}

function moveSegments(
	json: OligoJSON,
	moving: Set<string>,
	vhIndexMap: Map<number, number>,
	shift: number
): OligoJSON {
	return {
		...json,
		segments: json.segments.map((seg) => {
			if (!moving.has(seg.id)) return seg;
			return {
				...seg,
				inVirtualHelixIndex: vhIndexMap.get(seg.inVirtualHelixIndex)!,
				fivePrime: { ...seg.fivePrime, index: seg.fivePrime.index - shift },
				threePrime: { ...seg.threePrime, index: seg.threePrime.index - shift },
				slots: seg.slots.map((s) => ({ bpIndex: s.bpIndex - shift, seq: s.seq })),
			};
		}),
	};
}

/** A mirror tag's structure includes VH indices, so moved mirrors are re-tagged from their
 * (moved) source; the sync then sees them as up to date and keeps them. */
function retagMovedMirrors(part: Part, rebuilt: Oligo[]): void {
	for (const mirror of rebuilt) {
		const tag = mirror.mirrorOf;
		if (!tag) continue;
		const source = part.getOligoById(tag.sourceOligoId);
		if (!source) continue;
		mirror.mirrorOf = { ...tag, structure: oligoFingerprint(source, 0, false) };
	}
}
