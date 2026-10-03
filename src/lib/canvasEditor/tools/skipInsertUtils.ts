import type { Part } from '$lib/model/Part';
import type { DesignRegion } from '$lib/model/Part/DesignRegion';
import type OligoSegment from '$lib/model/Oligo/OligoSegment.svelte';

/** True if bpIdx has a constrained connected end on EITHER strand of this VH. */
function hasConstrainedXoverAtPosition(part: Part, vhId: string, bpIdx: number): boolean {
	for (const strandIdx of [0, 1] as const) {
		const { end } = part.getEntitiesAtVh(vhId, strandIdx, bpIdx);
		if (end && !end.isFree && end.isConstrained) return true;
	}
	return false;
}

/**
 * Resolve the effective bp index to use. Constrained crossovers are fixed simulation anchors,
 * so insert/skip edits are rejected there instead of being relocated.
 */
export function resolveTargetBpIdx(
	part: Part,
	segment: OligoSegment,
	bpIdx: number
): number | null {
	const vhId = segment.inVirtualHelix.id;
	if (hasConstrainedXoverAtPosition(part, vhId, bpIdx)) return null;
	return bpIdx;
}

/**
 * Collect all segments at `bpIdx` on `strandIdx` across all VHs in the region.
 * Preserves the same strand type as the user clicked.
 */
export function collectRegionSegmentsAtBp(
	part: Part,
	region: DesignRegion,
	strandIdx: 0 | 1,
	bpIdx: number
): OligoSegment[] {
	const results: OligoSegment[] = [];
	for (const vh of part.virtualHelices.filter((vh) => vh.regionId === region.id)) {
		const hit = part.getOligoByVh(vh.id, strandIdx, bpIdx);
		if (hit) results.push(hit.segment);
	}
	return results;
}
