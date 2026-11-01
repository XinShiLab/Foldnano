import { describe, expect, it } from 'vitest';
import { splitRegionCmd, setRegionReferenceGeometryCmd } from '$lib/commands/regions';
import { createTestHistory } from '$lib/commands/test/undoRoundTrip';
import { checkFoldnanoPartJsonShape } from '$lib/model/checks/shape/foldnanoJsonShape';
import FoldnanoDocument from '$lib/model/document.svelte';
import { Part } from '$lib/model/Part';
import {
	DesignRegion,
	FreeformRegion,
	LatticedDesignRegion,
	WireframeRegion,
	type ReferenceGeometry,
} from '$lib/model/Part/DesignRegion';
import { addFreeformVh } from '$lib/model/test/testHelpers';

const GEOMETRY: ReferenceGeometry = {
	unit: 'nm',
	mesh: {
		vertices: [
			[0, 0, 0],
			[12.5, 0, 0],
			[6.25, 10.8, 0],
		],
		faces: [[0, 1, 2]],
		edges: [],
	},
};

function wireframeDoc() {
	const doc = new FoldnanoDocument('doc', 'wireframe');
	const part = doc.addNewPart('WIREFRAME');
	return { doc, part, region: part.getDefaultRegion() as WireframeRegion };
}

/** A wireframe part as JSON with `referenceGeometry` swapped in for the shape check. */
function partJsonWith(geometry: unknown, kind = 'WIREFRAME') {
	const json = JSON.parse(JSON.stringify(Part.forType('WIREFRAME', 'p').toJSON()));
	json.regions[0].kind = kind;
	json.regions[0].referenceGeometry = geometry;
	return json;
}

describe('WireframeRegion', () => {
	it('is a freeform region with its own kind', () => {
		const { region } = wireframeDoc();

		expect(region).toBeInstanceOf(WireframeRegion);
		expect(region).toBeInstanceOf(FreeformRegion);
		expect(region.kind).toBe('WIREFRAME');
		expect(region.supportsLatticeGrid).toBe(false);
	});

	it('uses freeform placement but turns off plane-view axis edits', () => {
		const { region } = wireframeDoc();
		const freeform = new FoldnanoDocument('doc', 'f').addNewPart('FREEFORM').getDefaultRegion();
		const lattice = new FoldnanoDocument('doc', 'l').addNewPart('HONEYCOMB').getDefaultRegion();

		expect(region.supportsFreeformPlacement).toBe(true);
		expect(region.supportsPlaneAxisEditing).toBe(false);
		expect(freeform.supportsFreeformPlacement).toBe(true);
		expect(freeform.supportsPlaneAxisEditing).toBe(true);
		expect(lattice.supportsFreeformPlacement).toBe(false);
		expect(lattice.supportsPlaneAxisEditing).toBe(false);
	});

	it('is the only kind that carries a reference mesh', () => {
		const { region } = wireframeDoc();
		const freeform = new FoldnanoDocument('doc', 'f').addNewPart('FREEFORM').getDefaultRegion();

		expect(region.supportsReferenceGeometry).toBe(true);
		expect(region.referenceMesh).toBeUndefined();
		region.referenceGeometry = GEOMETRY;
		expect(region.referenceMesh).toBe(GEOMETRY.mesh);
		expect(freeform.supportsReferenceGeometry).toBe(false);
		expect(freeform.referenceMesh).toBeUndefined();
	});

	it('is not a lattice region, so cadnano import and export stay off', () => {
		expect(wireframeDoc().region).not.toBeInstanceOf(LatticedDesignRegion);
	});

	it('places helices through their local frame, like freeform', () => {
		const { part } = wireframeDoc();

		const vh = addFreeformVh(part, [1, 2, 3], [1, 0, 0]);
		const frame = part.getVirtualHelixFrame(vh);

		expect(frame.origin).toEqual({ x: 1, y: 2, z: 3 });
		expect(frame.axis).toEqual({ x: 1, y: 0, z: 0 });
	});

	it('leaves referenceGeometry out of the JSON when unset', () => {
		expect(wireframeDoc().region.toJSON()).not.toHaveProperty('referenceGeometry');
	});

	it('round-trips kind and referenceGeometry through JSON', () => {
		const { region } = wireframeDoc();
		region.referenceGeometry = GEOMETRY;

		const restored = DesignRegion.fromJSON(JSON.parse(JSON.stringify(region.toJSON())));

		expect(restored).toBeInstanceOf(WireframeRegion);
		expect((restored as WireframeRegion).referenceGeometry).toEqual(GEOMETRY);
	});
});

describe('setRegionReferenceGeometryCmd', () => {
	it('sets, undoes and redoes the geometry', () => {
		const { doc, part, region } = wireframeDoc();
		const history = createTestHistory(doc);

		setRegionReferenceGeometryCmd(history, part, region.id, GEOMETRY);
		const current = () => (part.getRegionById(region.id) as WireframeRegion).referenceGeometry;
		expect(current()).toEqual(GEOMETRY);

		history.undoOnce();
		expect(current()).toBeUndefined();

		history.redoOnce();
		expect(current()).toEqual(GEOMETRY);
	});

	it('refuses a region that is not a wireframe', () => {
		const doc = new FoldnanoDocument('doc', 'freeform');
		const part = doc.addNewPart('FREEFORM');

		expect(() =>
			setRegionReferenceGeometryCmd(
				createTestHistory(doc),
				part,
				part.getDefaultRegion().id,
				GEOMETRY
			)
		).toThrow(/not a wireframe region/);
	});
});

describe('copying a wireframe region', () => {
	it('keeps the geometry on both sides of a split', () => {
		const { doc, part, region } = wireframeDoc();
		region.referenceGeometry = GEOMETRY;
		const vh0 = addFreeformVh(part, [0, 0, 0]);
		addFreeformVh(part, [5, 0, 0]);

		splitRegionCmd(createTestHistory(doc), part, region.id, vh0.id);

		expect(part.regions).toHaveLength(2);
		for (const r of part.regions) {
			expect(r).toBeInstanceOf(WireframeRegion);
			expect((r as WireframeRegion).referenceGeometry).toEqual(GEOMETRY);
		}
	});

	it('survives a whole-part JSON round trip', () => {
		const { part, region } = wireframeDoc();
		region.referenceGeometry = GEOMETRY;

		const restored = Part.fromJSON(JSON.parse(JSON.stringify(part.toJSON())));

		expect((restored.getRegionById(region.id) as WireframeRegion).referenceGeometry).toEqual(
			GEOMETRY
		);
	});
});

describe('referenceGeometry shape check', () => {
	it('accepts a valid mesh, a region without a mesh and a region without geometry', () => {
		expect(() => checkFoldnanoPartJsonShape(partJsonWith(GEOMETRY))).not.toThrow();
		expect(() => checkFoldnanoPartJsonShape(partJsonWith({ unit: 'nm' }))).not.toThrow();
		expect(() => checkFoldnanoPartJsonShape(partJsonWith(undefined))).not.toThrow();
	});

	const mesh = GEOMETRY.mesh!;
	it.each([
		['another unit', { ...GEOMETRY, unit: 'bp' }],
		['a mesh missing an array', { unit: 'nm', mesh: { vertices: [], faces: [] } }],
		['a non-finite vertex', { unit: 'nm', mesh: { ...mesh, vertices: [[0, 0, null]] } }],
		['a face with too few vertices', { unit: 'nm', mesh: { ...mesh, faces: [[0, 1]] } }],
		['a face index out of range', { unit: 'nm', mesh: { ...mesh, faces: [[0, 1, 3]] } }],
		['an edge index out of range', { unit: 'nm', mesh: { ...mesh, edges: [[0, 9]] } }],
	])('rejects %s', (_label, geometry) => {
		expect(() => checkFoldnanoPartJsonShape(partJsonWith(geometry))).toThrow(/referenceGeometry/);
	});

	it('rejects geometry on a region that is not a wireframe', () => {
		expect(() => checkFoldnanoPartJsonShape(partJsonWith(GEOMETRY, 'FREEFORM'))).toThrow(
			/only allowed on a wireframe region/
		);
	});
});
