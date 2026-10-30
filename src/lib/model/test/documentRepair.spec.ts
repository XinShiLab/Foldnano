import { describe, expect, it } from 'vitest';
import FoldnanoDocument, { type DocSnapshot } from '$lib/model/document.svelte';
import { repairDocumentJson } from '$lib/model/documentRepair';
import { findDerivedStateMismatch } from '$lib/commands/historyVerification';
import { createTestHistory } from '$lib/commands/test/undoRoundTrip';
import { deleteLatticeVirtualHelicesCmd } from '$lib/commands/virtualHelix';
import { addLatticeVh } from './testHelpers';

/** VH0 holds oligo A (6..21) and B (23..32); VH1 holds C (14..27); VH2 is empty. */
function scene() {
	const doc = new FoldnanoDocument('doc', 'repair');
	const part = doc.addNewPart('HONEYCOMB');
	const vh0 = addLatticeVh(part, 0, 0);
	const vh1 = addLatticeVh(part, 1, 0);
	addLatticeVh(part, 2, 0);
	part.createOligo(vh0, 6, 21);
	part.createOligo(vh0, 23, 32);
	part.createOligo(vh1, 14, 27);
	return doc.snapshot();
}

/** One staple: VH0 (0..9) → VH1 (9..0) → VH2 (0..9), joined by two crossovers. */
function crossoverScene() {
	const doc = new FoldnanoDocument('doc', 'repair');
	const part = doc.addNewPart('HONEYCOMB');
	const vhs = [addLatticeVh(part, 0, 0), addLatticeVh(part, 1, 0), addLatticeVh(part, 2, 0)];
	const a = part.createOligo(vhs[0], 0, 9);
	const b = part.createOligo(vhs[1], 9, 0);
	const c = part.createOligo(vhs[2], 0, 9);
	part.connectTwoOligos(a, b);
	part.connectTwoOligos(a, c);
	return doc.snapshot();
}

const partOf = (snapshot: DocSnapshot) => snapshot.parts[0];
const strandIds = (snapshot: DocSnapshot, vhIndex: number, strand: 0 | 1) =>
	partOf(snapshot).virtualHelices.find((vh) => vh.index === vhIndex)!.strandSets[strand].segmentIds;

/** Repairs, then checks the result loads, is internally consistent, and needs no second repair. */
function repairAndLoad(snapshot: DocSnapshot) {
	const { snapshot: repaired, repairs } = repairDocumentJson(snapshot);
	expect(repairs.length, 'something should have been repaired').toBeGreaterThan(0);
	const doc = FoldnanoDocument.fromJSON(repaired);
	expect(findDerivedStateMismatch(doc)).toBeNull();
	const part = doc.parts[0];
	const owned = [...part.oligos].flatMap((oligo) => [...oligo.segments]);
	const listed = part.virtualHelices.flatMap((vh) =>
		vh.strandSets.flatMap((ss) => [...ss.segmentIds])
	);
	expect(new Set(listed)).toEqual(new Set(owned.map((segment) => segment.id)));
	for (const segment of owned) expect(segment.inStrandSet.segmentIds.has(segment.id)).toBe(true);
	expect(repairDocumentJson(repaired).repairs).toEqual([]);
	return { doc, repaired, repairs };
}

describe('repairDocumentJson', () => {
	it('flips V of a mirrored plane so its basis is right-handed, keeping the 2D layout', () => {
		const snapshot = scene();
		const plane = partOf(snapshot).planes[0];
		// The old Side (YZ) base plane: u × v = -X, opposite its stored normal.
		Object.assign(plane, {
			u: { x: 0, y: 1, z: 0 },
			v: { x: 0, y: 0, z: -1 },
			normal: { x: 1, y: 0, z: 0 },
		});
		const cellsBefore = partOf(snapshot).virtualHelices.map((vh) => vh.latticeCoords);

		const { repaired, repairs } = repairAndLoad(snapshot);

		expect(repairs).toEqual([expect.stringContaining('Flipped the V axis of plane')]);
		expect(partOf(repaired).planes[0]).toMatchObject({
			u: { x: 0, y: 1, z: 0 },
			v: { x: 0, y: 0, z: 1 },
			normal: { x: 1, y: 0, z: 0 },
		});
		expect(partOf(repaired).virtualHelices.map((vh) => vh.latticeCoords)).toEqual(cellsBefore);
	});

	it('returns a consistent document untouched', () => {
		for (const snapshot of [scene(), crossoverScene()]) {
			const result = repairDocumentJson(snapshot);
			expect(result.repairs).toEqual([]);
			expect(result.snapshot).toBe(snapshot);
		}
	});

	it('drops strandSet ids no oligo owns, so the emptied VH can be deleted', () => {
		const snapshot = scene();
		const part = partOf(snapshot);
		const ghostIds = part.oligos.slice(0, 2).flatMap((o) => o.segments.map((s) => s.id));
		part.oligos = part.oligos.slice(2);

		const { doc, repaired } = repairAndLoad(snapshot);
		expect(strandIds(repaired, 0, 0).filter((id) => ghostIds.includes(id))).toEqual([]);

		const history = createTestHistory(doc);
		deleteLatticeVirtualHelicesCmd({ part: doc.parts[0], vhIndices: [0] }, history);
		expect(doc.parts[0].getVhByIndex(0)).toBeNull();
	});

	it('re-lists an owned segment missing from its VH', () => {
		const snapshot = scene();
		const orphanId = partOf(snapshot).oligos[0].segments[0].id;
		const ss = partOf(snapshot).virtualHelices[0].strandSets[0];
		ss.segmentIds = ss.segmentIds.filter((id) => id !== orphanId);

		const { repaired } = repairAndLoad(snapshot);
		expect(strandIds(repaired, 0, 0)).toContain(orphanId);
	});

	it('moves a segment listed in the wrong strand', () => {
		const snapshot = scene();
		const vh = partOf(snapshot).virtualHelices[0];
		const misplaced = vh.strandSets[0].segmentIds.shift()!;
		vh.strandSets[1].segmentIds.push(misplaced);

		const { repaired } = repairAndLoad(snapshot);
		expect(strandIds(repaired, 0, 0)).toContain(misplaced);
		expect(strandIds(repaired, 0, 1)).not.toContain(misplaced);
	});

	it('drops a segment on a deleted VH and splits the oligo around it', () => {
		const snapshot = crossoverScene();
		const part = partOf(snapshot);
		part.virtualHelices = part.virtualHelices.filter((vh) => vh.index !== 1);
		expect(() => FoldnanoDocument.fromJSON(snapshot)).toThrow(/VirtualHelix with index 1/);

		const { doc, repaired } = repairAndLoad(snapshot);
		const oligos = partOf(repaired).oligos;
		expect(oligos).toHaveLength(2);
		expect(oligos[0].id).toBe(part.oligos[0].id);
		expect(oligos.map((o) => o.segments.map((s) => s.inVirtualHelixIndex))).toEqual([[0], [2]]);
		for (const segment of oligos.flatMap((o) => o.segments)) {
			expect(segment.fivePrime.connectedSegmentId).toBeNull();
			expect(segment.threePrime.connectedSegmentId).toBeNull();
		}
		expect(doc.parts[0].oligos.size).toBe(2);
	});

	it('keeps a segment claimed by two oligos only in the first', () => {
		const snapshot = scene();
		const part = partOf(snapshot);
		const shared = structuredClone(part.oligos[0].segments[0]);
		part.oligos[1].segments.push(shared);

		const { repaired } = repairAndLoad(snapshot);
		const owners = partOf(repaired).oligos.filter((o) =>
			o.segments.some((s) => s.id === shared.id)
		);
		expect(owners.map((o) => o.id)).toEqual([part.oligos[0].id]);
	});

	it('clears crossover links to segments that do not exist', () => {
		const snapshot = scene();
		const segment = partOf(snapshot).oligos[0].segments[0];
		segment.threePrime.connectedSegmentId = 'missing-segment';

		const { repaired } = repairAndLoad(snapshot);
		expect(partOf(repaired).oligos[0].segments[0].threePrime.connectedSegmentId).toBeNull();
	});
});
