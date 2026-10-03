// Shared by real Apply and the future design-preflight reconstruction; owned by neither.

import { CadnanoJSON, type VStrandJSON } from '$lib/model/io/cadnanoJSON';
import type { Part } from '$lib/model/Part';
import { LatticedDesignRegion } from '$lib/model/Part/DesignRegion';
import { partFromJSON } from '$lib/model/document.svelte';

export type PartJSON = ReturnType<import('$lib/model/Part/Part.svelte').Part['toJSON']>;

export interface RegraftDiagnostics {
	matched: number;
	unmatched: number;
	warnings: string[];
}

export interface CrossRegionReconnectDiagnostics {
	/** Number of cross-region links captured before VH removal (0 = nothing to report). */
	attempted: number;
	restored: number;
	skipped: number;
	/** One entry per failed reconnect attempt, in the order they occurred. */
	warnings: string[];
}

type SlotJSON = {
	bpIndex: number;
	seq: string;
};

type AnnotationEntry = {
	slots: SlotJSON[];
	fivePrimeMod: string | null;
	threePrimeMod: string | null;
	oligoName: string;
};

type CrossRegionLink = {
	/** Segment key for the region segment: "vhIdx:strandIdx:fiveIdx:threeIdx" */
	regionSegKey: string;
	/** True when the cross-region connection leaves via the region segment's 3' end */
	isRegionSegAtThreePrime: boolean;
	/** Segment key for the external segment (in a different region) */
	externalSegKey: string;
};

// ---------------------------------------------------------------------------
// Region replacement (cadnano_json)
// ---------------------------------------------------------------------------

export function performReplaceRegion(
	part: Part,
	region: LatticedDesignRegion,
	cadnanoData: { name: string; vstrands: VStrandJSON[] }
): CrossRegionReconnectDiagnostics {
	const crossLinks = captureCrossRegionLinks(part, region);
	const oldVhIndices = part.virtualHelices
		.filter((vh) => vh.regionId === region.id)
		.map((vh) => vh.index);
	part.removeVirtualHelicesByIndex(oldVhIndices);
	new CadnanoJSON(cadnanoData.name, cadnanoData.vstrands).replaceRegionInPart(part, region);
	const crossRegionLinks = reconnectCrossRegionLinks(part, crossLinks);
	part.rebuildRspCaches();
	return crossRegionLinks;
}

export function performReplaceRegionKeepAnnotations(
	part: Part,
	region: LatticedDesignRegion,
	cadnanoData: { name: string; vstrands: VStrandJSON[] },
	preRunSnapshot: PartJSON
): { diagnostics: RegraftDiagnostics; crossRegionLinks: CrossRegionReconnectDiagnostics } {
	const crossLinks = captureCrossRegionLinks(part, region);
	const annotationMap = buildAnnotationMap(preRunSnapshot);
	const oldVhIndices = part.virtualHelices
		.filter((vh) => vh.regionId === region.id)
		.map((vh) => vh.index);
	part.removeVirtualHelicesByIndex(oldVhIndices);
	new CadnanoJSON(cadnanoData.name, cadnanoData.vstrands).replaceRegionInPart(part, region);

	let matched = 0;
	let unmatched = 0;
	for (const oligo of part.oligos) {
		for (const segment of oligo.segments) {
			if (segment.inVirtualHelix.regionId !== region.id) continue;
			const key = makeSegmentKey(
				segment.inVirtualHelix.index,
				segment.inStrandIndex,
				segment.fivePrime.index,
				segment.threePrime.index
			);
			const entry = annotationMap.get(key);
			if (!entry) {
				unmatched++;
				continue;
			}
			const skipsAndInserts = slotsToSkipsAndInserts(entry.slots);
			if (skipsAndInserts.length > 0) segment.skipsAndInserts = skipsAndInserts;
			segment.sequence = slotsToSequence(entry.slots);
			segment.fivePrime.modification = entry.fivePrimeMod;
			segment.threePrime.modification = entry.threePrimeMod;
			oligo.name = entry.oligoName;
			matched++;
		}
	}
	const warnings =
		unmatched > 0
			? [
					`${unmatched} region segment(s) had no annotation match (new or repositioned topology). ${matched} segment(s) restored.`,
				]
			: [];

	const crossRegionLinks = reconnectCrossRegionLinks(part, crossLinks);
	part.rebuildRspCaches();
	return { diagnostics: { matched, unmatched, warnings }, crossRegionLinks };
}

// ---------------------------------------------------------------------------
// Whole-part replacement (foldnano_json) — constructs and returns a new Part;
// there is no existing part to mutate.
// ---------------------------------------------------------------------------

export function performReplacePart(resultPartJson: PartJSON): Part {
	const part = partFromJSON(resultPartJson);
	// Part.fromJSON rebuilds caches before normalizeVhLengthsToRegion() runs, which can
	// change VH geometry afterward — rebuild again so the returned part's caches are fresh.
	part.rebuildRspCaches();
	return part;
}

export function performReplacePartKeepAnnotations(
	resultPartJson: PartJSON,
	preRunSnapshot: PartJSON
): { part: Part; diagnostics: RegraftDiagnostics } {
	const part = partFromJSON(resultPartJson);
	const annotationMap = buildAnnotationMap(preRunSnapshot);

	let matched = 0;
	let unmatched = 0;
	for (const oligo of part.oligos) {
		for (const segment of oligo.segments) {
			const key = makeSegmentKey(
				segment.inVirtualHelix.index,
				segment.inStrandIndex,
				segment.fivePrime.index,
				segment.threePrime.index
			);
			const entry = annotationMap.get(key);
			if (!entry) {
				unmatched++;
				continue;
			}
			const skipsAndInserts = slotsToSkipsAndInserts(entry.slots);
			if (skipsAndInserts.length > 0) segment.skipsAndInserts = skipsAndInserts;
			segment.sequence = slotsToSequence(entry.slots);
			segment.fivePrime.modification = entry.fivePrimeMod;
			segment.threePrime.modification = entry.threePrimeMod;
			oligo.name = entry.oligoName;
			matched++;
		}
	}
	const warnings =
		unmatched > 0
			? [
					`${unmatched} segment(s) had no annotation match (new or repositioned topology). ${matched} segment(s) restored.`,
				]
			: [];
	// Only the FINAL state (after re-grafting) needs a fresh cache — the re-graft loop
	// only touches plain object-graph fields, never anything the spatial-index cache covers.
	part.rebuildRspCaches();
	return { part, diagnostics: { matched, unmatched, warnings } };
}

// ---------------------------------------------------------------------------
// Shared annotation helpers
// ---------------------------------------------------------------------------

export function makeSegmentKey(
	vhIdx: number,
	strandIdx: number,
	fivePrimeIdx: number,
	threePrimeIdx: number
): string {
	return `${vhIdx}:${strandIdx}:${fivePrimeIdx}:${threePrimeIdx}`;
}

export function buildAnnotationMap(snapshot: PartJSON | null): Map<string, AnnotationEntry> {
	const map = new Map<string, AnnotationEntry>();
	if (!snapshot) return map;

	for (const oligoJson of snapshot.oligos) {
		for (const segJson of oligoJson.segments) {
			const fivePrimeIdx = segJson.fivePrime.index;
			const threePrimeIdx = segJson.threePrime.index;
			const strandIdx = fivePrimeIdx < threePrimeIdx ? 0 : 1;
			const key = makeSegmentKey(
				segJson.inVirtualHelixIndex,
				strandIdx,
				fivePrimeIdx,
				threePrimeIdx
			);
			map.set(key, {
				slots: Array.isArray(segJson.slots) ? segJson.slots : [],
				fivePrimeMod: segJson.fivePrime.modification ?? null,
				threePrimeMod: segJson.threePrime.modification ?? null,
				oligoName: oligoJson.name ?? '',
			});
		}
	}
	return map;
}

export function slotsToSequence(slots: SlotJSON[]): string {
	return slots.map((s) => s.seq).join('');
}

export function slotsToSkipsAndInserts(slots: SlotJSON[]): [number, number][] {
	return slots.reduce<[number, number][]>((acc, s) => {
		if (s.seq.length === 0) acc.push([s.bpIndex, -1]);
		else if (s.seq.length > 1) acc.push([s.bpIndex, s.seq.length - 1]);
		return acc;
	}, []);
}

// ---------------------------------------------------------------------------
// Cross-region connection preservation (region replacement only)
// ---------------------------------------------------------------------------

/**
 * Walk all VHs in the given region and record every cross-region connection
 * (5' or 3' end of a region segment linked to a segment in a different region).
 */
function captureCrossRegionLinks(part: Part, region: LatticedDesignRegion): CrossRegionLink[] {
	const links: CrossRegionLink[] = [];
	const regionVhIds = new Set(
		part.virtualHelices.filter((vh) => vh.regionId === region.id).map((vh) => vh.id)
	);

	for (const vh of part.virtualHelices) {
		if (vh.regionId !== region.id) continue;
		for (const strandSet of vh.strandSets) {
			for (const segId of strandSet.segmentIds) {
				const seg = part.getSegmentById(segId);
				if (!seg) continue;

				const regionSegKey = makeSegmentKey(
					vh.index,
					seg.inStrandIndex,
					seg.fivePrime.index,
					seg.threePrime.index
				);

				const threePrimeConnected = seg.threePrime.connectedSegment;
				if (threePrimeConnected && !regionVhIds.has(threePrimeConnected.inVirtualHelix.id)) {
					links.push({
						regionSegKey,
						isRegionSegAtThreePrime: true,
						externalSegKey: makeSegmentKey(
							threePrimeConnected.inVirtualHelix.index,
							threePrimeConnected.inStrandIndex,
							threePrimeConnected.fivePrime.index,
							threePrimeConnected.threePrime.index
						),
					});
				}

				const fivePrimeConnected = seg.fivePrime.connectedSegment;
				if (fivePrimeConnected && !regionVhIds.has(fivePrimeConnected.inVirtualHelix.id)) {
					links.push({
						regionSegKey,
						isRegionSegAtThreePrime: false,
						externalSegKey: makeSegmentKey(
							fivePrimeConnected.inVirtualHelix.index,
							fivePrimeConnected.inStrandIndex,
							fivePrimeConnected.fivePrime.index,
							fivePrimeConnected.threePrime.index
						),
					});
				}
			}
		}
	}
	return links;
}

/**
 * After re-importing a region, attempt to restore cross-region connections
 * that were captured before VH removal. Only reconnects where both segment
 * keys still resolve to existing segments with matching free ends.
 */
function reconnectCrossRegionLinks(
	part: Part,
	links: CrossRegionLink[]
): CrossRegionReconnectDiagnostics {
	if (links.length === 0) return { attempted: 0, restored: 0, skipped: 0, warnings: [] };

	const segByKey = new Map<string, import('$lib/model/Oligo/OligoSegment.svelte').default>();
	for (const vh of part.virtualHelices) {
		for (const strandSet of vh.strandSets) {
			for (const segId of strandSet.segmentIds) {
				const seg = part.getSegmentById(segId);
				if (!seg) continue;
				const key = makeSegmentKey(
					vh.index,
					seg.inStrandIndex,
					seg.fivePrime.index,
					seg.threePrime.index
				);
				segByKey.set(key, seg);
			}
		}
	}

	let restored = 0;
	let skipped = 0;
	const warnings: string[] = [];

	for (const link of links) {
		const regionSeg = segByKey.get(link.regionSegKey);
		const externalSeg = segByKey.get(link.externalSegKey);

		if (!regionSeg || !externalSeg) {
			skipped++;
			continue;
		}

		if (link.isRegionSegAtThreePrime) {
			if (!regionSeg.threePrime.isFree || !externalSeg.fivePrime.isFree) {
				skipped++;
				continue;
			}
			const regionOligo = regionSeg.oligo;
			const externalOligo = externalSeg.oligo;
			if (!regionOligo || !externalOligo) {
				skipped++;
				continue;
			}
			try {
				part.connectTwoOligos(regionOligo, externalOligo);
				restored++;
			} catch (e) {
				warnings.push(`Cross-region reconnect failed: ${(e as Error).message}`);
				skipped++;
			}
		} else {
			if (!externalSeg.threePrime.isFree || !regionSeg.fivePrime.isFree) {
				skipped++;
				continue;
			}
			const externalOligo = externalSeg.oligo;
			const regionOligo = regionSeg.oligo;
			if (!externalOligo || !regionOligo) {
				skipped++;
				continue;
			}
			try {
				part.connectTwoOligos(externalOligo, regionOligo);
				restored++;
			} catch (e) {
				warnings.push(`Cross-region reconnect failed: ${(e as Error).message}`);
				skipped++;
			}
		}
	}

	return { attempted: links.length, restored, skipped, warnings };
}
