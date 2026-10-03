import fs from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import { describe, it, expect } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import { CURRENT_FORMAT_VERSION } from '$lib/model/documentFormat';
import { addFreeformVh, addLatticeVh } from '$lib/model/test/testHelpers';

// The published schema is the public .fn.json contract (src/content/contributors/09-file-format.md).
// It rejects unknown fields, so a new field in any toJSON() fails here until the schema,
// the contract page and formatVersion are updated together.

const SCHEMA_DIR = path.resolve('static/schemas');
const FIXTURE_DIR = path.resolve('test_files/fixtures/document_format');

function readJson(file: string): unknown {
	return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function validatorFor(version: number) {
	const schema = readJson(path.join(SCHEMA_DIR, `foldnano-v${version}.schema.json`)) as object;
	return new Ajv2020({ allErrors: true }).compile(schema);
}

function expectValid(version: number, json: unknown): void {
	const validate = validatorFor(version);
	const ok = validate(json);
	expect(ok ? [] : validate.errors).toEqual([]);
}

/** A document that exercises every optional field toJSON() can write. */
function buildFullDocument(): FoldnanoDocument {
	const doc = new FoldnanoDocument(undefined, 'Schema coverage');

	const lattice = doc.addNewPart('HONEYCOMB');
	const vh0 = addLatticeVh(lattice, 0, 0);
	const vh1 = addLatticeVh(lattice, 1, 0);
	const original = lattice.createOligo(vh0, 0, 20, '#ff0000');
	const mirror = lattice.createOligo(vh1, 20, 0, '#00ff00');
	const scaffold = lattice.createOligo(vh1, 21, 41, '#0000ff');
	scaffold.isScaffold = true;
	scaffold.name = 'scaffold';
	original.fivePrime!.modification = 'Cy3';
	original.repeatGroupId = 'group-1';
	mirror.mirrorOf = {
		groupId: 'group-1',
		instanceId: 'instance-1',
		sourceOligoId: original.id,
		structure: 'opaque',
	};
	lattice.repeatGroups = [
		{ id: 'group-1', name: 'Repeat', instances: [{ id: 'instance-1', bpOffset: 21 }] },
	];
	lattice.customModifications = [{ name: 'Alexa 488', color: '#22c55e' }];
	lattice.overlayPlacements = [
		{
			id: 'overlay-1',
			sourceKey: '1ABC',
			transform: { position: { x: 1, y: 2, z: 3 }, quaternion: [0, 0, 0, 1] },
		},
	];

	const freeform = doc.addNewPart('FREEFORM');
	const fvh = addFreeformVh(freeform, [0, 0, 0], [0, 0, 1]);
	freeform.createOligo(fvh, 0, 10, '#888888');

	return doc;
}

describe('published .fn.json schema', () => {
	it.each(Array.from({ length: CURRENT_FORMAT_VERSION }, (_, i) => i + 1))(
		'publishes a schema for version %i',
		(version) => {
			expect(fs.existsSync(path.join(SCHEMA_DIR, `foldnano-v${version}.schema.json`))).toBe(true);
		}
	);

	it.each(Array.from({ length: CURRENT_FORMAT_VERSION }, (_, i) => i + 1))(
		'accepts the version %i fixture',
		(version) => {
			expectValid(version, readJson(path.join(FIXTURE_DIR, `v${version}.fn.json`)));
		}
	);

	it('accepts a file saved before versioning under the v1 schema', () => {
		expectValid(1, readJson(path.join(FIXTURE_DIR, 'v1-unversioned.fn.json')));
	});

	it('accepts everything the current app writes', () => {
		const json = JSON.parse(JSON.stringify(buildFullDocument().toJSON()));

		expect(json.parts[0].repeatGroups).toHaveLength(1);
		expect(json.parts[1].virtualHelices[0].localFrame).toBeDefined();
		expectValid(CURRENT_FORMAT_VERSION, json);
	});

	it('rejects a field the schema does not define', () => {
		const json = JSON.parse(JSON.stringify(buildFullDocument().toJSON()));
		json.parts[0].oligos[0].newField = true;

		expect(validatorFor(CURRENT_FORMAT_VERSION)(json)).toBe(false);
	});
});
