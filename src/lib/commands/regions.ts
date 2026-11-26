import { v4 as uuidv4 } from 'uuid';
import type { Part } from '$lib/model/Part';
import {
	DesignRegion,
	WireframeRegion,
	type ReferenceGeometry,
} from '$lib/model/Part/DesignRegion';
import { Plane } from '$lib/model/Part/Plane.svelte';
import { duplicateRegion } from '$lib/model/Part/duplicateRegion';
import { splitRegionAtBp, type BpSplitResult } from '$lib/model/Part/splitRegionAtBp';
import type { HistoryStack } from './history.svelte';

export function addRegionAndPlaneCmd(
	historyStack: HistoryStack,
	part: Part,
	plane: Plane,
	region: DesignRegion,
	label = 'Add region'
): void {
	historyStack.tx(label, (rec) => {
		rec.planeAdd(part, plane.toJSON());
		rec.regionAdd(part, region.toJSON());
		part.addPlane(plane);
		part.addRegion(region);
	});
}

export function removeRegionAndPlaneCmd(
	historyStack: HistoryStack,
	part: Part,
	regionId: string,
	label = 'Remove region'
): void {
	const region = part.getRegionById(regionId);
	const plane = region ? part.getPlaneById(region.planeId) : null;
	if (!region || !plane) return;
	historyStack.tx(label, (rec) => {
		rec.regionRemove(part, region);
		rec.planeRemove(part, plane);
		part.removeRegion(regionId);
		part.removePlane(plane.id);
	});
}

export function splitRegionCmd(
	historyStack: HistoryStack,
	part: Part,
	regionId: string,
	splitAfterVhId: string,
	label = 'Split region'
): void {
	historyStack.partSnapshotTx(label, part, () => {
		const region = part.getRegionById(regionId);
		if (!region) return;
		const plane = part.getPlaneById(region.planeId);
		if (!plane) return;

		const splitIdx = region.vhOrder.indexOf(splitAfterVhId);
		if (splitIdx < 0 || splitIdx === region.vhOrder.length - 1) return;

		const topVhIds = region.vhOrder.slice(0, splitIdx + 1);
		const bottomVhIds = region.vhOrder.slice(splitIdx + 1);

		const newPlane = Plane.fromJSON({
			...plane.toJSON(),
			id: uuidv4(),
			name: part.nextPlaneName(),
		});
		part.addPlane(newPlane);

		const newRegion = DesignRegion.fromJSON({
			...region.toJSON(),
			id: uuidv4(),
			name: part.nextRegionName(region.kind),
			planeId: newPlane.id,
			vhOrder: bottomVhIds,
		});
		part.insertRegionAfter(regionId, newRegion);

		region.vhOrder = topVhIds;

		for (const vh of part.virtualHelices) {
			if (bottomVhIds.includes(vh.id)) vh.regionId = newRegion.id;
		}

		part.syncListRows();
	});
}

/** Splits a lattice region along the helix axis at bp `cut` (see `splitRegionAtBp`). Throws an
 * `InvalidOperationError`, leaving the design as it was, when the cut isn't allowed. */
export function splitRegionAtBpCmd(
	historyStack: HistoryStack,
	part: Part,
	regionId: string,
	cut: number,
	label = 'Split region'
): BpSplitResult {
	return historyStack.partSnapshotTx(label, part, () => splitRegionAtBp(part, regionId, cut));
}

/** Adds an independent copy of the region (its plane, helices and strands) right after it.
 * Returns the new region, or null if the region no longer exists. */
export function duplicateRegionCmd(
	historyStack: HistoryStack,
	part: Part,
	regionId: string,
	label = 'Duplicate region'
): DesignRegion | null {
	if (!part.getRegionById(regionId)) return null;
	return historyStack.snapshotTx(label, () => duplicateRegion(part, regionId));
}

/** Moves a region to `toIndex` in the part's region order (strand-view row order). */
export function moveRegionCmd(
	historyStack: HistoryStack,
	part: Part,
	regionId: string,
	toIndex: number,
	label = 'Move region'
): void {
	const before = part.regions.map((r) => r.id);
	const from = before.indexOf(regionId);
	if (from < 0 || from === Math.max(0, Math.min(before.length - 1, toIndex))) return;
	historyStack.tx(label, (rec) => {
		part.moveRegion(regionId, toIndex);
		rec.regionOrder(
			part,
			before,
			part.regions.map((r) => r.id)
		);
	});
}

export function setRegionReferenceGeometryCmd(
	historyStack: HistoryStack,
	part: Part,
	regionId: string,
	geometry: ReferenceGeometry | undefined,
	label = 'Set reference geometry'
): void {
	const region = part.getRegionById(regionId);
	if (!(region instanceof WireframeRegion)) {
		throw new Error(`Region ${regionId} is not a wireframe region`);
	}
	const before = region.referenceGeometry;
	historyStack.tx(label, (rec) => {
		rec.regionReferenceGeometry(part, regionId, before, geometry);
		part.setRegionReferenceGeometry(regionId, geometry);
	});
}

export function changeRegionLengthCmd(
	historyStack: HistoryStack,
	region: DesignRegion,
	deltaLength: number,
	label = 'Change region length'
): void {
	if (deltaLength === 0) return;
	const part = region.inPart;
	if (!part) throw new Error(`Region ${region.id} is not attached to a Part`);
	historyStack.partSnapshotTx(label, part, () => {
		region.increaseVhsLengthBy(deltaLength);
	});
}
