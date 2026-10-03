import type { Part } from '$lib/model/Part';
import type { Plane, PlaneVec3 } from '$lib/model/Part/Plane.svelte';
import type { HistoryStack } from './history.svelte';

export type PlaneTransform = {
	origin: PlaneVec3;
	u: PlaneVec3;
	v: PlaneVec3;
	normal: PlaneVec3;
};

export function addPlaneCmd(
	historyStack: HistoryStack,
	part: Part,
	plane: Plane,
	label = 'Add plane'
): void {
	historyStack.tx(label, (rec) => {
		rec.planeAdd(part, plane.toJSON());
		part.addPlane(plane);
	});
}

export function removePlaneCmd(
	historyStack: HistoryStack,
	part: Part,
	plane: Plane,
	label = 'Remove plane'
): void {
	historyStack.tx(label, (rec) => {
		rec.planeRemove(part, plane);
		part.removePlane(plane.id);
	});
}

export function transformPlaneCmd(
	historyStack: HistoryStack,
	part: Part,
	planeId: string,
	before: PlaneTransform,
	after: PlaneTransform,
	label = 'Transform plane'
): void {
	// Rewind the live drag preview so the transaction itself makes the change and its rollback
	// and verification see the true pre-drag pose.
	part.setPlaneTransform(planeId, before);
	historyStack.tx(label, (rec) => {
		rec.planeTransform(part, planeId, before, after);
		part.setPlaneTransform(planeId, after);
	});
}
