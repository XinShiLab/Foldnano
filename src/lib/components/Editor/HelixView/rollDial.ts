import { PERPENDICULAR_AXIS_DOT, type VirtualHelixFrame } from '$lib/model/geometry3d/dnaGeometry';

// Every roll widget shows the cross-section seen from the bp-0 end looking along the axis.
// In screen space (y down) that makes positive roll turn clockwise, which matches the
// freeform canvas for a +Z perpendicular helix.

export const ROLL_SNAP_DEG = 15;

export function isPerpendicularFrame(frame: VirtualHelixFrame | undefined): boolean {
	return !frame || Math.abs(frame.axis.z) >= PERPENDICULAR_AXIS_DOT;
}

/** Screen angle (rad) where roll 0 is drawn: +X (right) for perpendicular helices, else up. */
export function rollReferenceAngle(frame: VirtualHelixFrame | undefined): number {
	return isPerpendicularFrame(frame) ? 0 : -Math.PI / 2;
}

export function rollDialPoint(
	center: { x: number; y: number },
	radius: number,
	referenceAngle: number,
	rollDeg: number
): { x: number; y: number } {
	const a = referenceAngle + (rollDeg * Math.PI) / 180;
	return { x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) };
}

/** Roll (degrees, (-180, 180]) for a pointer at `point`; snapped unless `free`. */
export function rollFromDialPoint(
	center: { x: number; y: number },
	point: { x: number; y: number },
	referenceAngle: number,
	free = false
): number {
	let deg = ((Math.atan2(point.y - center.y, point.x - center.x) - referenceAngle) * 180) / Math.PI;
	if (!free) deg = Math.round(deg / ROLL_SNAP_DEG) * ROLL_SNAP_DEG;
	return normalizeRollDeg(deg);
}

export function normalizeRollDeg(deg: number): number {
	const wrapped = ((((deg + 180) % 360) + 360) % 360) - 180;
	return wrapped === -180 ? 180 : wrapped;
}
