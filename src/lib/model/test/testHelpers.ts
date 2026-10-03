import { Part } from '$lib/model/Part';
import { FreeformRegion, LatticedDesignRegion } from '$lib/model/Part/DesignRegion';
import type VirtualHelix from '$lib/model/VirtualHelix';

export const makeHoneycombPart = (name = 'test') => Part.forType('HONEYCOMB', name);
export const makeSquarePart = (name = 'test') => Part.forType('SQUARE', name);
export const makeFreeformPart = (name = 'test') => Part.forType('FREEFORM', name);

export function addLatticeVh(part: Part, col: number, row: number): VirtualHelix {
	const region = part.getDefaultRegion();
	if (!(region instanceof LatticedDesignRegion)) {
		throw new Error('addLatticeVh requires a latticed default region');
	}
	return region.addVhAtCoords(part, col, row);
}

export function addFreeformVh(
	part: Part,
	start: [number, number, number],
	direction: [number, number, number] = [0, 0, 1]
): VirtualHelix {
	const region = part.getDefaultRegion();
	if (!(region instanceof FreeformRegion)) {
		throw new Error('addFreeformVh requires a FreeformRegion default region');
	}
	return region.addVhAt(part, start, direction);
}
