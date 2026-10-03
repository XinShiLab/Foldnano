import type { Part } from '$lib/model/Part';

function vecSig(vec: { x: number; y: number; z: number }): string {
	return `${vec.x},${vec.y},${vec.z}`;
}

export function computeSimulationFreshnessSignature(part: Part): string {
	const segIds = [...part.segmentsLookup.keys()].sort().join(',');
	let xoverCount = 0;
	for (const [, seg] of part.segmentsLookup) {
		if (seg.threePrime.connectedSegment) xoverCount++;
	}
	const planeSig = part.planes
		.map(
			(plane) =>
				`${plane.id}:${vecSig(plane.origin)}:${vecSig(plane.u)}:${vecSig(plane.v)}:${vecSig(plane.normal)}`
		)
		.join('|');
	return `${part.virtualHelices.length}|${xoverCount}|${segIds}|${planeSig}`;
}
