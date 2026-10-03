import type Oligo from './Oligo.svelte';
import type OligoSegment from './OligoSegment.svelte';

interface Endpoint {
	vhIdx: number;
	bpIdx: number;
}

export function endpointKey(endpoint: Endpoint): string {
	return `${endpoint.vhIdx}[${endpoint.bpIdx}]`;
}

function compareEndpoints(a: Endpoint, b: Endpoint): number {
	return a.vhIdx - b.vhIdx || a.bpIdx - b.bpIdx;
}

function compareSegmentsByEndpoints(a: OligoSegment, b: OligoSegment): number {
	return (
		compareEndpoints(a.fivePrime.ntIndices, b.fivePrime.ntIndices) ||
		compareEndpoints(a.threePrime.ntIndices, b.threePrime.ntIndices) ||
		a.id.localeCompare(b.id)
	);
}

function segmentSignature(segment: OligoSegment): string {
	return `${endpointKey(segment.fivePrime.ntIndices)}>${endpointKey(segment.threePrime.ntIndices)}`;
}

function sortedSegments(oligo: Oligo): OligoSegment[] {
	return [...oligo.segments].sort(compareSegmentsByEndpoints);
}

function orderedSegmentsForSignature(oligo: Oligo): OligoSegment[] {
	const fallback = sortedSegments(oligo);
	const start = oligo.isCircular ? fallback[0] : (oligo.fivePrimeEndSegment ?? fallback[0]);
	if (!start) return [];

	const ordered: OligoSegment[] = [];
	const seen = new Set<string>();
	let current: OligoSegment | null = start;
	while (current && oligo.segments.has(current) && !seen.has(current.id)) {
		ordered.push(current);
		seen.add(current.id);
		current = current.threePrime.connectedSegment;
	}

	for (const segment of fallback) {
		if (!seen.has(segment.id)) ordered.push(segment);
	}
	return ordered;
}

function fnv1a32(input: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}

export function buildOligoSignature(oligo: Oligo): string {
	return orderedSegmentsForSignature(oligo).map(segmentSignature).join('|');
}

export function formatOligoKey(signature: string): string {
	return `oligo-${fnv1a32(signature)}`;
}

export function describeOligoPositions(oligo: Oligo): string {
	return orderedSegmentsForSignature(oligo).map(segmentSignature).join(', ');
}
