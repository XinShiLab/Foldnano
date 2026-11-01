import { BACKBONE_RISE_NM, type VirtualHelixFrame } from '$lib/model/geometry3d/dnaGeometry';

const FARTHEST_OPACITY = 0.2;
const FLAT_RANGE_NM = 1e-6;

/** W at the middle of the dsDNA, or at the origin of an empty helix: the rest is only available space. */
export function helixDepthW(
	frame: VirtualHelixFrame,
	segments: readonly { lowIndex: number; highIndex: number }[]
): number {
	if (segments.length === 0) return frame.origin.z;
	const lowBp = Math.min(...segments.map((segment) => segment.lowIndex));
	const highBp = Math.max(...segments.map((segment) => segment.highIndex));
	return frame.origin.z + frame.axis.z * ((lowBp + highBp) / 2) * BACKBONE_RISE_NM;
}

// +W points into the screen, so the most negative W is nearest the viewer and fully solid.
export function depthFadeOpacity(w: number, minW: number, maxW: number): number {
	const range = maxW - minW;
	if (range < FLAT_RANGE_NM) return 1;
	return 1 - ((w - minW) / range) * (1 - FARTHEST_OPACITY);
}
