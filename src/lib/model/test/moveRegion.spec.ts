import { describe, expect, it } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import { addLatticeVh } from '$lib/model/test/testHelpers';
import { createTestHistory, expectUndoRoundTrip } from '$lib/commands/test/undoRoundTrip';
import { changeRegionLengthCmd, moveRegionCmd, splitRegionCmd } from '$lib/commands/regions';
import { regionMaxBpIdx } from '$lib/components/Editor/StrandView/Grid/regionHeaderGeometry';
import type Oligo from '$lib/model/Oligo/Oligo.svelte';

const firstSegment = (oligo: Oligo) => [...oligo.segments][0];

/** Regions A (vh0), B (vh1), C (vh2), with an oligo crossing from vh0 into vh1. */
function threeRegionScene() {
	const doc = new FoldnanoDocument('doc', 'move region');
	const part = doc.addNewPart('HONEYCOMB');
	const history = createTestHistory(doc);
	const vh0 = addLatticeVh(part, 0, 0);
	const vh1 = addLatticeVh(part, 1, 0);
	const vh2 = addLatticeVh(part, 1, 1);

	const up = part.createOligo(vh0, 0, 20);
	const down = part.createOligo(vh1, 20, 0);
	part.connectSegmentEnds(firstSegment(up), firstSegment(down));

	splitRegionCmd(history, part, part.getDefaultRegion().id, vh0.id);
	splitRegionCmd(history, part, part.regions[1].id, vh1.id);
	const [a, b, c] = part.regions;
	return { doc, part, history, a, b, c, vh0, vh1, vh2, up };
}

describe('moveRegionCmd', () => {
	it('reorders regions and the helices’ list rows, undoably', () => {
		const { doc, part, history, a, b, c, vh0, vh1, vh2 } = threeRegionScene();

		expectUndoRoundTrip(doc, history, () => moveRegionCmd(history, part, c.id, 0));

		expect(part.regions.map((r) => r.id)).toEqual([c.id, a.id, b.id]);
		expect([vh2, vh0, vh1].map((vh) => vh.listRow)).toEqual([0, 1, 2]);
	});

	it('keeps cross-region strands attached to the moved helices', () => {
		const { part, history, a, vh0, vh1, up } = threeRegionScene();

		moveRegionCmd(history, part, a.id, 2);

		expect(part.getEntitiesAtVh(vh0.id, 0, 10).oligo).toBe(up);
		expect(part.getEntitiesAtVh(vh1.id, 1, 10).oligo).toBe(up);
		history.undoOnce();
		expect(part.regions[0].id).toBe(a.id);
		expect(part.getEntitiesAtVh(vh1.id, 1, 10).oligo).toBe(up);
	});

	it('clamps the target index and records nothing for a no-op move', () => {
		const { part, history, a, b, c } = threeRegionScene();
		const undos = history.numberOfUndos;

		moveRegionCmd(history, part, a.id, -1);
		moveRegionCmd(history, part, c.id, 99);
		moveRegionCmd(history, part, 'missing', 0);
		expect(history.numberOfUndos).toBe(undos);

		moveRegionCmd(history, part, a.id, 99);
		expect(part.regions.map((r) => r.id)).toEqual([b.id, c.id, a.id]);
	});

	it('keeps each header at its own region length, whichever region is first', () => {
		const { part, history, a, b, c } = threeRegionScene();
		changeRegionLengthCmd(history, b, b.step);
		const lengths = () => [a, b, c].map((r) => regionMaxBpIdx(part, r.id));
		const before = lengths();
		expect(before[1]).toBeGreaterThan(before[0]);

		moveRegionCmd(history, part, a.id, 2);

		expect(part.maxBase).toBe(b.maxBase);
		expect(lengths()).toEqual(before);
		moveRegionCmd(history, part, c.id, 0);
		expect(lengths()).toEqual(before);
	});
});
