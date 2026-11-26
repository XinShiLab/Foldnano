import { describe, expect, it } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import { addLatticeVh } from '$lib/model/test/testHelpers';
import { createTestHistory } from '$lib/commands/test/undoRoundTrip';
import { splitRegionAtBpCmd } from '$lib/commands/regions';
import { createRepeatGroupCmd } from '$lib/commands/repeatGroups';
import { analyzeBpSplit } from '$lib/model/Part/splitRegionAtBp';
import { Part } from '$lib/model/Part';
import type Oligo from '$lib/model/Oligo/Oligo.svelte';
import { backbonePoint } from '$lib/model/geometry3d/dnaGeometry';

const UNIT_OFFSET = 84; // 4 honeycomb steps
const firstSegment = (oligo: Oligo) => [...oligo.segments][0];

function honeycombPart(length = 168) {
	const doc = new FoldnanoDocument('doc', 'split at bp');
	const part = doc.addNewPart('HONEYCOMB');
	const history = createTestHistory(doc);
	const region = part.getDefaultRegion();
	region.increaseVhsLengthBy(length - region.maxBase);
	const vh0 = addLatticeVh(part, 0, 0);
	const vh1 = addLatticeVh(part, 1, 0);
	region.increaseVhsLengthBy(0);
	return { doc, part, history, region, vh0, vh1 };
}

/** Two units 84 bp apart (bp 10–70 and 94–154), each with a constrained vh0→vh1 crossover, and an
 * unconstrained connection from unit 1 (vh0, bp 70) to unit 2 (vh1, bp 150). Gap: bp 71–93. */
function twoUnitScene() {
	const scene = honeycombPart();
	const { part, vh0, vh1 } = scene;
	const site = part
		.potentialXoverSites(vh0.index)[0]
		.find((s) => s.toVhIdx === vh1.index && s.bpIdx >= 20 && s.bpIdx <= 50)!;
	const unit = (offset: number) => {
		const s = site.bpIdx + offset;
		const up = part.createOligo(vh0, 10 + offset, s);
		const down = part.createOligo(vh1, s, 10 + offset);
		part.connectSegmentEnds(firstSegment(up), firstSegment(down));
		return up;
	};
	const unit1 = unit(0);
	const unit2 = unit(UNIT_OFFSET);
	const bridgeFrom = part.createOligo(vh0, 60, 70);
	const bridgeTo = part.createOligo(vh1, 150, 140);
	part.connectSegmentEnds(firstSegment(bridgeFrom), firstSegment(bridgeTo));
	return { ...scene, site: site.bpIdx, unit1, unit2, bridge: bridgeFrom };
}

/** Lab-frame backbone position of every base, keyed by segment id and slot. */
function backbonePositions(part: Part): Map<string, { x: number; y: number; z: number }> {
	const out = new Map<string, { x: number; y: number; z: number }>();
	for (const oligo of part.oligos) {
		for (const seg of oligo.segments) {
			const vh = seg.inVirtualHelix;
			const region = part.getRegionForVh(vh);
			const frame = part.getVirtualHelixFrame(vh);
			seg.slots.forEach((slot, i) => {
				out.set(
					`${seg.id}:${i}`,
					backbonePoint(
						frame,
						slot.bpIndex,
						seg.inStrandIndex,
						region.twistOffsetInDeg,
						region.twistPerBaseInDeg
					)
				);
			});
		}
	}
	return out;
}

describe('analyzeBpSplit', () => {
	it('snaps the shift to whole lattice steps below the first moved base', () => {
		const { part, region } = twoUnitScene();
		for (const cut of [71, 80, 91]) {
			const check = analyzeBpSplit(part, region.id, cut);
			expect(check.ok && check.shift).toBe(84);
		}
	});

	it('refuses a column a strand runs through', () => {
		const { part, region, site } = twoUnitScene();
		const check = analyzeBpSplit(part, region.id, site);
		expect(check.ok).toBe(false);
		if (!check.ok) expect(check.blockingSegmentIds.length).toBeGreaterThan(0);
	});

	it('refuses a cut with nothing on one side', () => {
		const { part, region } = twoUnitScene();
		expect(analyzeBpSplit(part, region.id, 160).ok).toBe(false);
		expect(analyzeBpSplit(part, region.id, 5).ok).toBe(false);
	});

	it('uses the square lattice step', () => {
		const doc = new FoldnanoDocument('doc', 'square');
		const part = doc.addNewPart('SQUARE');
		const region = part.getDefaultRegion();
		region.increaseVhsLengthBy(128 - region.maxBase);
		const vh = addLatticeVh(part, 0, 0);
		part.createOligo(vh, 2, 20);
		part.createOligo(vh, 70, 90);
		const check = analyzeBpSplit(part, region.id, 50);
		expect(check.ok && check.shift).toBe(64);
	});
});

describe('splitRegionAtBpCmd', () => {
	it('moves the right unit to a new region without moving anything in 3D', () => {
		const { part, history, region, vh0, vh1, site, unit1, unit2, bridge } = twoUnitScene();
		const before = backbonePositions(part);
		const constrainedBefore = firstSegment(unit2).threePrime.isConstrained;
		expect(constrainedBefore).toBe(true);
		const oligoIds = [...part.oligos].map((o) => o.id).sort();

		const { region: right, shift } = splitRegionAtBpCmd(history, part, region.id, 91);

		expect(shift).toBe(84);
		expect(part.regions.map((r) => r.id)).toEqual([region.id, right.id]);
		expect(right.planeId).not.toBe(region.planeId);
		expect(region.maxBase).toBe(105);
		expect(right.maxBase).toBe(168 - 84);
		expect(vh0.length).toBe(105);

		const rightVhs = right.vhOrder.map((id) => part.getVhById(id)!);
		expect(rightVhs.map((vh) => vh.latticeCoords)).toEqual([vh0.latticeCoords, vh1.latticeCoords]);
		expect(rightVhs.map((vh) => vh.index % 2)).toEqual([vh0.index % 2, vh1.index % 2]);
		expect(rightVhs.every((vh) => vh.length === 168 - 84)).toBe(true);

		// Same oligos and segments, same 3D positions.
		expect([...part.oligos].map((o) => o.id).sort()).toEqual(oligoIds);
		const after = backbonePositions(part);
		expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
		for (const [key, p] of before) {
			const q = after.get(key)!;
			expect(q.x).toBeCloseTo(p.x, 6);
			expect(q.y).toBeCloseTo(p.y, 6);
			expect(q.z).toBeCloseTo(p.z, 6);
		}

		// Unit 2 now starts where unit 1 does, and its crossover is still constrained.
		const moved = part.getOligoById(unit2.id)!;
		const up = [...moved.segments].find((s) => s.inVirtualHelix === rightVhs[0])!;
		expect([up.lowIndex, up.highIndex]).toEqual([10, site]);
		expect(up.threePrime.isConstrained).toBe(true);
		expect(firstSegment(part.getOligoById(unit1.id)!).threePrime.isConstrained).toBe(true);

		// The bridge now crosses from the left region into the right one.
		const bridgeOligo = part.getOligoById(bridge.id)!;
		const regions = new Set([...bridgeOligo.segments].map((s) => s.inVirtualHelix.regionId));
		expect(regions).toEqual(new Set([region.id, right.id]));
		expect(bridgeOligo.segments.size).toBe(2);

		expect(() => Part.fromJSON(part.toJSON())).not.toThrow();
	});

	it('undoes and redoes as one step', () => {
		const { doc, part, history, region } = twoUnitScene();
		const before = JSON.stringify(part.toJSON());
		splitRegionAtBpCmd(history, part, region.id, 91);
		const after = JSON.stringify(doc.parts[0].toJSON());

		history.undoOnce();
		expect(JSON.stringify(doc.parts[0].toJSON())).toBe(before);
		history.redoOnce();
		expect(JSON.stringify(doc.parts[0].toJSON())).toBe(after);
	});

	it('leaves the design unchanged when the cut is refused', () => {
		const { part, history, region, site } = twoUnitScene();
		const before = JSON.stringify(part.toJSON());
		expect(() => splitRegionAtBpCmd(history, part, region.id, site)).toThrow(/through this/);
		expect(JSON.stringify(part.toJSON())).toBe(before);
	});

	it('splits three units into three regions', () => {
		const { part, history, region, vh0 } = honeycombPart(252);
		for (const offset of [0, 84, 168]) part.createOligo(vh0, 10 + offset, 60 + offset);
		const middle = splitRegionAtBpCmd(history, part, region.id, 80).region;
		const last = splitRegionAtBpCmd(history, part, middle.id, 80).region;

		expect(part.regions.map((r) => r.id)).toEqual([region.id, middle.id, last.id]);
		for (const r of part.regions) {
			const vh = part.getVhById(r.vhOrder[0])!;
			const ids = [...vh.strandSets[0].segmentIds].map((id) => part.getSegmentById(id)!);
			expect(ids.map((s) => [s.lowIndex, s.highIndex])).toEqual([[10, 60]]);
		}
	});
});

describe('splitRegionAtBp and repeat groups', () => {
	it('detaches a group with copies on both sides', () => {
		const { doc, history, region, vh0 } = honeycombPart();
		const source = doc.parts[0].createOligo(vh0, 10, 20);
		createRepeatGroupCmd({ part: doc.parts[0], oligos: [source], bpOffset: 84 }, history);
		const part = doc.parts[0];

		const { detachedGroupNames } = splitRegionAtBpCmd(history, part, region.id, 91);

		expect(detachedGroupNames).toHaveLength(1);
		expect(part.repeatGroups).toHaveLength(0);
		expect([...part.oligos].some((o) => o.isMirror || o.repeatGroupId)).toBe(false);
		expect(part.oligos.size).toBe(2);
	});

	it('keeps a group lying wholly right of the cut', () => {
		const { doc, history, region, vh0 } = honeycombPart();
		doc.parts[0].createOligo(vh0, 10, 20);
		const source = doc.parts[0].createOligo(vh0, 100, 110);
		createRepeatGroupCmd({ part: doc.parts[0], oligos: [source], bpOffset: 21 }, history);
		const part = doc.parts[0];
		const mirrorId = [...part.oligos].find((o) => o.isMirror)!.id;

		const { detachedGroupNames } = splitRegionAtBpCmd(history, part, region.id, 91);

		expect(detachedGroupNames).toEqual([]);
		expect(part.repeatGroups).toHaveLength(1);
		const mirror = part.getOligoById(mirrorId)!;
		expect(mirror.isMirror).toBe(true);
		expect(firstSegment(mirror).lowIndex).toBe(121 - 84);
	});
});
