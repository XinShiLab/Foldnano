/**
 * opDispatch — single source of truth for the foldnano_mini op vocabulary.
 *
 * The Python `foldnano_mini` package emits a JSON-serialisable list of ops
 * (`MutationOp[]`) when a plugin runs. The host-side replayer in
 * `ResultApplicator` calls `dispatchOp(op, part)` for each op inside a single
 * `historyStack.snapshotTx`, producing one undo step for the whole run.
 *
 * The same dispatch table is the foundation for Live mode (Phase 6): the only
 * difference is that each `apply()` call on the Python side will route to a
 * sync RPC handler that calls `dispatchOp(...)` per op instead of batching
 * them into a log.
 *
 * # Stable ids
 *
 * Every entity (VH / oligo / segment) is identified by a single stable string
 * id that is shared between Python and JS. Creation ops carry the id the
 * plugin chose (e.g. `newVhId`, `newOligoId`, `newSegmentId`); the JS
 * factories adopt those ids verbatim. Subsequent ops reference entities by id
 * directly — no Python-id ↔ JS-id mapping table is needed.
 */

import type { Part } from '$lib/model/Part';
import type Oligo from '$lib/model/Oligo/Oligo.svelte';
import type OligoSegment from '$lib/model/Oligo/OligoSegment.svelte';
import type VirtualHelix from '$lib/model/VirtualHelix/VirtualHelix.svelte';
import {
	DesignRegion,
	LatticedDesignRegion,
	type DesignRegionJSON,
	type RegionKind,
} from '$lib/model/Part/DesignRegion';
import { Plane, type PlaneVec3 } from '$lib/model/Part/Plane.svelte';
import { MIRROR_EDIT_ERROR } from '$lib/model/Part/Part.svelte';
import {
	addRepeatInstance,
	createRepeatGroup,
	deleteRepeatGroup,
	detachRepeatGroup,
	removeRepeatInstance,
	syncRepeatGroups,
} from '$lib/model/Part/repeatGroups';
import { InvalidOperationError } from '$lib/errors';
import {
	isRightHandedBasis,
	normalizeFrame,
	type Vec3,
	type VirtualHelixFrame,
} from '$lib/model/geometry3d/dnaGeometry';

// ---------------------------------------------------------------------------
// Op shapes (mirror the Python foldnano_mini.mutations module)
// ---------------------------------------------------------------------------

export type MutationOp =
	| SetOligoColorOp
	| SetOligoNameOp
	| SetOligoIsScaffoldOp
	| SetSegmentModificationOp
	| SetSlotSequenceOp
	| SetSlotSkipOp
	| SetSlotInsertionOp
	| AddSkipOrInsertionOp
	| CreateSegmentOp
	| ConnectOp
	| RemoveSegmentOp
	| RemoveOligoOp
	| AddVhAtCoordsOp
	| SetVhLocalFrameOp
	| RemoveVhsOp
	| BreakOligoOp
	| MoveTerminusOp
	| SetVhLengthOp
	| SetRegionMaxBaseOp
	| MoveLatticeVhOp
	| AddFreeformVhOp
	| ReorderVhOp
	| TransformPlaneOp
	| AddRegionAndPlaneOp
	| SplitRegionOp
	| CreateRepeatGroupOp
	| AddRepeatInstanceOp
	| RemoveRepeatInstanceOp
	| DetachRepeatGroupOp
	| DeleteRepeatGroupOp;

interface SetOligoColorOp {
	op: 'set_oligo_color';
	oligoId: string;
	color: string;
}

interface SetOligoNameOp {
	op: 'set_oligo_name';
	oligoId: string;
	name: string | null;
}

interface SetOligoIsScaffoldOp {
	op: 'set_oligo_is_scaffold';
	oligoId: string;
	isScaffold: boolean;
}

interface SetSegmentModificationOp {
	op: 'set_segment_modification';
	oligoId: string;
	segmentId: string;
	end: '5' | '3';
	modification: string | null;
}

interface SetSlotSequenceOp {
	op: 'set_slot_sequence';
	oligoId: string;
	segmentId: string;
	bpIndex: number;
	seq: string;
}

interface SetSlotSkipOp {
	op: 'set_slot_skip';
	oligoId: string;
	segmentId: string;
	bpIndex: number;
	skip: boolean;
}

interface SetSlotInsertionOp {
	op: 'set_slot_insertion';
	oligoId: string;
	segmentId: string;
	bpIndex: number;
	insertion: string;
}

/** The skip and insert tools: `count` -1 adds a skip, n > 0 adds n inserted bases, on both strands. */
interface AddSkipOrInsertionOp {
	op: 'add_skip_or_insertion';
	segmentId: string;
	bpIndex: number;
	count: number;
}

interface CreateSegmentOp {
	op: 'create_segment';
	vhId: string;
	fiveIndex: number;
	threeIndex: number;
	color: string;
	isScaffold: boolean;
	name: string | null;
	newOligoId: string;
	newSegmentId: string;
}

interface ConnectOp {
	op: 'connect';
	fromSegmentId: string;
	toSegmentId: string;
}

interface RemoveSegmentOp {
	op: 'remove_segment';
	oligoId: string;
	segmentId: string;
	/** Id for the oligo split off downstream of the removed segment, if any. */
	newOligoId?: string;
}

interface RemoveOligoOp {
	op: 'remove_oligo';
	oligoId: string;
}

interface AddVhAtCoordsOp {
	op: 'add_vh_at_coords';
	regionId: string;
	row: number;
	col: number;
	newVhId: string;
	length?: number;
}

interface SetVhLocalFrameOp {
	op: 'set_vh_local_frame';
	vhId: string;
	localFrame: Record<string, unknown> | null;
}

interface RemoveVhsOp {
	op: 'remove_vhs';
	vhIds: string[];
}

interface BreakOligoOp {
	op: 'break_oligo';
	oligoId: string;
	segmentId: string;
	atIndex: number;
	newOligoId: string;
	/** Id for the sub-segment a mid-segment break creates. */
	newSegmentId?: string;
}

interface MoveTerminusOp {
	op: 'move_terminus';
	segmentId: string;
	end: '5' | '3';
	toIndex: number;
}

interface SetVhLengthOp {
	op: 'set_vh_length';
	vhId: string;
	length: number;
}

interface SetRegionMaxBaseOp {
	op: 'set_region_max_base';
	regionId: string;
	newMaxBase: number;
}

interface MoveLatticeVhOp {
	op: 'move_lattice_vh';
	vhId: string;
	col: number;
	row: number;
}

interface AddFreeformVhOp {
	op: 'add_freeform_vh';
	regionId: string;
	newVhId: string;
	origin: [number, number, number];
	axis: [number, number, number];
	radial0: [number, number, number];
	length?: number;
}

interface ReorderVhOp {
	op: 'reorder_vh';
	vhId: string;
	targetRegionRow: number;
}

interface TransformPlaneOp {
	op: 'transform_plane';
	planeId: string;
	origin: PlaneVec3;
	u: PlaneVec3;
	v: PlaneVec3;
	normal: PlaneVec3;
}

interface AddRegionAndPlaneOp {
	op: 'add_region_and_plane';
	planeId: string;
	planeName: string;
	planeOrigin: PlaneVec3;
	planeU: PlaneVec3;
	planeV: PlaneVec3;
	planeNormal: PlaneVec3;
	regionId: string;
	regionName: string;
	regionKind: RegionKind;
	regionStep: number;
	regionTurnsPerStep: number;
	regionSubStepSize: number;
	regionTwistOffset: number;
	regionMinBase: number;
	regionMaxBase: number;
}

interface SplitRegionOp {
	op: 'split_region';
	regionId: string;
	splitAfterVhId: string;
	newPlaneId: string;
	newRegionId: string;
}

interface CreateRepeatGroupOp {
	op: 'create_repeat_group';
	groupId: string;
	instanceId: string;
	name: string;
	oligoIds: string[];
	bpOffset: number;
}

interface AddRepeatInstanceOp {
	op: 'add_repeat_instance';
	groupId: string;
	instanceId: string;
	bpOffset: number;
}

interface RemoveRepeatInstanceOp {
	op: 'remove_repeat_instance';
	groupId: string;
	instanceId: string;
}

interface DetachRepeatGroupOp {
	op: 'detach_repeat_group';
	groupId: string;
}

interface DeleteRepeatGroupOp {
	op: 'delete_repeat_group';
	groupId: string;
}

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/** Returns a human-readable region label ("Name") falling back to the raw id. */
function regionLabel(part: Part, id: string | null | undefined): string {
	if (!id) return '(none)';
	const region = part.getRegionById(id);
	return region ? `"${region.name}"` : id;
}

function findOligo(part: Part, oligoId: string): Oligo {
	for (const oligo of part.oligos) {
		if (oligo.id === oligoId) return oligo;
	}
	throw new Error(`Oligo ${oligoId} not found`);
}

function findSegment(part: Part, segmentId: string): OligoSegment {
	const seg = part.getSegmentById(segmentId);
	if (!seg) throw new Error(`Segment ${segmentId} not found`);
	return seg;
}

function findVh(part: Part, vhId: string): VirtualHelix {
	const vh = part.virtualHelices.find((v) => v.id === vhId);
	if (!vh) throw new Error(`VirtualHelix ${vhId} not found`);
	return vh;
}

function assertRightHandedPlane(opName: string, u: Vec3, v: Vec3, normal: Vec3): void {
	if (!isRightHandedBasis(u, v, normal)) {
		throw new Error(
			`${opName}: the plane basis is mirrored (u × v must point along normal); its helices would twist the wrong way in 3D and export`
		);
	}
}

function assertVhIdAvailable(part: Part, vhId: string): void {
	if (part.getVhById(vhId)) {
		throw new Error(`VirtualHelix id ${vhId} already exists`);
	}
}

function assertOligoIdAvailable(part: Part, oligoId: string): void {
	if (part.getOligoById(oligoId)) {
		throw new Error(`Oligo id ${oligoId} already exists`);
	}
}

function assertSegmentIdAvailable(part: Part, segmentId: string): void {
	if (part.getSegmentById(segmentId)) {
		throw new Error(`Segment id ${segmentId} already exists`);
	}
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export interface DispatchOptions {
	/** When set, every op's target VH must belong to this region. */
	activeRegionId?: string | null;
}

/**
 * Apply one mutation op to `part`.
 *
 * Throws on invalid input or on regional-scope violations (when `activeRegionId`
 * is set and the op targets a VH outside that region). The caller is expected
 * to wrap the dispatch loop in `historyStack.snapshotTx` so a thrown error
 * unwinds all changes from the run as a single undo step.
 */
export function dispatchOp(op: MutationOp, part: Part, options: DispatchOptions = {}): void {
	const { activeRegionId } = options;
	assertNotMirrorTarget(op, part);

	switch (op.op) {
		case 'set_oligo_color': {
			const oligo = findOligo(part, op.oligoId);
			guardOligoInRegion(part, oligo, activeRegionId);
			oligo.color = op.color;
			return;
		}
		case 'set_oligo_name': {
			const oligo = findOligo(part, op.oligoId);
			guardOligoInRegion(part, oligo, activeRegionId);
			// null resets to the default empty string (Oligo.name is string, not string|null)
			oligo.name = op.name ?? '';
			return;
		}
		case 'set_oligo_is_scaffold': {
			const oligo = findOligo(part, op.oligoId);
			guardOligoInRegion(part, oligo, activeRegionId);
			oligo.isScaffold = op.isScaffold;
			return;
		}
		case 'set_segment_modification': {
			const seg = findSegment(part, op.segmentId);
			guardVhInRegion(part, seg.inVirtualHelix.regionId, activeRegionId);
			if (op.end === '5') {
				seg.fivePrime.modification = op.modification;
			} else {
				seg.threePrime.modification = op.modification;
			}
			return;
		}
		case 'set_slot_sequence': {
			const seg = findSegment(part, op.segmentId);
			guardVhInRegion(part, seg.inVirtualHelix.regionId, activeRegionId);
			const slot = seg.slotForBp(op.bpIndex);
			if (!slot) throw new Error(`No slot at bp ${op.bpIndex} on segment ${seg.id}`);
			slot.seq = op.seq;
			return;
		}
		case 'set_slot_skip': {
			const seg = findSegment(part, op.segmentId);
			guardVhInRegion(part, seg.inVirtualHelix.regionId, activeRegionId);
			if (op.skip) {
				seg.addSkipOrInsertion(op.bpIndex, -1);
			} else {
				seg.removeSkipOrInsertion(op.bpIndex);
			}
			return;
		}
		case 'set_slot_insertion': {
			const seg = findSegment(part, op.segmentId);
			guardVhInRegion(part, seg.inVirtualHelix.regionId, activeRegionId);
			const slot = seg.slotForBp(op.bpIndex);
			if (!slot) throw new Error(`No slot at bp ${op.bpIndex} on segment ${seg.id}`);
			for (const strandIdx of [0, 1] as const) {
				const { end } = part.getEntitiesAtVh(seg.inVirtualHelix.id, strandIdx, op.bpIndex);
				if (end && !end.isFree && end.isConstrained) {
					throw new Error(`Cannot set insertion at constrained crossover site bp ${op.bpIndex}`);
				}
			}
			const complementaryStrandIdx = (1 - seg.inStrandIndex) as 0 | 1;
			const { segment: compSeg } = part.getEntitiesAtVh(
				seg.inVirtualHelix.id,
				complementaryStrandIdx,
				op.bpIndex
			);
			const compSlot = compSeg?.slotForBp(op.bpIndex);
			if (!compSlot) {
				throw new Error(`Cannot set insertion at bp ${op.bpIndex}: complementary slot is missing`);
			}
			// op.insertion holds the full slot sequence (e.g. 'AT' for a 1-base insertion).
			slot.seq = op.insertion;
			compSlot.seq = op.insertion.length === 1 ? 'N' : 'N'.repeat(op.insertion.length);
			return;
		}
		case 'add_skip_or_insertion': {
			const seg = findSegment(part, op.segmentId);
			guardVhInRegion(part, seg.inVirtualHelix.regionId, activeRegionId);
			if (!Number.isInteger(op.count) || op.count === 0 || op.count < -1) {
				throw new Error(`add_skip_or_insertion: count must be -1 or a positive integer`);
			}
			seg.addSkipOrInsertion(op.bpIndex, op.count);
			return;
		}
		case 'create_segment': {
			const vh = findVh(part, op.vhId);
			guardVhInRegion(part, vh.regionId, activeRegionId);
			assertOligoIdAvailable(part, op.newOligoId);
			assertSegmentIdAvailable(part, op.newSegmentId);
			const newOligo = part.createOligo(vh, op.fiveIndex, op.threeIndex, op.color, {
				oligoId: op.newOligoId,
				segmentId: op.newSegmentId,
			});
			if (op.name != null) newOligo.name = op.name;
			if (op.isScaffold) newOligo.isScaffold = op.isScaffold;
			return;
		}
		case 'connect': {
			const fromSeg = findSegment(part, op.fromSegmentId);
			const toSeg = findSegment(part, op.toSegmentId);
			guardVhInRegion(part, fromSeg.inVirtualHelix.regionId, activeRegionId);
			guardVhInRegion(part, toSeg.inVirtualHelix.regionId, activeRegionId);
			// Segment-level connect: throws if either end is occupied, preserving
			// the plugin author's intent (vs. connectTwoOligos which silently
			// collapses to oligo-global ends).
			part.connectSegmentEnds(fromSeg, toSeg);
			return;
		}
		case 'remove_segment': {
			const seg = findSegment(part, op.segmentId);
			guardVhInRegion(part, seg.inVirtualHelix.regionId, activeRegionId);
			const oligo = seg.oligo;
			if (!oligo) throw new Error(`remove_segment: segment ${seg.id} has no owning oligo`);
			part.removeSegmentFromOligo(oligo, seg, { newOligoId: op.newOligoId });
			return;
		}
		case 'remove_oligo': {
			const oligo = findOligo(part, op.oligoId);
			guardOligoInRegion(part, oligo, activeRegionId);
			part.removeOligo(oligo);
			return;
		}
		case 'add_vh_at_coords': {
			if (activeRegionId && op.regionId !== activeRegionId) {
				throw new Error(
					`add_vh_at_coords targets region ${regionLabel(part, op.regionId)} but active region is ${regionLabel(part, activeRegionId)}`
				);
			}
			const region = part.getRegionById(op.regionId);
			if (!region) throw new Error(`Region ${op.regionId} not found`);
			if (!(region instanceof LatticedDesignRegion)) {
				throw new Error(
					`Region ${op.regionId} is not a LatticedDesignRegion — cannot add_vh_at_coords`
				);
			}
			assertVhIdAvailable(part, op.newVhId);
			const vh = region.addVhAtCoords(part, op.col, op.row, op.newVhId);
			if (op.length != null) vh.length = op.length;
			return;
		}
		case 'set_vh_local_frame': {
			const vh = findVh(part, op.vhId);
			guardVhInRegion(part, vh.regionId, activeRegionId);
			vh.localFrame = op.localFrame
				? normalizeFrame(op.localFrame as unknown as VirtualHelixFrame)
				: undefined;
			return;
		}
		case 'remove_vhs': {
			const indices: number[] = [];
			for (const vhId of op.vhIds) {
				const vh = findVh(part, vhId);
				if (activeRegionId && vh.regionId !== activeRegionId) {
					throw new Error(
						`remove_vhs targets VH in region ${regionLabel(part, vh.regionId)} outside active region ${regionLabel(part, activeRegionId)}`
					);
				}
				indices.push(vh.index);
			}
			part.removeVirtualHelicesByIndex(indices);
			return;
		}
		case 'break_oligo': {
			const oligo = findOligo(part, op.oligoId);
			guardOligoInRegion(part, oligo, activeRegionId);
			const seg = findSegment(part, op.segmentId);
			if (op.newSegmentId) assertSegmentIdAvailable(part, op.newSegmentId);
			part.breakOligoAt(oligo, seg, op.atIndex, {
				newOligoId: op.newOligoId,
				newSegmentId: op.newSegmentId,
			});
			return;
		}
		case 'move_terminus': {
			const seg = findSegment(part, op.segmentId);
			guardVhInRegion(part, seg.inVirtualHelix.regionId, activeRegionId);
			const end = op.end === '5' ? seg.fivePrime : seg.threePrime;
			part.moveOligoTerminusTo(end, op.toIndex);
			return;
		}
		case 'set_vh_length': {
			const vh = findVh(part, op.vhId);
			guardVhInRegion(part, vh.regionId, activeRegionId);
			vh.length = op.length;
			return;
		}
		case 'set_region_max_base': {
			if (activeRegionId && op.regionId !== activeRegionId) {
				throw new Error(
					`set_region_max_base targets region ${regionLabel(part, op.regionId)} but active region is ${regionLabel(part, activeRegionId)}`
				);
			}
			const region = part.getRegionById(op.regionId);
			if (!region) throw new Error(`Region ${op.regionId} not found`);
			const delta = op.newMaxBase - region.maxBase;
			if (delta !== 0) region.increaseVhsLengthBy(delta);
			return;
		}
		case 'move_lattice_vh': {
			const vh = findVh(part, op.vhId);
			guardVhInRegion(part, vh.regionId, activeRegionId);
			if (!vh.latticeCoords) {
				throw new Error(`move_lattice_vh: VH ${op.vhId} has no latticeCoords (freeform VH)`);
			}
			const region = part.getRegionById(vh.regionId!);
			if (!(region instanceof LatticedDesignRegion)) {
				throw new Error(`move_lattice_vh: region ${vh.regionId} is not a LatticedDesignRegion`);
			}
			const { row: fromRow, col: fromCol } = vh.latticeCoords;
			if ((op.row - fromRow + op.col - fromCol) % 2 !== 0) {
				throw new Error(
					`move_lattice_vh: target (col=${op.col}, row=${op.row}) breaks lattice parity`
				);
			}
			const occupant = region.getVhByLatticeCoords(op.col, op.row);
			if (occupant && occupant.id !== op.vhId) {
				throw new Error(`move_lattice_vh: cell (col=${op.col}, row=${op.row}) is already occupied`);
			}
			vh.latticeCoords = { col: op.col, row: op.row };
			region.invalidateDerivedCaches();
			return;
		}
		case 'add_freeform_vh': {
			if (activeRegionId && op.regionId !== activeRegionId) {
				throw new Error(
					`add_freeform_vh targets region ${regionLabel(part, op.regionId)} but active region is ${regionLabel(part, activeRegionId)}`
				);
			}
			const region = part.getRegionById(op.regionId);
			if (!region) throw new Error(`Region ${op.regionId} not found`);
			if (region instanceof LatticedDesignRegion) {
				throw new Error(
					`add_freeform_vh: region ${op.regionId} is a lattice region — use add_vh_at_coords instead`
				);
			}
			assertVhIdAvailable(part, op.newVhId);
			const localFrame = normalizeFrame({
				origin: { x: op.origin[0], y: op.origin[1], z: op.origin[2] },
				axis: { x: op.axis[0], y: op.axis[1], z: op.axis[2] },
				radial0: { x: op.radial0[0], y: op.radial0[1], z: op.radial0[2] },
			});
			const vh = part.addVirtualHelix({ id: op.newVhId });
			vh.length = op.length ?? region.maxBase;
			vh.regionId = op.regionId;
			vh.localFrame = localFrame;
			if (!region.vhOrder.includes(op.newVhId)) region.vhOrder.push(op.newVhId);
			part.syncListRows();
			return;
		}
		case 'reorder_vh': {
			const vh = findVh(part, op.vhId);
			guardVhInRegion(part, vh.regionId, activeRegionId);
			part.reorderVirtualHelixInRegion(vh.index, op.targetRegionRow);
			return;
		}
		case 'transform_plane': {
			if (!part.getPlaneById(op.planeId)) throw new Error(`Plane ${op.planeId} not found`);
			assertRightHandedPlane('transform_plane', op.u, op.v, op.normal);
			part.setPlaneTransform(op.planeId, {
				origin: op.origin,
				u: op.u,
				v: op.v,
				normal: op.normal,
			});
			return;
		}
		case 'add_region_and_plane': {
			assertRightHandedPlane('add_region_and_plane', op.planeU, op.planeV, op.planeNormal);
			const plane = Plane.fromJSON({
				id: op.planeId,
				name: op.planeName,
				origin: op.planeOrigin,
				u: op.planeU,
				v: op.planeV,
				normal: op.planeNormal,
			});
			part.addPlane(plane);
			const regionJson: DesignRegionJSON = {
				id: op.regionId,
				name: op.regionName,
				kind: op.regionKind,
				planeId: op.planeId,
				vhOrder: [],
				step: op.regionStep,
				turnsPerStep: op.regionTurnsPerStep,
				subStepSize: op.regionSubStepSize,
				twistOffset: op.regionTwistOffset,
				minBase: op.regionMinBase,
				maxBase: op.regionMaxBase,
			};
			const region = DesignRegion.fromJSON(regionJson);
			part.addRegion(region);
			return;
		}
		case 'split_region': {
			const region = part.getRegionById(op.regionId);
			if (!region) throw new Error(`Region ${op.regionId} not found`);
			const splitIdx = region.vhOrder.indexOf(op.splitAfterVhId);
			if (splitIdx < 0) {
				throw new Error(`split_region: VH ${op.splitAfterVhId} not found in region ${op.regionId}`);
			}
			const topVhIds = region.vhOrder.slice(0, splitIdx + 1);
			const bottomVhIds = region.vhOrder.slice(splitIdx + 1);
			const existingPlane = part.getPlaneById(region.planeId);
			if (!existingPlane) throw new Error(`Plane ${region.planeId} not found`);
			const newPlane = Plane.fromJSON({ ...existingPlane.toJSON(), id: op.newPlaneId });
			part.addPlane(newPlane);
			const newRegion = DesignRegion.fromJSON({
				...region.toJSON(),
				id: op.newRegionId,
				planeId: op.newPlaneId,
				vhOrder: bottomVhIds,
			});
			part.insertRegionAfter(op.regionId, newRegion);
			region.vhOrder = topVhIds;
			for (const vhId of bottomVhIds) {
				const vh = part.getVhById(vhId);
				if (vh) vh.regionId = op.newRegionId;
			}
			part.syncListRows();
			return;
		}
		case 'create_repeat_group': {
			const oligos = op.oligoIds.map((id) => findOligo(part, id));
			for (const oligo of oligos) guardOligoInRegion(part, oligo, activeRegionId);
			createRepeatGroup(part, oligos, op.bpOffset, {
				groupId: op.groupId,
				instanceId: op.instanceId,
				name: op.name,
			});
			return;
		}
		case 'add_repeat_instance': {
			guardRepeatGroupInRegion(part, op.groupId, activeRegionId);
			addRepeatInstance(part, op.groupId, op.bpOffset, op.instanceId);
			return;
		}
		case 'remove_repeat_instance': {
			guardRepeatGroupInRegion(part, op.groupId, activeRegionId);
			removeRepeatInstance(part, op.groupId, op.instanceId);
			return;
		}
		case 'detach_repeat_group': {
			guardRepeatGroupInRegion(part, op.groupId, activeRegionId);
			detachRepeatGroup(part, op.groupId);
			return;
		}
		case 'delete_repeat_group': {
			guardRepeatGroupInRegion(part, op.groupId, activeRegionId);
			deleteRepeatGroup(part, op.groupId);
			return;
		}
		default: {
			const _exhaustive: never = op;
			throw new Error(`Unknown op kind: ${(_exhaustive as { op: string }).op}`);
		}
	}
}

// ---------------------------------------------------------------------------
// Log replay
// ---------------------------------------------------------------------------

const REPEAT_GROUP_OPS: ReadonlySet<MutationOp['op']> = new Set([
	'create_repeat_group',
	'add_repeat_instance',
	'remove_repeat_instance',
	'detach_repeat_group',
	'delete_repeat_group',
]);

/** Ops that change an oligo's attributes or bases, never positions; mirrors can't fail to follow. */
const ATTRIBUTE_OPS: ReadonlySet<MutationOp['op']> = new Set([
	'set_oligo_color',
	'set_oligo_name',
	'set_oligo_is_scaffold',
	'set_segment_modification',
	'set_slot_sequence',
]);

/** A log op that failed on replay: its position in the log, and why. */
export class MutationReplayError extends Error {
	constructor(
		readonly opIndex: number,
		readonly op: MutationOp,
		readonly reason: string
	) {
		super(`op ${opIndex} (${op.op}): ${reason}`);
		this.name = 'MutationReplayError';
	}
}

/**
 * Replay a `foldnano_mini` mutation log onto `part`, op by op.
 *
 * Mirrors are re-synced after every op that can move them, because the Python side rebuilds
 * them after each op too: a later op may use space a mirror just left. Attribute writes wait
 * for the enclosing transaction's sync. The caller wraps this in `historyStack.snapshotTx`.
 * Throws `MutationReplayError` naming the op that failed, including a mirror that couldn't
 * be rebuilt after it.
 */
export function replayMutationLog(
	part: Part,
	log: readonly MutationOp[],
	options: DispatchOptions = {}
): void {
	log.forEach((op, i) => {
		try {
			dispatchOp(op, part, options);
			if (
				REPEAT_GROUP_OPS.has(op.op) ||
				(part.repeatGroups.length > 0 && !ATTRIBUTE_OPS.has(op.op))
			) {
				syncRepeatGroups(part);
			}
		} catch (err) {
			throw new MutationReplayError(i, op, err instanceof Error ? err.message : String(err));
		}
	});
}

// ---------------------------------------------------------------------------
// Mirror and region-scope guards
// ---------------------------------------------------------------------------

/** Mirrors are regenerated from their originals, never edited (docs/repeat-units.md). */
function assertNotMirrorTarget(op: MutationOp, part: Part): void {
	const targets: (Oligo | null | undefined)[] = [];
	if ('oligoId' in op) targets.push(part.getOligoById(op.oligoId));
	if ('segmentId' in op) targets.push(part.getSegmentById(op.segmentId)?.oligo);
	if (op.op === 'connect') {
		targets.push(part.getSegmentById(op.fromSegmentId)?.oligo);
		targets.push(part.getSegmentById(op.toSegmentId)?.oligo);
	}
	if (targets.some((oligo) => oligo?.isMirror)) {
		throw new InvalidOperationError(MIRROR_EDIT_ERROR);
	}
}

function guardRepeatGroupInRegion(
	part: Part,
	groupId: string,
	activeRegionId: string | null | undefined
): void {
	if (!activeRegionId) return;
	for (const oligo of part.oligos) {
		if (oligo.repeatGroupId === groupId) guardOligoInRegion(part, oligo, activeRegionId);
	}
}

function guardVhInRegion(
	part: Part,
	vhRegionId: string | null | undefined,
	activeRegionId: string | null | undefined
): void {
	if (!activeRegionId) return;
	if (vhRegionId !== activeRegionId) {
		throw new Error(
			`Op targets VH in region ${regionLabel(part, vhRegionId)} but active region is ${regionLabel(part, activeRegionId)}`
		);
	}
}

function guardOligoInRegion(
	part: Part,
	oligo: Oligo,
	activeRegionId: string | null | undefined
): void {
	if (!activeRegionId) return;
	for (const seg of oligo.segments) {
		const rid = seg.inVirtualHelix.regionId;
		if (rid !== activeRegionId) {
			throw new Error(
				`Op targets oligo "${oligo.name || oligo.id.slice(0, 8)}" which has a segment in region ${regionLabel(part, rid)} (active region: ${regionLabel(part, activeRegionId)})`
			);
		}
	}
}
