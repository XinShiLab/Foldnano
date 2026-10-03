import { addLatticeVh, addFreeformVh } from '$lib/model/test/testHelpers';
/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect, beforeEach } from 'vitest';
import FoldnanoDocument, { partFromJSON } from '$lib/model/document.svelte';
import type { Part } from '$lib/model/Part';
import { Plane } from '$lib/model/Part/Plane.svelte';
import { DesignRegion } from '$lib/model/Part/DesignRegion';
import { HoneycombRegion } from '$lib/model/Part';
import type VirtualHelix from '$lib/model/VirtualHelix';
import { createStrandRowLayout } from '$lib/components/Editor/StrandView/strandRowLayout';

describe('FoldnanoDocument', () => {
	let testDoc: FoldnanoDocument;

	beforeEach(() => {
		testDoc = new FoldnanoDocument();
	});

	describe('Document creation', () => {
		it('should create document with default name', () => {
			expect(testDoc.name).toBe('Untitled Document');
		});

		it('should create document with custom name', () => {
			const doc = new FoldnanoDocument(undefined, 'My Design');
			expect(doc.name).toBe('My Design');
		});

		it('should create document with unique ID', () => {
			const doc1 = new FoldnanoDocument();
			const doc2 = new FoldnanoDocument();

			expect(doc1.id).toBeDefined();
			expect(doc2.id).toBeDefined();
			expect(doc1.id).not.toBe(doc2.id);
		});

		it('should accept custom ID', () => {
			const customId = 'custom-id-123';
			const doc = new FoldnanoDocument(customId);

			expect(doc.id).toBe(customId);
		});

		it('should start with empty parts array', () => {
			expect(testDoc.parts).toBeDefined();
			expect(testDoc.parts.length).toBe(0);
		});
	});

	describe('Part management', () => {
		it('should add HONEYCOMB part', () => {
			const part = testDoc.addNewPart('HONEYCOMB');

			expect(testDoc.parts.length).toBe(1);
			expect(testDoc.parts[0]).toBe(part);
			expect(part.getDefaultRegion().kind).toBe('HONEYCOMB');
		});

		it('should add SQUARE part', () => {
			const part = testDoc.addNewPart('SQUARE');

			expect(testDoc.parts.length).toBe(1);
			expect(testDoc.parts[0]).toBe(part);
			expect(part.getDefaultRegion().kind).toBe('SQUARE');
		});

		it('should add multiple parts', () => {
			const part1 = testDoc.addNewPart('HONEYCOMB');
			const part2 = testDoc.addNewPart('SQUARE');
			const part3 = testDoc.addNewPart('HONEYCOMB');

			expect(testDoc.parts.length).toBe(3);
			expect(testDoc.parts[0]).toBe(part1);
			expect(testDoc.parts[1]).toBe(part2);
			expect(testDoc.parts[2]).toBe(part3);
		});

		it('should create parts with unique names', () => {
			const part1 = testDoc.addNewPart('HONEYCOMB');
			const part2 = testDoc.addNewPart('HONEYCOMB');

			expect(part1.name).toBeDefined();
			expect(part2.name).toBeDefined();
			expect(part1.name).not.toBe(part2.name);
		});

		it('should create one default plane and one default region for each new part', () => {
			const honeycomb = testDoc.addNewPart('HONEYCOMB');
			const square = testDoc.addNewPart('SQUARE');
			const freeform = testDoc.addNewPart('FREEFORM');

			for (const part of [honeycomb, square, freeform]) {
				expect(part.planes).toHaveLength(1);
				expect(part.regions).toHaveLength(1);
				expect(part.planes[0]).toBeInstanceOf(Plane);
				expect(part.regions[0]).toBeInstanceOf(DesignRegion);
				expect(part.planes[0].origin).toEqual({ x: 0, y: 0, z: 0 });
				expect(part.planes[0].u).toEqual({ x: 1, y: 0, z: 0 });
				expect(part.planes[0].v).toEqual({ x: 0, y: 1, z: 0 });
				expect(part.planes[0].normal).toEqual({ x: 0, y: 0, z: 1 });
				expect(part.regions[0].kind).toBe(part.getDefaultRegion().kind);
				expect(part.regions[0].planeId).toBe(part.planes[0].id);
			}
		});
	});

	describe('JSON serialization', () => {
		it('should serialize empty document', () => {
			const json = testDoc.toJSON();

			expect(json.id).toBe(testDoc.id);
			expect(json.name).toBe(testDoc.name);
			expect(json.parts).toEqual([]);
		});

		it('should serialize document with parts', () => {
			testDoc.addNewPart('HONEYCOMB');
			testDoc.addNewPart('SQUARE');

			const json = testDoc.toJSON();

			expect(json.parts.length).toBe(2);
			expect(json.parts[0].regions[0].kind).toBe('HONEYCOMB');
			expect(json.parts[1].regions[0].kind).toBe('SQUARE');
		});

		it('should serialize document with virtual helices', () => {
			const part = testDoc.addNewPart('HONEYCOMB');
			const vh1 = addLatticeVh(part, 0, 0);
			const vh2 = addLatticeVh(part, 1, 1);

			const json = testDoc.toJSON();

			expect(json.parts[0].virtualHelices.length).toBe(2);
			expect(json.parts[0].planes).toHaveLength(1);
			expect(json.parts[0].regions).toHaveLength(1);
			expect(json.parts[0].virtualHelices[0].regionId).toBe(part.getDefaultRegion().id);
			expect(json.parts[0].virtualHelices[1].regionId).toBe(part.getDefaultRegion().id);
		});

		it('should serialize document with oligos', () => {
			const part = testDoc.addNewPart('HONEYCOMB');
			const vh = addLatticeVh(part, 0, 0);
			const oligo = part.createOligo(vh, 0, 10, '#ff0000');

			const json = testDoc.toJSON();

			expect(json.parts[0].oligos.length).toBe(1);
		});

		it('should preserve custom document name', () => {
			const customDoc = new FoldnanoDocument(undefined, 'Test Design');
			const json = customDoc.toJSON();

			expect(json.name).toBe('Test Design');
		});

		it('should preserve document ID', () => {
			const customId = 'test-id-456';
			const customDoc = new FoldnanoDocument(customId);
			const json = customDoc.toJSON();

			expect(json.id).toBe(customId);
		});
	});

	describe('JSON deserialization', () => {
		it('should deserialize empty document', () => {
			const json = testDoc.toJSON();
			const restored = FoldnanoDocument.fromJSON(json);

			expect(restored.id).toBe(testDoc.id);
			expect(restored.name).toBe(testDoc.name);
			expect(restored.parts.length).toBe(0);
		});

		it('should deserialize document with HONEYCOMB part', () => {
			testDoc.addNewPart('HONEYCOMB');
			const json = testDoc.toJSON();

			const restored = FoldnanoDocument.fromJSON(json);

			expect(restored.parts.length).toBe(1);
			expect(restored.parts[0].getDefaultRegion().kind).toBe('HONEYCOMB');
		});

		it('should deserialize document with SQUARE part', () => {
			testDoc.addNewPart('SQUARE');
			const json = testDoc.toJSON();

			const restored = FoldnanoDocument.fromJSON(json);

			expect(restored.parts.length).toBe(1);
			expect(restored.parts[0].getDefaultRegion().kind).toBe('SQUARE');
		});

		it('should deserialize document with multiple parts', () => {
			testDoc.addNewPart('HONEYCOMB');
			testDoc.addNewPart('SQUARE');
			testDoc.addNewPart('HONEYCOMB');

			const json = testDoc.toJSON();
			const restored = FoldnanoDocument.fromJSON(json);

			expect(restored.parts.length).toBe(3);
			expect(restored.parts[0].getDefaultRegion().kind).toBe('HONEYCOMB');
			expect(restored.parts[1].getDefaultRegion().kind).toBe('SQUARE');
			expect(restored.parts[2].getDefaultRegion().kind).toBe('HONEYCOMB');
		});

		it('should reject legacy part JSON missing planes/regions schema', () => {
			const part = testDoc.addNewPart('HONEYCOMB');
			addLatticeVh(part, 0, 0);
			const partJson = part.toJSON();
			const legacyJson = {
				...partJson,
				planes: undefined,
				regions: undefined,
			};

			expect(() => partFromJSON(legacyJson as unknown as typeof partJson)).toThrow(
				'Document predates region schema'
			);
		});

		it('should flatten visible rows from region order and vhOrder', () => {
			const part = testDoc.addNewPart('HONEYCOMB');
			const vh0 = addLatticeVh(part, 0, 0);
			const vh1 = addLatticeVh(part, 0, 1);
			const vh2 = addLatticeVh(part, 0, 2);

			const plane2 = new Plane('Plane 2');
			const region1 = new HoneycombRegion(
				'Region 1',
				part.planes[0].id,
				undefined,
				[vh1.id, vh0.id],
				part.step,
				part.subStepSize,
				part.maxBase
			).attachToPart(part);
			const region2 = new HoneycombRegion(
				'Region 2',
				plane2.id,
				undefined,
				[vh2.id],
				part.step,
				part.subStepSize,
				part.maxBase
			).attachToPart(part);

			vh0.regionId = region1.id;
			vh1.regionId = region1.id;
			vh2.regionId = region2.id;
			part.planes = [part.planes[0], plane2];
			part.regions = [region1, region2];
			part.virtualHelices = [...part.virtualHelices];

			expect(vh1.listRow).toBe(0);
			expect(vh0.listRow).toBe(1);
			expect(vh2.listRow).toBe(2);
		});

		it('should build strand rows with region headers and collapsed sections', () => {
			const part = testDoc.addNewPart('HONEYCOMB');
			const vh0 = addLatticeVh(part, 0, 0);
			const vh1 = addLatticeVh(part, 0, 1);
			const vh2 = addLatticeVh(part, 0, 2);

			const plane2 = new Plane('Plane 2');
			const region1 = new HoneycombRegion(
				'Region 1',
				part.planes[0].id,
				undefined,
				[vh1.id, vh0.id],
				part.step,
				part.subStepSize,
				part.maxBase
			).attachToPart(part);
			const region2 = new HoneycombRegion(
				'Region 2',
				plane2.id,
				undefined,
				[vh2.id],
				part.step,
				part.subStepSize,
				part.maxBase
			).attachToPart(part);

			vh0.regionId = region1.id;
			vh1.regionId = region1.id;
			vh2.regionId = region2.id;
			part.planes = [part.planes[0], plane2];
			part.regions = [region1, region2];
			part.virtualHelices = [...part.virtualHelices];

			const layout = createStrandRowLayout(part, [region2.id], 16, 12, 1);
			const rows = layout.getVisibleStrandRows();

			expect(rows.map((row) => row.kind)).toEqual(['REGION_HEADER', 'VH', 'VH', 'REGION_HEADER']);
			expect(rows[0]).toMatchObject({ regionId: region1.id, isCollapsed: false });
			expect(rows[1]).toMatchObject({ kind: 'VH', regionId: region1.id, vh: vh1 });
			expect(rows[2]).toMatchObject({ kind: 'VH', regionId: region1.id, vh: vh0 });
			expect(rows[3]).toMatchObject({ regionId: region2.id, isCollapsed: true });
			expect(layout.getDisplayRowForVh(vh2.id)).toBeNull();
		});

		it('should reorder VHs within a region without reordering topology storage', () => {
			const part = testDoc.addNewPart('HONEYCOMB');
			const vh0 = addLatticeVh(part, 0, 0);
			const vh1 = addLatticeVh(part, 0, 1);
			const vh2 = addLatticeVh(part, 0, 2);
			const storageOrderBefore = part.virtualHelices.map((vh) => vh.id);

			part.reorderVirtualHelixInRegion(vh2.index, 0);

			expect(part.getDefaultRegion().vhOrder).toEqual([vh2.id, vh0.id, vh1.id]);
			expect(part.virtualHelices.map((vh) => vh.id)).toEqual(storageOrderBefore);
			expect(vh2.listRow).toBe(0);
			expect(vh0.listRow).toBe(1);
			expect(vh1.listRow).toBe(2);
		});

		it('should persist region-local VH order through document round-trip', () => {
			const part = testDoc.addNewPart('HONEYCOMB');
			const vh0 = addLatticeVh(part, 0, 0);
			const vh1 = addLatticeVh(part, 0, 1);
			const vh2 = addLatticeVh(part, 0, 2);

			part.reorderVirtualHelixInRegion(vh2.index, 0);

			const json = testDoc.toJSON();
			expect(json.parts[0].regions?.[0]?.vhOrder).toEqual([vh2.id, vh0.id, vh1.id]);
			const restored = FoldnanoDocument.fromJSON(json);
			const restoredPart = restored.parts[0];
			const restoredVh0 = restoredPart.getVhByIndex(vh0.index)!;
			const restoredVh1 = restoredPart.getVhByIndex(vh1.index)!;
			const restoredVh2 = restoredPart.getVhByIndex(vh2.index)!;

			expect(restoredPart.getDefaultRegion().vhOrder).toEqual([
				restoredVh2.id,
				restoredVh0.id,
				restoredVh1.id,
			]);
			expect(restoredVh2.listRow).toBe(0);
			expect(restoredVh0.listRow).toBe(1);
			expect(restoredVh1.listRow).toBe(2);
		});

		it('should scrub deleted VH ids from vhOrder before save and reload', () => {
			const part = testDoc.addNewPart('HONEYCOMB');
			const vh0 = addLatticeVh(part, 0, 0);
			const vh1 = addLatticeVh(part, 0, 1);
			const vh2 = addLatticeVh(part, 0, 2);

			expect(part.getDefaultRegion().vhOrder).toEqual([vh0.id, vh1.id, vh2.id]);

			part.removeVirtualHelicesByIndex([vh1.index]);

			expect(part.getDefaultRegion().vhOrder).toEqual([vh0.id, vh2.id]);

			const json = testDoc.toJSON();
			expect(json.parts[0].regions[0].vhOrder).toEqual([vh0.id, vh2.id]);

			const restored = FoldnanoDocument.fromJSON(json);
			expect(restored.parts[0].getDefaultRegion().vhOrder).toEqual([vh0.id, vh2.id]);
		});

		it('should deserialize virtual helices', () => {
			const part = testDoc.addNewPart('HONEYCOMB');
			const vh1 = addLatticeVh(part, 0, 0);
			const vh2 = addLatticeVh(part, 1, 1);

			const json = testDoc.toJSON();
			const restored = FoldnanoDocument.fromJSON(json);

			expect(restored.parts[0].virtualHelices.length).toBe(2);
			expect(restored.parts[0].virtualHelices[0].latticeCoords).toEqual({ row: 0, col: 0 });
			expect(restored.parts[0].virtualHelices[1].latticeCoords).toEqual({ row: 1, col: 1 });
		});

		it('should deserialize oligos', () => {
			const part = testDoc.addNewPart('HONEYCOMB');
			const vh = addLatticeVh(part, 0, 0);
			const oligo = part.createOligo(vh, 0, 10, '#ff0000');

			const json = testDoc.toJSON();
			const restored = FoldnanoDocument.fromJSON(json);

			expect(restored.parts[0].oligos.size).toBe(1);
			expect(restored.parts[0].oligos.values().next().value?.color).toBe('#ff0000');
		});

		it('should preserve document name and ID', () => {
			const customDoc = new FoldnanoDocument('custom-id', 'Custom Name');
			const json = customDoc.toJSON();

			const restored = FoldnanoDocument.fromJSON(json);

			expect(restored.id).toBe('custom-id');
			expect(restored.name).toBe('Custom Name');
		});

		it('should handle complex document structure', () => {
			// Create a complex document
			const part1 = testDoc.addNewPart('HONEYCOMB');
			const vh1 = addLatticeVh(part1, 0, 0);
			const vh2 = addLatticeVh(part1, 1, 0);
			const oligo1 = part1.createOligo(vh1, 0, 10, '#ff0000');
			const oligo2 = part1.createOligo(vh2, 10, 0, '#00ff00');

			const part2 = testDoc.addNewPart('SQUARE');
			const vh3 = addLatticeVh(part2, 2, 2);
			const oligo3 = part2.createOligo(vh3, 5, 15, '#0000ff');

			const json = testDoc.toJSON();
			const restored = FoldnanoDocument.fromJSON(json);

			expect(restored.parts.length).toBe(2);
			expect(restored.parts[0].virtualHelices.length).toBe(2);
			expect(restored.parts[0].oligos.size).toBe(2);
			expect(restored.parts[1].virtualHelices.length).toBe(1);
			expect(restored.parts[1].oligos.size).toBe(1);
		});
	});

	describe('Roundtrip serialization', () => {
		it('should roundtrip empty document', () => {
			const json1 = testDoc.toJSON();
			const restored = FoldnanoDocument.fromJSON(json1);
			const json2 = restored.toJSON();

			expect(json2).toEqual(json1);
		});

		it('should roundtrip document with parts', () => {
			testDoc.addNewPart('HONEYCOMB');
			testDoc.addNewPart('SQUARE');

			const json1 = testDoc.toJSON();
			const restored = FoldnanoDocument.fromJSON(json1);
			const json2 = restored.toJSON();

			expect(json2.parts.length).toBe(json1.parts.length);
			expect(json2.parts[0].regions[0].kind).toBe(json1.parts[0].regions[0].kind);
			expect(json2.parts[1].regions[0].kind).toBe(json1.parts[1].regions[0].kind);
		});

		it('should roundtrip document with virtual helices', () => {
			const part = testDoc.addNewPart('HONEYCOMB');
			addLatticeVh(part, 0, 0);
			addLatticeVh(part, 1, 1);
			addLatticeVh(part, 2, 2);

			const json1 = testDoc.toJSON();
			const restored = FoldnanoDocument.fromJSON(json1);
			const json2 = restored.toJSON();

			expect(json2.parts[0].virtualHelices.length).toBe(3);
		});

		it('should roundtrip document with oligos and segments', () => {
			const part = testDoc.addNewPart('HONEYCOMB');
			const vh1 = addLatticeVh(part, 0, 0);
			const vh2 = addLatticeVh(part, 1, 0);

			const oligo1 = part.createOligo(vh1, 0, 10, '#ff0000');
			const oligo2 = part.createOligo(vh2, 10, 0, '#00ff00');

			const json1 = testDoc.toJSON();
			const restored = FoldnanoDocument.fromJSON(json1);
			const json2 = restored.toJSON();

			expect(json2.parts[0].oligos.length).toBe(2);
			expect(json2.parts[0].oligos[0].color).toBe('#ff0000');
			expect(json2.parts[0].oligos[1].color).toBe('#00ff00');
		});

		it('should roundtrip document with sequences', () => {
			const part = testDoc.addNewPart('HONEYCOMB');
			const vh = addLatticeVh(part, 0, 0);
			const oligo = part.createOligo(vh, 0, 10, '#ff0000');

			oligo.fillSequence('ACGTACGTACG'); // 11 bases for indices 0-10 inclusive

			const json1 = testDoc.toJSON();
			const restored = FoldnanoDocument.fromJSON(json1);

			const restoredOligo = restored.parts[0].oligos.values().next().value;
			expect(restoredOligo).toBeDefined();
			const restoredSegment = restoredOligo!.segments.values().next().value!;
			expect(restoredSegment.sequence).toContain('ACGTACGTACG');
		});

		it('should roundtrip document with crossovers', () => {
			const part = testDoc.addNewPart('HONEYCOMB');
			const vh1 = addLatticeVh(part, 0, 0);
			const vh2 = addLatticeVh(part, 1, 0);

			const oligo1 = part.createOligo(vh1, 0, 10, '#ff0000');
			const oligo2 = part.createOligo(vh2, 10, 0, '#00ff00');

			const segment1 = oligo1.segments.values().next().value!;
			const segment2 = oligo2.segments.values().next().value!;

			// Connect segments to create crossover
			segment1.threePrime.connectTo(segment2.fivePrime);

			const json1 = testDoc.toJSON();
			const restored = FoldnanoDocument.fromJSON(json1);

			// After restoration, there should be one merged oligo
			expect(restored.parts[0].oligos.size).toBeGreaterThanOrEqual(1);
		});
	});

	describe('Document restore method', () => {
		it('should restore document from snapshot', () => {
			const part = testDoc.addNewPart('HONEYCOMB');
			addLatticeVh(part, 0, 0);

			const snapshot = testDoc.toJSON();

			// Create a new document and restore
			const newDoc = new FoldnanoDocument();
			newDoc.restore(snapshot);

			expect(newDoc.parts.length).toBe(1);
			expect(newDoc.parts[0].virtualHelices.length).toBe(1);
		});

		it('should replace existing parts on restore', () => {
			// Initial state
			testDoc.addNewPart('HONEYCOMB');
			testDoc.addNewPart('SQUARE');

			const snapshot = testDoc.toJSON();

			// Add more parts
			testDoc.addNewPart('HONEYCOMB');

			// Restore should replace all parts
			testDoc.restore(snapshot);

			expect(testDoc.parts.length).toBe(2);
			expect(testDoc.parts[0].getDefaultRegion().kind).toBe('HONEYCOMB');
			expect(testDoc.parts[1].getDefaultRegion().kind).toBe('SQUARE');
		});

		it('should restore empty document', () => {
			const snapshot = testDoc.toJSON();

			testDoc.addNewPart('HONEYCOMB');
			testDoc.restore(snapshot);

			expect(testDoc.parts.length).toBe(0);
		});

		it('should restore complex document state', () => {
			const part = testDoc.addNewPart('HONEYCOMB');
			const vh = addLatticeVh(part, 0, 0);
			const oligo = part.createOligo(vh, 0, 10, '#ff0000');
			oligo.fillSequence('ACGTACGTACG');

			const snapshot = testDoc.toJSON();

			// Create new document and restore
			const newDoc = new FoldnanoDocument();
			newDoc.restore(snapshot);

			const restoredOligo = newDoc.parts[0].oligos.values().next().value;
			expect(restoredOligo).toBeDefined();
			const restoredSegment = restoredOligo!.segments.values().next().value!;

			expect(restoredSegment.sequence).toContain('ACGTACGTACG');
			expect(restoredOligo!.color).toBe('#ff0000');
		});
	});

	describe('FREEFORM part', () => {
		it('addNewPart FREEFORM returns Part with latticeType FREEFORM', () => {
			const part = testDoc.addNewPart('FREEFORM');
			expect(part.getDefaultRegion().kind).toBe('FREEFORM');
		});

		it('FREEFORM document round-trips via fromJSON', () => {
			const part = testDoc.addNewPart('FREEFORM');
			addFreeformVh(part, [1, 2, 3]);
			addFreeformVh(part, [4, 5, 6]);

			const json = testDoc.toJSON();
			const restored = FoldnanoDocument.fromJSON(json);

			expect(restored.parts[0].getDefaultRegion().kind).toBe('FREEFORM');
			expect(restored.parts[0].virtualHelices.length).toBe(2);
			expect(restored.parts[0].virtualHelices[0].localFrame?.origin).toEqual({ x: 1, y: 2, z: 3 });
			expect(restored.parts[0].virtualHelices[1].localFrame?.origin).toEqual({ x: 4, y: 5, z: 6 });
			expect(restored.parts[0].regions).toHaveLength(1);
			expect(restored.parts[0].regions[0].kind).toBe('FREEFORM');
		});

		it('partFromJSON with FREEFORM returns Part with latticeType FREEFORM', () => {
			const part = testDoc.addNewPart('FREEFORM');
			addFreeformVh(part, [0, 0, 0]);

			const partJson = testDoc.toJSON().parts[0];
			const restored = partFromJSON(partJson);

			expect(restored.getDefaultRegion().kind).toBe('FREEFORM');
			expect(restored.virtualHelices.length).toBe(1);
		});

		it('partFromJSON with FREEFORM preserves localFrame', () => {
			const part = testDoc.addNewPart('FREEFORM');
			addFreeformVh(part, [3, 7, 2], [0, 0, 1]);

			const partJson = testDoc.toJSON().parts[0];
			const restored = partFromJSON(partJson);

			expect(restored.virtualHelices[0].localFrame?.origin).toEqual({ x: 3, y: 7, z: 2 });
			expect(restored.virtualHelices[0].localFrame?.axis).toEqual({ x: 0, y: 0, z: 1 });
		});

		it('freeform VHs get sequential indices 0, 1, 2 with no latticeCoords', () => {
			const part = testDoc.addNewPart('FREEFORM');
			const vh0 = addFreeformVh(part, [0, 0, 0]);
			const vh1 = addFreeformVh(part, [1, 0, 0]);
			const vh2 = addFreeformVh(part, [2, 0, 0]);

			expect(vh0.index).toBe(0);
			expect(vh1.index).toBe(1);
			expect(vh2.index).toBe(2);
			expect(vh0.latticeCoords).toBeUndefined();
			expect(vh1.latticeCoords).toBeUndefined();
			expect(vh2.latticeCoords).toBeUndefined();
			expect(vh0.regionId).toBe(part.regions[0].id);
			expect(vh1.regionId).toBe(part.regions[0].id);
			expect(vh2.regionId).toBe(part.regions[0].id);
			expect(part.regions[0].vhOrder).toEqual([vh0.id, vh1.id, vh2.id]);
		});

		it('isEvenParity throws for a freeform VH', () => {
			const part = testDoc.addNewPart('FREEFORM');
			const vh = addFreeformVh(part, [0, 0, 0]);
			expect(() => vh.isEvenParity).toThrow();
		});

		it('latticed VH creation still assigns parity-correct indices', () => {
			const part = testDoc.addNewPart('HONEYCOMB');
			const evenVh = addLatticeVh(part, 0, 0); // row=0,col=0 → even
			const oddVh = addLatticeVh(part, 0, 1); // row=0,col=1 → odd

			expect(evenVh.index % 2).toBe(0);
			expect(oddVh.index % 2).toBe(1);
			expect(evenVh.latticeCoords).toEqual({ row: 0, col: 0 });
			expect(oddVh.latticeCoords).toEqual({ row: 1, col: 0 });
		});
	});

	describe('Error handling', () => {
		it('should throw error for unsupported lattice type in fromJSON', () => {
			const invalidJson = {
				id: 'test-id',
				name: 'Test',
				parts: [
					{
						latticeType: 'INVALID_TYPE',
						name: 'Invalid Part',
					} as never,
				],
			};

			expect(() => {
				FoldnanoDocument.fromJSON(invalidJson);
			}).toThrow('Document predates region schema');
		});

		it('should throw error for unsupported lattice type in addNewPart', () => {
			expect(() => {
				testDoc.addNewPart('INVALID_TYPE' as never);
			}).toThrow('Part type "INVALID_TYPE" not implemented');
		});
	});

	describe('Edge cases', () => {
		it('should handle document with many parts', () => {
			for (let i = 0; i < 10; i++) {
				testDoc.addNewPart(i % 2 === 0 ? 'HONEYCOMB' : 'SQUARE');
			}

			const json = testDoc.toJSON();
			const restored = FoldnanoDocument.fromJSON(json);

			expect(restored.parts.length).toBe(10);
		});

		it('should handle document with many virtual helices', () => {
			const part = testDoc.addNewPart('HONEYCOMB');

			for (let i = 0; i < 20; i++) {
				addLatticeVh(part, i, i);
			}

			const json = testDoc.toJSON();
			const restored = FoldnanoDocument.fromJSON(json);

			expect(restored.parts[0].virtualHelices.length).toBe(20);
		});

		it('should handle document with many oligos', () => {
			const part = testDoc.addNewPart('HONEYCOMB');
			const vh = addLatticeVh(part, 0, 0);

			for (let i = 0; i < 10; i++) {
				const start = i * 3;
				const end = start + 2;
				part.createOligo(vh, start, end, `#${i}${i}${i}${i}${i}${i}`);
			}

			const json = testDoc.toJSON();
			const restored = FoldnanoDocument.fromJSON(json);

			expect(restored.parts[0].oligos.size).toBe(10);
		});

		it('should preserve part properties after serialization', () => {
			const part = testDoc.addNewPart('HONEYCOMB');
			// maxBase is read-only, tested via increaseVhsLengthBy
			part.increaseVhsLengthBy(42); // 2 * 21, increases maxBase

			const json = testDoc.toJSON();
			const restored = FoldnanoDocument.fromJSON(json);

			expect(restored.parts[0].maxBase).toBe(part.maxBase);
		});

		it('should preserve VH properties after serialization', () => {
			const part = testDoc.addNewPart('HONEYCOMB');
			const vh = addLatticeVh(part, 5, 7);
			vh.length = 84;

			const json = testDoc.toJSON();
			const restored = FoldnanoDocument.fromJSON(json);

			const restoredVh = restored.parts[0].virtualHelices[0];
			expect(restoredVh.latticeCoords).toEqual({ col: 5, row: 7 });
			expect(restoredVh.length).toBe(84);
		});
	});

	describe('multi-region round-trip', () => {
		function buildTwoRegionPart(doc: FoldnanoDocument) {
			const part = doc.addNewPart('HONEYCOMB');
			const vh0 = addLatticeVh(part, 0, 0);
			const vh1 = addLatticeVh(part, 0, 1);
			const vh2 = addLatticeVh(part, 0, 2);

			const plane2 = new Plane('Plane 2');
			const region1 = new HoneycombRegion(
				'Region A',
				part.planes[0].id,
				undefined,
				[vh0.id, vh1.id],
				part.step,
				part.subStepSize,
				part.maxBase
			).attachToPart(part);
			const region2 = new HoneycombRegion(
				'Region B',
				plane2.id,
				undefined,
				[vh2.id],
				part.step,
				part.subStepSize,
				part.maxBase
			).attachToPart(part);

			vh0.regionId = region1.id;
			vh1.regionId = region1.id;
			vh2.regionId = region2.id;
			part.planes = [part.planes[0], plane2];
			part.regions = [region1, region2];
			part.virtualHelices = [...part.virtualHelices];

			return { part, vh0, vh1, vh2, region1, region2 };
		}

		it('toJSON/fromJSON preserves both regions, VH IDs, and vhOrder arrays', () => {
			const { vh0, vh1, vh2, region1, region2 } = buildTwoRegionPart(testDoc);

			const json = testDoc.toJSON();
			const restored = FoldnanoDocument.fromJSON(json);
			const rp = restored.parts[0];

			expect(rp.regions).toHaveLength(2);
			expect(rp.regions[0].id).toBe(region1.id);
			expect(rp.regions[1].id).toBe(region2.id);
			expect(rp.regions[0].vhOrder).toEqual([vh0.id, vh1.id]);
			expect(rp.regions[1].vhOrder).toEqual([vh2.id]);

			const rvh0 = rp.getVhById(vh0.id)!;
			const rvh1 = rp.getVhById(vh1.id)!;
			const rvh2 = rp.getVhById(vh2.id)!;
			expect(rvh0.regionId).toBe(region1.id);
			expect(rvh1.regionId).toBe(region1.id);
			expect(rvh2.regionId).toBe(region2.id);
			expect(rvh0.listRow).toBe(0);
			expect(rvh1.listRow).toBe(1);
			expect(rvh2.listRow).toBe(2);

			expect(() => rp.rebuildRspCaches()).not.toThrow();
		});

		it('moving a VH between regions updates getRegionForVh and preserves RSP cache', () => {
			const { part, vh2, region1, region2 } = buildTwoRegionPart(testDoc);
			const oligo = part.createOligo(vh2, 0, 10, '#0000ff');
			const segment = oligo.segments.values().next().value!;

			// Move vh2 from region2 to region1.
			vh2.regionId = region1.id;
			region2.vhOrder = region2.vhOrder.filter((id) => id !== vh2.id);
			region1.vhOrder = [...region1.vhOrder, vh2.id];
			part.virtualHelices = [...part.virtualHelices];

			expect(part.getRegionForVh(vh2)).toBe(region1);
			expect(region1.vhOrder).toContain(vh2.id);
			expect(region2.vhOrder).not.toContain(vh2.id);

			// RSP cache should still resolve the oligo on vh2.
			const result = part.getEntitiesAtVh(vh2.id, segment.inStrandIndex, 5);
			expect(result?.segment?.id).toBe(segment.id);
		});

		it('removing a region after migrating its VHs leaves the document consistent', () => {
			const { part, vh0, vh1, vh2, region1 } = buildTwoRegionPart(testDoc);

			// Migrate vh2 to region1 before removing region2.
			vh2.regionId = region1.id;
			region1.vhOrder = [...region1.vhOrder, vh2.id];
			part.planes = [part.planes[0]];
			part.regions = [region1];
			part.virtualHelices = [...part.virtualHelices];

			expect(part.regions).toHaveLength(1);
			expect(part.getRegionForVh(vh0)).toBe(region1);
			expect(part.getRegionForVh(vh1)).toBe(region1);
			expect(part.getRegionForVh(vh2)).toBe(region1);
			expect(vh0.listRow).toBe(0);
			expect(vh1.listRow).toBe(1);
			expect(vh2.listRow).toBe(2);
		});
	});
});
