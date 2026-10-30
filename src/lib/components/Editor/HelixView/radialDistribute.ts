import type VirtualHelix from '$lib/model/VirtualHelix/VirtualHelix.svelte';
import {
	SQ_INTERHELIX_NM,
	normalizeVec,
	type VirtualHelixFrame,
} from '$lib/model/geometry3d/dnaGeometry';
import { isPerpendicularFrame } from './rollDial';

export interface RadialDistributeMove {
	vh: VirtualHelix;
	from: VirtualHelixFrame;
	to: VirtualHelixFrame;
}

export interface RadialDistributeOptions {
	/** Turn each helix so its roll-0 radial points at the ring centre. */
	faceCenter?: boolean;
}

export const RADIAL_DISTRIBUTE_MIN_COUNT = 3;

/**
 * Even ring of perpendicular helices around their centroid, at their mean distance from it
 * (never closer than one inter-helix spacing between neighbours). Angular order is kept and the
 * ring is turned to move the helices as little as possible, so crossovers stretch least.
 * Null when fewer than three helices, or any lacks a frame or is in-plane.
 */
export function planRadialDistribute(
	vhs: Iterable<VirtualHelix>,
	options: RadialDistributeOptions = {}
): RadialDistributeMove[] | null {
	const items: { vh: VirtualHelix; frame: VirtualHelixFrame }[] = [];
	for (const vh of vhs) {
		const frame = vh.localFrame;
		if (!frame || !isPerpendicularFrame(frame)) return null;
		items.push({ vh, frame });
	}
	const n = items.length;
	if (n < RADIAL_DISTRIBUTE_MIN_COUNT) return null;

	const cx = items.reduce((sum, { frame }) => sum + frame.origin.x, 0) / n;
	const cy = items.reduce((sum, { frame }) => sum + frame.origin.y, 0) / n;
	const meanRadius =
		items.reduce(
			(sum, { frame }) => sum + Math.hypot(frame.origin.x - cx, frame.origin.y - cy),
			0
		) / n;
	const radius = Math.max(meanRadius, SQ_INTERHELIX_NM / (2 * Math.sin(Math.PI / n)));

	const step = (2 * Math.PI) / n;
	const sorted = items
		.map((item) => ({
			...item,
			angle: Math.atan2(item.frame.origin.y - cy, item.frame.origin.x - cx),
		}))
		.sort((a, b) => a.angle - b.angle || a.vh.index - b.vh.index);
	// Circular mean of each helix's offset from its slot: the ring rotation with least movement.
	const offset = Math.atan2(
		sorted.reduce((sum, { angle }, i) => sum + Math.sin(angle - i * step), 0),
		sorted.reduce((sum, { angle }, i) => sum + Math.cos(angle - i * step), 0)
	);

	return sorted.map(({ vh, frame }, i) => {
		const angle = offset + i * step;
		const origin = {
			x: cx + radius * Math.cos(angle),
			y: cy + radius * Math.sin(angle),
			z: frame.origin.z,
		};
		const to: VirtualHelixFrame = {
			origin,
			axis: { ...frame.axis },
			radial0: options.faceCenter
				? radialToward(frame.axis, { x: cx - origin.x, y: cy - origin.y, z: 0 })
				: { ...frame.radial0 },
		};
		return { vh, from: frame, to };
	});
}

function radialToward(axis: VirtualHelixFrame['axis'], dir: VirtualHelixFrame['origin']) {
	const a = normalizeVec(axis);
	const d = dir.x * a.x + dir.y * a.y + dir.z * a.z;
	return normalizeVec({ x: dir.x - d * a.x, y: dir.y - d * a.y, z: dir.z - d * a.z });
}
