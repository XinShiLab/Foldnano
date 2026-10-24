import { describe, expect, it } from 'vitest';
import { checkSimulationProfile } from '../checks/simulation';
import type OligoSegment from '$lib/model/Oligo/OligoSegment.svelte';
import type VirtualHelix from '$lib/model/VirtualHelix';
import { addLatticeVh, makeHoneycombPart } from '$lib/model/test/testHelpers';
import { RISE_NM, buildSimulationNtModel } from './simulationNtModel';

function segmentOf(segments: Iterable<OligoSegment>): OligoSegment {
	return [...segments][0];
}

function setSymmetricSkipsAndInserts(
	segA: OligoSegment,
	segB: OligoSegment,
	entries: [number, number][]
): void {
	segA.skipsAndInserts = entries;
	segB.skipsAndInserts = entries;
}

function zValuesForSegment(segment: OligoSegment) {
	const model = buildSimulationNtModel(segment.inPart);
	return model.nucleotides.filter((nt) => nt.segmentId === segment.id).map((nt) => nt.positionNm.z);
}

// Returns the XY-plane angle (degrees) of each NT's position relative to the helix center.
// For VH at lattice col=0, row=0 the helix center x,y are both 0 at all bp positions.
function xyAnglesForSegment(segment: OligoSegment): number[] {
	const model = buildSimulationNtModel(segment.inPart);
	return model.nucleotides
		.filter((nt) => nt.segmentId === segment.id)
		.map((nt) => Math.atan2(nt.positionNm.y, nt.positionNm.x) * (180 / Math.PI));
}

// Signed angular step between consecutive elements, normalized to (-180, 180].
function angularSteps(angles: number[]): number[] {
	const steps: number[] = [];
	for (let i = 1; i < angles.length; i++) {
		let d = angles[i] - angles[i - 1];
		while (d > 180) d -= 360;
		while (d <= -180) d += 360;
		steps.push(d);
	}
	return steps;
}

function findTwoSites(vh: VirtualHelix): [number, number] {
	const sites = vh.inPart
		.potentialXoverSites(vh.index)[0]
		.map((site) => site.bpIdx)
		.filter((bp) => bp > 2)
		.sort((a, b) => a - b);
	for (let i = 0; i < sites.length; i++) {
		for (let j = i + 1; j < sites.length; j++) {
			if (sites[j] - sites[i] >= 6) return [sites[i], sites[j]];
		}
	}
	throw new Error('Expected at least two usable crossover sites');
}

function makeFixedSegment() {
	const part = makeHoneycombPart('fixed-span');
	const vh = addLatticeVh(part, 0, 0);
	const toVh = addLatticeVh(part, 1, 0);
	const [start, end] = findTwoSites(vh);
	const main = part.createOligo(vh, start, end);
	const mainSeg = segmentOf(main.segments);
	const comp = part.createOligo(vh, end, start);
	const compSeg = segmentOf(comp.segments);

	const left = part.createOligo(toVh, start + 1, start);
	const leftSeg = segmentOf(left.segments);
	const right = part.createOligo(toVh, end, end - 1);
	const rightSeg = segmentOf(right.segments);
	leftSeg.threePrime.connectTo(mainSeg.fivePrime);
	mainSeg.threePrime.connectTo(rightSeg.fivePrime);

	expect(mainSeg.fivePrime.isConstrained).toBe(true);
	expect(mainSeg.threePrime.isConstrained).toBe(true);

	return { mainSeg, compSeg, start, end };
}

describe('simulation NT model', () => {
	it('keeps natural rise through a fixed-fixed span without inserts/skips', () => {
		const { mainSeg } = makeFixedSegment();
		const zValues = zValuesForSegment(mainSeg);

		for (let i = 1; i < zValues.length; i++) {
			expect(zValues[i] - zValues[i - 1]).toBeCloseTo(RISE_NM, 6);
		}
	});

	it('compresses a fixed-fixed span with a symmetric insertion', () => {
		const { mainSeg, compSeg, start, end } = makeFixedSegment();
		setSymmetricSkipsAndInserts(mainSeg, compSeg, [[start + 2, 1]]);

		const zValues = zValuesForSegment(mainSeg);
		const averageStep = (zValues[zValues.length - 1] - zValues[0]) / (zValues.length - 1);

		expect(zValues).toHaveLength(end - start + 2);
		expect(averageStep).toBeLessThan(RISE_NM);
	});

	it('stretches a fixed-fixed span with a symmetric skip', () => {
		const { mainSeg, compSeg, start, end } = makeFixedSegment();
		setSymmetricSkipsAndInserts(mainSeg, compSeg, [[start + 2, -1]]);

		const zValues = zValuesForSegment(mainSeg);
		const averageStep = (zValues[zValues.length - 1] - zValues[0]) / (zValues.length - 1);

		expect(zValues).toHaveLength(end - start);
		expect(averageStep).toBeGreaterThan(RISE_NM);
	});

	it('distributes twist uniformly through a fixed-fixed span without inserts/skips', () => {
		const { mainSeg } = makeFixedSegment();
		const part = mainSeg.inPart;
		const vh = mainSeg.inVirtualHelix;
		const twistPerBase = part.getRegionForVh(vh).twistPerBaseInDeg;
		// makeFixedSegment uses findTwoSites which (with only two adjacent VHs) picks
		// sites [11, 22] for honeycomb — an 11-bp span accumulating ~377° (>1 full turn).
		// Each consecutive NT must advance by exactly twistPerBaseInDeg.
		const steps = angularSteps(xyAnglesForSegment(mainSeg));
		for (const step of steps) {
			expect(step).toBeCloseTo(twistPerBase, 4);
		}
	});

	it('distributes twist uniformly through a fixed-fixed span with a symmetric insertion', () => {
		const { mainSeg, compSeg, start } = makeFixedSegment();
		setSymmetricSkipsAndInserts(mainSeg, compSeg, [[start + 2, 1]]);
		const steps = angularSteps(xyAnglesForSegment(mainSeg));
		// All steps must be equal (compressed but uniform).
		const expectedStep = steps[0];
		for (const step of steps) {
			expect(step).toBeCloseTo(expectedStep, 4);
		}
	});

	it('rejects asymmetric insert/skip data', () => {
		const part = makeHoneycombPart('asymmetric');
		const vh = addLatticeVh(part, 0, 0);
		const seg = segmentOf(part.createOligo(vh, 0, 4).segments);
		part.createOligo(vh, 4, 0);
		seg.skipsAndInserts = [[2, 1]];

		expect(() => buildSimulationNtModel(part)).toThrow(/different skip\/insert on each strand/);
	});

	it('rejects a skip left on one strand after its partner strand was deleted', () => {
		const part = makeHoneycombPart('lone skip');
		const vh = addLatticeVh(part, 0, 0);
		const seg = segmentOf(part.createOligo(vh, 0, 4).segments);
		const partner = part.createOligo(vh, 4, 0);
		seg.addSkipOrInsertion(2, -1);
		part.removeOligo(partner);

		expect(checkSimulationProfile(part).map((issue) => issue.rule)).toEqual([
			'unpaired-skip-insert',
		]);
		expect(() => buildSimulationNtModel(part)).toThrow(/a skip on one strand only/);
	});

	it('rejects insert/skip data at constrained anchors', () => {
		const { mainSeg, compSeg, start } = makeFixedSegment();
		setSymmetricSkipsAndInserts(mainSeg, compSeg, [[start, 1]]);

		expect(() => buildSimulationNtModel(mainSeg.inPart)).toThrow(/constrained crossover site/);
	});

	it('keeps overhang nucleotides unpaired but geometrically valid', () => {
		const part = makeHoneycombPart('overhang');
		const vh = addLatticeVh(part, 0, 0);
		const overhang = segmentOf(part.createOligo(vh, 0, 6).segments);
		part.createOligo(vh, 4, 0);

		const model = buildSimulationNtModel(part);
		const tail = model.nucleotides.filter((nt) => nt.segmentId === overhang.id && nt.bpIndex > 4);

		expect(tail).toHaveLength(2);
		for (const nt of tail) {
			expect(Number.isFinite(nt.positionNm.x)).toBe(true);
			expect(Number.isFinite(nt.positionNm.y)).toBe(true);
			expect(Number.isFinite(nt.positionNm.z)).toBe(true);
		}
	});
});

// Two segments connected end-to-end within the same VH, with a gap between them (bp9 missing).
// strandIdx=0: seg1 at bp2..8, seg2 at bp10..18 connected via seg1.threePrime→seg2.fivePrime.
// strandIdx=1: compA at bp8..2, compB at bp18..10 (separate, no internal connection).
// VH is at col=0, row=0 so helix center is at x=y=0 and positionNm.z = coord * RISE_NM.
function makeInternalGapPart() {
	const part = makeHoneycombPart('internal-gap');
	const vh = addLatticeVh(part, 0, 0);
	const seg1 = segmentOf(part.createOligo(vh, 2, 8).segments);
	const seg2 = segmentOf(part.createOligo(vh, 10, 18).segments);
	seg1.threePrime.connectTo(seg2.fivePrime);
	const compA = segmentOf(part.createOligo(vh, 8, 2).segments);
	const compB = segmentOf(part.createOligo(vh, 18, 10).segments);
	return { part, vh, seg1, seg2, compA, compB };
}

describe('internal same-VH connection (gap bridged by end-to-end segment connection)', () => {
	it('places nucleotides at natural bpIndex z-positions across the gap without inserts', () => {
		const { seg1, seg2 } = makeInternalGapPart();
		const model = buildSimulationNtModel(seg1.inPart);

		for (const nt of model.nucleotides) {
			if (nt.segmentId !== seg1.id && nt.segmentId !== seg2.id) continue;
			expect(nt.positionNm.z).toBeCloseTo(nt.bpIndex * RISE_NM, 4);
		}
	});

	it('does not overlap nucleotide z-coords across the gap when inserts are present', () => {
		const { seg1, seg2, compA } = makeInternalGapPart();
		// 3 inserts at bp5 on both strands — cumulative effect shifts everything after bp5.
		setSymmetricSkipsAndInserts(seg1, compA, [[5, 3]]);
		const model = buildSimulationNtModel(seg1.inPart);

		const seg1Nts = model.nucleotides.filter((nt) => nt.segmentId === seg1.id);
		const seg2Nts = model.nucleotides.filter((nt) => nt.segmentId === seg2.id);
		const maxSeg1Z = Math.max(...seg1Nts.map((nt) => nt.positionNm.z));
		const minSeg2Z = Math.min(...seg2Nts.map((nt) => nt.positionNm.z));

		// bp8 (last of seg1): coord = 8 + 3 cumulative inserts = 11
		expect(maxSeg1Z).toBeCloseTo(11 * RISE_NM, 4);
		// bp10 (first of seg2): coord = 10 + 3 cumulative inserts = 13 (gap at bp9 = coord 12)
		expect(minSeg2Z).toBeCloseTo(13 * RISE_NM, 4);
		// No overlap: seg1 ends strictly before seg2 begins
		expect(maxSeg1Z).toBeLessThan(minSeg2Z);
	});
});

// A fixed-fixed span whose two domains are bridged by a same-VH end-to-end connection,
// leaving a physical gap in the middle (e.g. a bp83-178 gap on one VH).
// Both outer ends are constrained crossover anchors → the merged range becomes a single
// fixed-fixed span straddling the gap. The fixed-fixed distribution must preserve the gap
// rather than spreading nucleotides evenly across it.
function makeFixedSpanWithGapPart() {
	const part = makeHoneycombPart('fixed-gap');
	const vh = addLatticeVh(part, 0, 0);
	const toVh = addLatticeVh(part, 1, 0);
	const [start, end] = findTwoSites(vh);
	const mid1 = start + 2; // domain 1: start..mid1
	const mid2 = end - 2; // domain 2: mid2..end ; gap = mid1+1 .. mid2-1

	const seg1 = segmentOf(part.createOligo(vh, start, mid1).segments);
	const seg2 = segmentOf(part.createOligo(vh, mid2, end).segments);
	seg1.threePrime.connectTo(seg2.fivePrime); // same-VH bridge across the gap

	const left = segmentOf(part.createOligo(toVh, start + 1, start).segments);
	const right = segmentOf(part.createOligo(toVh, end, end - 1).segments);
	left.threePrime.connectTo(seg1.fivePrime);
	seg2.threePrime.connectTo(right.fivePrime);

	expect(seg1.fivePrime.isConstrained).toBe(true);
	expect(seg2.threePrime.isConstrained).toBe(true);

	return { part, seg1, seg2, start, mid1, mid2, end };
}

describe('fixed-fixed span straddling a same-VH bridged gap', () => {
	it('places nucleotides at natural bpIndex z-positions and leaves the gap empty', () => {
		const { part, seg1, seg2, mid1, mid2 } = makeFixedSpanWithGapPart();
		const model = buildSimulationNtModel(part);
		const spanNts = model.nucleotides.filter(
			(nt) => nt.segmentId === seg1.id || nt.segmentId === seg2.id
		);

		// No inserts/skips: every nucleotide sits at its natural axial coord (bpIndex * RISE).
		for (const nt of spanNts) {
			expect(nt.positionNm.z).toBeCloseTo(nt.bpIndex * RISE_NM, 4);
		}

		// The gap region carries no nucleotide z-coordinate (no NT spread into bp mid1+1..mid2-1).
		const gapLo = (mid1 + 1) * RISE_NM;
		const gapHi = (mid2 - 1) * RISE_NM;
		for (const nt of spanNts) {
			expect(nt.positionNm.z >= gapLo && nt.positionNm.z <= gapHi).toBe(false);
		}
	});
});
