import { describe, expect, it } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import { addFreeformVh, addLatticeVh } from '$lib/model/test/testHelpers';
import { createTestHistory } from '$lib/commands/test/undoRoundTrip';
import { duplicateRegionCmd, splitRegionCmd } from '$lib/commands/regions';
import { Part } from '$lib/model/Part';
import type Oligo from '$lib/model/Oligo/Oligo.svelte';
import { createRepeatGroupCmd } from '$lib/commands/repeatGroups';
import { renameOligoCmd } from '$lib/commands/strands';

const firstSegment = (oligo: Oligo) => [...oligo.segments][0];

/** Region A holds vh0 + vh1; region B holds vh2. `inside` crosses vh0→vh1, `across` vh1→vh2. */
function twoRegionScene() {
	const doc = new FoldnanoDocument('doc', 'duplicate region');
	const part = doc.addNewPart('HONEYCOMB');
	const history = createTestHistory(doc);
	const vh0 = addLatticeVh(part, 0, 0);
	const vh1 = addLatticeVh(part, 1, 0);
	const vh2 = addLatticeVh(part, 1, 1);

	const inside = part.createOligo(vh0, 0, 20);
	const insideDown = part.createOligo(vh1, 20, 0);
	part.connectSegmentEnds(firstSegment(inside), firstSegment(insideDown));

	const across = part.createOligo(vh1, 30, 40);
	const acrossDown = part.createOligo(vh2, 40, 30);
	part.connectSegmentEnds(firstSegment(across), firstSegment(acrossDown));

	const regionA = part.getDefaultRegion();
	splitRegionCmd(history, part, regionA.id, vh1.id);
	const regionB = part.regions[1];
	return { doc, part, history, regionA, regionB, vh0, vh1, vh2, inside, across };
}

describe('duplicateRegionCmd', () => {
	it('adds a copy of the region with its own plane, helices and strands', () => {
		const { part, history, regionA, vh0, vh1, inside } = twoRegionScene();
		const oligoCount = part.oligos.size;

		const copy = duplicateRegionCmd(history, part, regionA.id)!;

		expect(part.regions.map((r) => r.id)).toEqual([regionA.id, copy.id, part.regions[2].id]);
		expect(copy.kind).toBe(regionA.kind);
		expect(copy.name).not.toBe(regionA.name);
		expect(copy.planeId).not.toBe(regionA.planeId);
		expect(copy.maxBase).toBe(regionA.maxBase);

		const plane = part.getPlaneById(regionA.planeId)!;
		const copyPlane = part.getPlaneById(copy.planeId)!;
		expect(copyPlane.normal).toEqual(plane.normal);
		expect(copyPlane.origin).not.toEqual(plane.origin);

		const copyVhs = copy.vhOrder.map((id) => part.getVhById(id)!);
		expect(copyVhs.map((vh) => vh.latticeCoords)).toEqual([vh0.latticeCoords, vh1.latticeCoords]);
		expect(copyVhs.every((vh) => vh.regionId === copy.id)).toBe(true);
		expect(new Set(part.virtualHelices.map((vh) => vh.index)).size).toBe(5);
		// Even index offset keeps index parity.
		expect(copyVhs.map((vh) => vh.index % 2)).toEqual([vh0.index % 2, vh1.index % 2]);

		// `inside` is copied whole (crossover kept); `across` only up to the region boundary.
		expect(part.oligos.size).toBe(oligoCount + 2);
		const insideCopy = part.getEntitiesAtVh(copyVhs[0].id, 0, 10).oligo!;
		expect(insideCopy).not.toBe(inside);
		expect(insideCopy.segments.size).toBe(2);
		expect(insideCopy.color).toBe(inside.color);
		expect(part.getEntitiesAtVh(copyVhs[1].id, 1, 10).oligo).toBe(insideCopy);

		const acrossCopy = part.getEntitiesAtVh(copyVhs[1].id, 0, 35).oligo!;
		expect(acrossCopy.segments.size).toBe(1);
		const seg = firstSegment(acrossCopy);
		expect(seg.threePrime.isFree).toBe(true);
		expect(seg.threePrime.isConstrained).toBeFalsy();

		// The copy survives a save/load round trip.
		expect(() => Part.fromJSON(part.toJSON())).not.toThrow();
	});

	it('undoes and redoes as one step', () => {
		const { doc, part, history, regionA } = twoRegionScene();
		const before = JSON.stringify(part.toJSON());
		duplicateRegionCmd(history, part, regionA.id);
		const after = JSON.stringify(doc.parts[0].toJSON());

		history.undoOnce();
		expect(JSON.stringify(doc.parts[0].toJSON())).toBe(before);
		history.redoOnce();
		expect(JSON.stringify(doc.parts[0].toJSON())).toBe(after);
	});

	it('copies freeform helices with their local frames', () => {
		const doc = new FoldnanoDocument('doc', 'duplicate freeform');
		const part = doc.addNewPart('FREEFORM');
		const history = createTestHistory(doc);
		const vh = addFreeformVh(part, [0, 0, 0], [1, 0, 0]);
		part.createOligo(vh, 0, 20);
		const region = part.getDefaultRegion();

		const copy = duplicateRegionCmd(history, part, region.id)!;
		const copyVh = part.getVhById(copy.vhOrder[0])!;

		expect(copyVh.localFrame).toEqual(vh.localFrame);
		expect(copyVh.localFrame).not.toBe(vh.localFrame);
		expect(part.getEntitiesAtVh(copyVh.id, 0, 5).segment).not.toBeNull();
	});

	it('carries a repeat group inside the region over as a new, unlinked group', () => {
		const { doc, history, regionA, inside } = twoRegionScene();
		createRepeatGroupCmd({ part: doc.parts[0], oligos: [inside], bpOffset: 42 }, history);
		const part = doc.parts[0];
		const group = part.repeatGroups[0];
		const mirror = [...part.oligos].find((o) => o.isMirror)!;

		const copy = duplicateRegionCmd(history, part, regionA.id)!;
		const copyVhIds = new Set(copy.vhOrder);
		const inCopy = [...part.oligos].filter((o) =>
			[...o.segments].every((seg) => copyVhIds.has(seg.inVirtualHelix.id))
		);
		const copyOriginal = inCopy.find((o) => o.repeatGroupId)!;
		const copyMirror = inCopy.find((o) => o.isMirror)!;

		expect(part.repeatGroups).toHaveLength(2);
		const newGroup = part.repeatGroups[1];
		expect(newGroup.id).not.toBe(group.id);
		expect(newGroup.name).not.toBe(group.name);
		expect(newGroup.instances.map((i) => i.bpOffset)).toEqual([42]);
		expect(newGroup.instances[0].id).not.toBe(group.instances[0].id);
		expect(copyOriginal.repeatGroupId).toBe(newGroup.id);
		expect(copyMirror.mirrorOf).toMatchObject({
			groupId: newGroup.id,
			instanceId: newGroup.instances[0].id,
			sourceOligoId: copyOriginal.id,
		});

		// Editing the copy's original updates only the copy's mirror.
		renameOligoCmd({ oligo: copyOriginal, name: 'copy staple' }, history);
		const live = doc.parts[0];
		const mirrors = [...live.oligos].filter((o) => o.isMirror);
		expect(mirrors).toHaveLength(2);
		expect(mirrors.filter((o) => o.name === 'copy staple')).toHaveLength(1);
		expect(live.getOligoById(mirror.id)?.name).toBe(mirror.name);
	});

	it('copies a repeat group that crosses the region boundary as plain oligos', () => {
		const { doc, history, regionA, across } = twoRegionScene();
		createRepeatGroupCmd({ part: doc.parts[0], oligos: [across], bpOffset: 42 }, history);
		const part = doc.parts[0];
		const oligoCount = part.oligos.size;

		const copy = duplicateRegionCmd(history, part, regionA.id)!;
		const copyVhIds = new Set(copy.vhOrder);
		const inCopy = [...part.oligos].filter((o) =>
			[...o.segments].every((seg) => copyVhIds.has(seg.inVirtualHelix.id))
		);

		expect(part.repeatGroups).toHaveLength(1);
		// inside (1) + across piece (1) + its mirror's piece (1)
		expect(part.oligos.size).toBe(oligoCount + 3);
		expect(inCopy.every((o) => o.repeatGroupId === null && o.mirrorOf === null)).toBe(true);
	});
});
