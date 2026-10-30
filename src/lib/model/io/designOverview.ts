/**
 * A structure-only overview of a design region: helices, scaffold routes and staple lengths. It
 * states facts, not judgements. Agent runs print it after each run so a coding agent sees what it
 * built. It never carries sequences, oligo names, colours or notes. See
 * docs/python-plugin-system.md § Agent runs.
 */

import type Oligo from '../Oligo/Oligo.svelte';
import type OligoSegment from '../Oligo/OligoSegment.svelte';
import type { Part } from '../Part';
import type { DesignRegion } from '../Part/DesignRegion';
import type VirtualHelix from '../VirtualHelix';

export const DESIGN_OVERVIEW_VERSION = 1;
/** Staple lengths most commercial suppliers make routinely; others are listed as outside it. */
export const STAPLE_LENGTH_RANGE = { min: 15, max: 60 } as const;

// Caps keep the overview about a page long, even for large designs.
const MAX_HELICES = 80;
const MAX_SCAFFOLDS = 4;
const MAX_ROUTE_SEGMENTS = 60;
const MAX_UNPAIRED_STRETCHES = 10;
const MAX_OUTSIDE_STAPLES = 10;
const HISTOGRAM_BIN_NT = 10;

/** A place on a helix, as the strand view labels it: helix number and bp. */
export interface HelixBp {
	helix: number;
	bp: number;
}

export interface HelixOverview {
	number: number;
	/** Lattice cell; null for freeform helices. */
	cell: { row: number; col: number } | null;
	length: number;
}

/** One stretch of a strand on one helix, from its 5′ bp to its 3′ bp. */
export interface RouteSegment {
	helix: number;
	from: number;
	to: number;
}

export interface UnpairedStretch {
	helix: number;
	from: number;
	to: number;
}

export interface ScaffoldOverview {
	lengthNt: number;
	circular: boolean;
	/** Helix numbers in the order the route first reaches them. */
	helixOrder: number[];
	segmentCount: number;
	/** Joins between segments on different helices. */
	crossoverCount: number;
	/** 5′ → 3′; capped, with `segmentCount` giving the total. */
	route: RouteSegment[];
	unpairedNt: number;
	/** Capped; `unpairedNt` counts them all. */
	unpaired: UnpairedStretch[];
}

export interface StapleOverview {
	count: number;
	circular: number;
	lengthNt: { min: number; median: number; max: number } | null;
	histogram: { from: number; to: number; count: number }[];
	range: { min: number; max: number };
	outsideRangeCount: number;
	/** Capped; each staple named by its 5′ end. */
	outsideRange: (HelixBp & { lengthNt: number })[];
}

export interface DesignOverview {
	overview: typeof DESIGN_OVERVIEW_VERSION;
	region: {
		id: string;
		name: string;
		kind: string;
		bpRange: { min: number; max: number };
		helixCount: number;
		/** In the region's display order; capped, with `helixCount` giving the total. */
		helices: HelixOverview[];
	};
	/** Scaffold oligos with a segment in the region. */
	scaffolds: ScaffoldOverview[];
	scaffoldCount: number;
	/** Staple oligos with a segment in the region. */
	staples: StapleOverview;
	otherRegions: { name: string; kind: string; helixCount: number }[];
}

/** Segments from the 5′ end (or, when circular, a fixed starting segment) to the 3′ end. */
function orderedSegments(oligo: Oligo): OligoSegment[] {
	const segments = [...oligo.segments];
	if (segments.length === 0) return [];
	const start =
		oligo.fivePrimeEndSegment ??
		segments.reduce((best, s) => {
			const a = [s.inVirtualHelix.index, s.lowIndex];
			const b = [best.inVirtualHelix.index, best.lowIndex];
			return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? s : best;
		});
	const ordered: OligoSegment[] = [];
	const seen = new Set<OligoSegment>();
	for (let s: OligoSegment | null = start; s && !seen.has(s); s = s.threePrime.connectedSegment) {
		seen.add(s);
		ordered.push(s);
	}
	return ordered;
}

function unpairedStretches(segment: OligoSegment): UnpairedStretch[] {
	const vh = segment.inVirtualHelix;
	const other = vh.strandSets[segment.inStrandIndex === 0 ? 1 : 0];
	const step = segment.inStrandIndex === 0 ? 1 : -1;
	const stretches: UnpairedStretch[] = [];
	let open: UnpairedStretch | null = null;
	for (let bp = segment.startNtIndex; ; bp += step) {
		if (other.isIndexOccupied(bp)) {
			open = null;
		} else if (open) {
			open.to = bp;
		} else {
			open = { helix: vh.index, from: bp, to: bp };
			stretches.push(open);
		}
		if (bp === segment.endNtIndex) break;
	}
	return stretches;
}

function scaffoldOverview(oligo: Oligo): ScaffoldOverview {
	const segments = orderedSegments(oligo);
	const helixOrder: number[] = [];
	let crossoverCount = 0;
	const unpaired: UnpairedStretch[] = [];
	for (const segment of segments) {
		const helix = segment.inVirtualHelix.index;
		if (!helixOrder.includes(helix)) helixOrder.push(helix);
		const next = segment.threePrime.connectedSegment;
		if (next && next.inVirtualHelix !== segment.inVirtualHelix) crossoverCount++;
		unpaired.push(...unpairedStretches(segment));
	}
	return {
		lengthNt: oligo.length,
		circular: oligo.isCircular,
		helixOrder,
		segmentCount: segments.length,
		crossoverCount,
		route: segments.slice(0, MAX_ROUTE_SEGMENTS).map((s) => ({
			helix: s.inVirtualHelix.index,
			from: s.startNtIndex,
			to: s.endNtIndex,
		})),
		unpairedNt: unpaired.reduce((n, s) => n + Math.abs(s.to - s.from) + 1, 0),
		unpaired: unpaired.slice(0, MAX_UNPAIRED_STRETCHES),
	};
}

function median(sorted: number[]): number {
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function stapleOverview(staples: Oligo[]): StapleOverview {
	const range = { ...STAPLE_LENGTH_RANGE };
	const lengths = staples.map((o) => o.length).sort((a, b) => a - b);
	const histogram: StapleOverview['histogram'] = [];
	if (lengths.length) {
		const first = Math.floor(lengths[0] / HISTOGRAM_BIN_NT) * HISTOGRAM_BIN_NT;
		for (let from = first; from <= lengths[lengths.length - 1]; from += HISTOGRAM_BIN_NT) {
			const to = from + HISTOGRAM_BIN_NT - 1;
			histogram.push({ from, to, count: lengths.filter((n) => n >= from && n <= to).length });
		}
	}
	const outside = staples
		.filter((o) => o.length < range.min || o.length > range.max)
		.map((o) => {
			const first = orderedSegments(o)[0];
			return {
				helix: first?.inVirtualHelix.index ?? -1,
				bp: first?.startNtIndex ?? -1,
				lengthNt: o.length,
			};
		})
		.sort((a, b) => a.helix - b.helix || a.bp - b.bp);
	return {
		count: staples.length,
		circular: staples.filter((o) => o.isCircular).length,
		lengthNt: lengths.length
			? { min: lengths[0], median: median(lengths), max: lengths[lengths.length - 1] }
			: null,
		histogram,
		range,
		outsideRangeCount: outside.length,
		outsideRange: outside.slice(0, MAX_OUTSIDE_STAPLES),
	};
}

function regionHelices(part: Part, region: DesignRegion): VirtualHelix[] {
	return region.vhOrder
		.map((id) => part.getVhById(id))
		.filter((vh): vh is VirtualHelix => vh !== null);
}

/**
 * The overview of one region (the active one, else the first). Oligos count when any of their
 * segments lies in it, so a scaffold that also runs through other regions is shown whole.
 */
export function buildDesignOverview(part: Part, regionId: string | null): DesignOverview | null {
	const region =
		(regionId ? part.regions.find((r) => r.id === regionId) : undefined) ?? part.regions[0];
	if (!region) return null;
	const helices = regionHelices(part, region);
	const inRegion = new Set(helices);
	const oligos = [...part.oligos].filter((o) =>
		[...o.segments].some((s) => inRegion.has(s.inVirtualHelix))
	);
	const scaffolds = oligos
		.filter((o) => o.isScaffold)
		.sort((a, b) => b.length - a.length)
		.map(scaffoldOverview);
	return {
		overview: DESIGN_OVERVIEW_VERSION,
		region: {
			id: region.id,
			name: region.name,
			kind: region.kind,
			bpRange: { min: region.minBase, max: region.maxBase - 1 },
			helixCount: helices.length,
			helices: helices.slice(0, MAX_HELICES).map((vh) => ({
				number: vh.index,
				cell: vh.latticeCoords ? { row: vh.latticeCoords.row, col: vh.latticeCoords.col } : null,
				length: vh.length,
			})),
		},
		scaffolds: scaffolds.slice(0, MAX_SCAFFOLDS),
		scaffoldCount: scaffolds.length,
		staples: stapleOverview(oligos.filter((o) => !o.isScaffold)),
		otherRegions: part.regions
			.filter((r) => r !== region)
			.map((r) => ({ name: r.name, kind: r.kind, helixCount: regionHelices(part, r).length })),
	};
}
