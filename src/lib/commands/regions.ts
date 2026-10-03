import { v4 as uuidv4 } from 'uuid';
import type { Part } from '$lib/model/Part';
import { DesignRegion } from '$lib/model/Part/DesignRegion';
import { Plane } from '$lib/model/Part/Plane.svelte';
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
	historyStack.snapshotTx(label, () => {
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

export function changeRegionLengthCmd(
	historyStack: HistoryStack,
	region: DesignRegion,
	deltaLength: number,
	label = 'Change region length'
): void {
	if (deltaLength === 0) return;
	historyStack.snapshotTx(label, () => {
		region.increaseVhsLengthBy(deltaLength);
	});
}
