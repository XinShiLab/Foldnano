import { addFreeformVh, addLatticeVh } from '$lib/model/test/testHelpers';
import { describe, expect, it } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import { StorageManager } from '$lib/services/storage/StorageManager';
import type { StorageProvider } from '$lib/services/storage/StorageProvider';
import { HistoryStack } from './history.svelte';
import {
	addFreeformVirtualHelixCmd,
	addInPlaneFreeformVirtualHelixCmd,
	deleteFreeformVirtualHelicesCmd,
	fillFreeformVirtualHelixCmd,
	moveLatticeVirtualHelicesCmd,
	moveFreeformVirtualHelicesCmd,
} from './virtualHelix';
import { LatticedDesignRegion } from '$lib/model/Part/DesignRegion';

class MockStorageProvider implements StorageProvider {
	async saveDocument(): Promise<boolean> {
		return true;
	}
	async loadDocument(): Promise<object | null> {
		return null;
	}
	async deleteDocument(): Promise<boolean> {
		return true;
	}
	async getDocumentList(): Promise<[]> {
		return [];
	}
	async saveContext(): Promise<boolean> {
		return true;
	}
	async loadContext(): Promise<object | null> {
		return null;
	}
	getProviderInfo() {
		return { name: 'Mock', type: 'memory' as const, description: 'Mock storage provider' };
	}
	async isAvailable(): Promise<boolean> {
		return true;
	}
}

function createHistory(doc: FoldnanoDocument) {
	const storage = new StorageManager('memory');
	storage.registerProvider('memory', new MockStorageProvider());
	return new HistoryStack(doc, storage);
}

function createFreeformPart() {
	const doc = new FoldnanoDocument('doc-1', 'Freeform command test');
	const part = doc.addNewPart('FREEFORM');
	const history = createHistory(doc);
	return { doc, part, history };
}

function createHoneycombPart() {
	const doc = new FoldnanoDocument('doc-1', 'Lattice command test');
	const part = doc.addNewPart('HONEYCOMB');
	const history = createHistory(doc);
	return { doc, part, history };
}

describe('freeform virtual helix commands', () => {
	it('creates an in-plane localFrame from a drawn line and fills both strand sets', () => {
		const { part, history } = createFreeformPart();
		const vh = addInPlaneFreeformVirtualHelixCmd(
			{ part, start: { x: 1, y: 2 }, end: { x: 4.4, y: 2 } },
			history
		);

		expect(vh).not.toBeNull();
		expect(vh!.localFrame!.origin).toEqual({ x: 1, y: 2, z: 0 });
		expect(vh!.localFrame!.axis.x).toBeCloseTo(1);
		expect(vh!.localFrame!.axis.y).toBeCloseTo(0);
		expect(vh!.localFrame!.axis.z).toBeCloseTo(0);
		expect(vh!.localFrame!.radial0).toEqual({ x: 0, y: 0, z: 1 });
		expect(vh!.strandSets[0].segmentIds.size).toBe(1);
		expect(vh!.strandSets[1].segmentIds.size).toBe(1);
		expect(part.oligos.size).toBe(2);

		for (const oligo of part.oligos) {
			expect(oligo.isScaffold).toBe(false);
		}
		const segments = Array.from(part.oligos).map((oligo) => Array.from(oligo.segments)[0]);
		const strand0Segment = segments.find((segment) => segment.inStrandIndex === 0);
		const strand1Segment = segments.find((segment) => segment.inStrandIndex === 1);
		expect(strand0Segment?.fivePrime.index).toBe(0);
		expect(strand0Segment?.threePrime.index).toBe(9);
		expect(strand1Segment?.fivePrime.index).toBe(9);
		expect(strand1Segment?.threePrime.index).toBe(0);
	});

	it('extends freeform capacity to the next step multiple before line fill', () => {
		const { part, history } = createFreeformPart();
		expect(part.maxBase).toBe(42);

		const vh = addInPlaneFreeformVirtualHelixCmd(
			{ part, start: { x: 0, y: 0 }, end: { x: 17, y: 0 } },
			history
		);

		expect(vh).not.toBeNull();
		expect(part.maxBase).toBe(63);
		expect(vh!.length).toBe(63);
		const segments = Array.from(part.oligos).map((oligo) => Array.from(oligo.segments)[0]);
		expect(segments).toHaveLength(2);
		expect(
			segments.map((segment) => Math.max(segment.fivePrime.index, segment.threePrime.index))
		).toEqual([50, 50]);
	});

	it('fills an existing perpendicular VH on both strand sets without duplicate overlap', () => {
		const { part, history } = createFreeformPart();
		addFreeformVirtualHelixCmd({ part, x: 0, y: 0 }, history);
		const vh = part.virtualHelices[0];

		fillFreeformVirtualHelixCmd({ part, vh }, history);
		fillFreeformVirtualHelixCmd({ part, vh }, history);

		expect(part.oligos.size).toBe(2);
		expect(vh.strandSets[0].segmentIds.size).toBe(1);
		expect(vh.strandSets[1].segmentIds.size).toBe(1);
		for (const oligo of part.oligos) {
			expect(oligo.isScaffold).toBe(false);
		}
	});

	it('fills both strand sets in opposite bp directions', () => {
		const { part, history } = createFreeformPart();
		const vh = addFreeformVh(part, [0, 0, 0]);

		fillFreeformVirtualHelixCmd({ part, vh, fillLengthBp: 8 }, history);

		expect(vh.strandSets[0].segmentIds.size).toBe(1);
		expect(vh.strandSets[1].segmentIds.size).toBe(1);
		const segments = Array.from(part.oligos).map((oligo) => Array.from(oligo.segments)[0]);
		const strand0Segment = segments.find((segment) => segment.inStrandIndex === 0);
		const strand1Segment = segments.find((segment) => segment.inStrandIndex === 1);
		expect(strand0Segment?.fivePrime.index).toBe(0);
		expect(strand0Segment?.threePrime.index).toBe(7);
		expect(strand1Segment?.fivePrime.index).toBe(7);
		expect(strand1Segment?.threePrime.index).toBe(0);
	});

	it('moves multiple freeform VHs in one undoable command', () => {
		const { part, history } = createFreeformPart();
		const vh0 = addFreeformVh(part, [0, 0, 0], [1, 0, 0]);
		const vh1 = addFreeformVh(part, [2, 3, 0], [0, 1, 0]);
		const from0 = { ...vh0.localFrame!, origin: { ...vh0.localFrame!.origin } };
		const from1 = { ...vh1.localFrame!, origin: { ...vh1.localFrame!.origin } };
		const to0 = { ...from0, origin: { x: 1, y: 1, z: 0 } };
		const to1 = { ...from1, origin: { x: 3, y: 4, z: 0 } };

		moveFreeformVirtualHelicesCmd(
			{
				moves: [
					{ vh: vh0, from: from0, to: to0 },
					{ vh: vh1, from: from1, to: to1 },
				],
			},
			history
		);

		expect(vh0.localFrame!.origin).toEqual(to0.origin);
		expect(vh1.localFrame!.origin).toEqual(to1.origin);
		expect(vh0.localFrame!.axis).toEqual(from0.axis);
		expect(vh1.localFrame!.axis).toEqual(from1.axis);

		history.undoOnce();
		expect(vh0.localFrame!.origin).toEqual(from0.origin);
		expect(vh1.localFrame!.origin).toEqual(from1.origin);

		history.redoOnce();
		expect(vh0.localFrame!.origin).toEqual(to0.origin);
		expect(vh1.localFrame!.origin).toEqual(to1.origin);
	});

	it('deletes selected empty freeform VHs and restores them with undo', () => {
		const { part, history } = createFreeformPart();
		addFreeformVh(part, [0, 0, 0]);
		const deletedVh = addFreeformVh(part, [2, 0, 0]);
		addFreeformVh(part, [4, 0, 0]);

		deleteFreeformVirtualHelicesCmd({ part, vhIndices: [deletedVh.index] }, history);

		expect(part.virtualHelices.map((vh) => vh.index)).toEqual([0, 2]);
		expect(part.virtualHelices.map((vh) => vh.listRow)).toEqual([0, 1]);

		history.undoOnce();
		expect(part.virtualHelices.map((vh) => vh.index)).toEqual([0, 1, 2]);

		history.redoOnce();
		expect(part.virtualHelices.map((vh) => vh.index)).toEqual([0, 2]);
	});

	it('deletes occupied freeform VHs and removes oligos that become empty', () => {
		const { part, history } = createFreeformPart();
		const vh = addInPlaneFreeformVirtualHelixCmd(
			{ part, start: { x: 0, y: 0 }, end: { x: 4, y: 0 } },
			history
		)!;
		expect(part.oligos.size).toBe(2);

		deleteFreeformVirtualHelicesCmd({ part, vhIndices: [vh.index] }, history);

		expect(part.virtualHelices).toHaveLength(0);
		expect(part.oligos.size).toBe(0);
		expect(part.segmentsLookup.size).toBe(0);

		history.undoOnce();
		expect(part.virtualHelices).toHaveLength(1);
		expect(part.oligos.size).toBe(2);
		expect(part.virtualHelices[0].strandSets[0].segmentIds.size).toBe(1);
		expect(part.virtualHelices[0].strandSets[1].segmentIds.size).toBe(1);
	});

	it('deletes connected selected-VH segments and preserves unselected segments as free-ended DNA', () => {
		const { part, history } = createFreeformPart();
		const vh0 = addFreeformVh(part, [0, 0, 0]);
		const vh1 = addFreeformVh(part, [2, 0, 0]);
		const left = part.createOligo(vh0, 0, 5);
		const right = part.createOligo(vh1, 6, 10);
		part.connectTwoOligos(left, right);
		expect(part.oligos.size).toBe(1);
		const connectedOligo = Array.from(part.oligos)[0];
		expect(connectedOligo.segments.size).toBe(2);

		deleteFreeformVirtualHelicesCmd({ part, vhIndices: [vh0.index] }, history);

		expect(part.virtualHelices.map((vh) => vh.index)).toEqual([vh1.index]);
		expect(part.oligos.size).toBe(1);
		const remainingOligo = Array.from(part.oligos)[0];
		expect(remainingOligo.segments.size).toBe(1);
		const remainingSegment = Array.from(remainingOligo.segments)[0];
		expect(remainingSegment.inVirtualHelix.index).toBe(vh1.index);
		expect(remainingSegment.fivePrime.connectedEnd).toBeNull();
		expect(remainingSegment.threePrime.connectedEnd).toBeNull();

		history.undoOnce();
		expect(part.virtualHelices.map((vh) => vh.index)).toEqual([vh0.index, vh1.index]);
		expect(part.oligos.size).toBe(1);
		expect(Array.from(part.oligos)[0].segments.size).toBe(2);

		history.redoOnce();
		expect(part.virtualHelices.map((vh) => vh.index)).toEqual([vh1.index]);
		expect(Array.from(part.oligos)[0].segments.size).toBe(1);
	});

	it('deletes both VHs of a connected pair and leaves no oligos', () => {
		const { part, history } = createFreeformPart();
		const vh0 = addFreeformVh(part, [0, 0, 0]);
		const vh1 = addFreeformVh(part, [2, 0, 0]);
		const left = part.createOligo(vh0, 0, 5);
		const right = part.createOligo(vh1, 6, 10);
		part.connectTwoOligos(left, right);
		expect(part.oligos.size).toBe(1);

		deleteFreeformVirtualHelicesCmd({ part, vhIndices: [vh0.index, vh1.index] }, history);

		expect(part.virtualHelices).toHaveLength(0);
		expect(part.oligos.size).toBe(0);
		expect(part.segmentsLookup.size).toBe(0);

		history.undoOnce();
		expect(part.virtualHelices).toHaveLength(2);
		expect(part.oligos.size).toBe(1);
		expect(Array.from(part.oligos)[0].segments.size).toBe(2);
	});

	it('returns null and creates no VH for a zero-length line', () => {
		const { part, history } = createFreeformPart();
		const vh = addInPlaneFreeformVirtualHelixCmd(
			{ part, start: { x: 1, y: 1 }, end: { x: 1, y: 1 } },
			history
		);
		expect(vh).toBeNull();
		expect(part.virtualHelices).toHaveLength(0);
	});
});

describe('lattice virtual helix commands', () => {
	it('moves a single lattice VH and supports undo/redo', () => {
		const { part, history } = createHoneycombPart();
		const region = part.getDefaultRegion() as LatticedDesignRegion;
		const vh = addLatticeVh(part, 0, 0);

		moveLatticeVirtualHelicesCmd(
			{
				part,
				region,
				vhIndices: [vh.index],
				fromTo: [{ vh, from: { col: 0, row: 0 }, to: { col: 1, row: 1 } }],
				bounds: { cols: 32, rows: 30 },
			},
			history
		);

		expect(vh.latticeCoords).toEqual({ col: 1, row: 1 });
		history.undoOnce();
		expect(vh.latticeCoords).toEqual({ col: 0, row: 0 });
		history.redoOnce();
		expect(vh.latticeCoords).toEqual({ col: 1, row: 1 });
	});

	it('moves multiple lattice VHs in one history entry', () => {
		const { part, history } = createHoneycombPart();
		const region = part.getDefaultRegion() as LatticedDesignRegion;
		const vh0 = addLatticeVh(part, 0, 0);
		const vh1 = addLatticeVh(part, 2, 0);

		moveLatticeVirtualHelicesCmd(
			{
				part,
				region,
				vhIndices: [vh0.index, vh1.index],
				fromTo: [
					{ vh: vh0, from: { col: 0, row: 0 }, to: { col: 1, row: 1 } },
					{ vh: vh1, from: { col: 2, row: 0 }, to: { col: 3, row: 1 } },
				],
				bounds: { cols: 32, rows: 30 },
			},
			history
		);

		expect(vh0.latticeCoords).toEqual({ col: 1, row: 1 });
		expect(vh1.latticeCoords).toEqual({ col: 3, row: 1 });
		history.undoOnce();
		expect(vh0.latticeCoords).toEqual({ col: 0, row: 0 });
		expect(vh1.latticeCoords).toEqual({ col: 2, row: 0 });
	});

	it('rejects parity-breaking moves', () => {
		const { part, history } = createHoneycombPart();
		const region = part.getDefaultRegion() as LatticedDesignRegion;
		const vh = addLatticeVh(part, 0, 0);

		expect(() =>
			moveLatticeVirtualHelicesCmd(
				{
					part,
					region,
					vhIndices: [vh.index],
					fromTo: [{ vh, from: { col: 0, row: 0 }, to: { col: 1, row: 0 } }],
					bounds: { cols: 32, rows: 30 },
				},
				history
			)
		).toThrow(/Invalid lattice move: PARITY/);
		expect(vh.latticeCoords).toEqual({ col: 0, row: 0 });
	});

	it('rejects occupied targets outside the moving set', () => {
		const { part, history } = createHoneycombPart();
		const region = part.getDefaultRegion() as LatticedDesignRegion;
		const vh0 = addLatticeVh(part, 0, 0);
		addLatticeVh(part, 1, 1);

		expect(() =>
			moveLatticeVirtualHelicesCmd(
				{
					part,
					region,
					vhIndices: [vh0.index],
					fromTo: [{ vh: vh0, from: { col: 0, row: 0 }, to: { col: 1, row: 1 } }],
					bounds: { cols: 32, rows: 30 },
				},
				history
			)
		).toThrow(/Invalid lattice move: OCCUPIED/);
		expect(vh0.latticeCoords).toEqual({ col: 0, row: 0 });
	});
});
