import fs from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import {
	MANIFEST_SCHEMA_VERSION,
	MANIFEST_V1_NESTED_FIELDS,
	manifestFieldsFor,
	PLUGIN_ID_PATTERN,
	PLUGIN_VERSION_PATTERN,
	validateManifest,
} from './manifestValidation';
import { networkEntryError } from './networkPolicy';
import { scriptLabManifest } from './scriptLabManifest';

// The published schema is the public manifest contract for plugin authors. Both it and
// validateManifest reject unknown fields, so this suite keeps their field lists, the shipped
// manifests and MANIFEST_SCHEMA_VERSION from drifting apart.

const schemaPath = (version: number) =>
	path.resolve(`static/schemas/fplugin-v${version}.schema.json`);
const SCHEMA_VERSIONS = Array.from({ length: MANIFEST_SCHEMA_VERSION }, (_, i) => i + 1);
const SHIPPED_MANIFESTS = [
	...fs
		.readdirSync(path.resolve('src/lib/plugin/core_plugins'))
		.filter((f) => f.endsWith('.fplugin.json'))
		.map((f) => path.join('src/lib/plugin/core_plugins', f)),
	'static/plugins/local_demo/fplugin.json',
];

interface JsonSchemaObject {
	properties: Record<string, unknown>;
}

type ManifestJsonSchema = JsonSchemaObject & {
	properties: { schemaVersion: { const: number } };
	$defs: {
		field: JsonSchemaObject & {
			properties: { options: { items: { oneOf: [unknown, JsonSchemaObject] } } };
		};
		sidePanel: JsonSchemaObject & {
			properties: { form: JsonSchemaObject; codeEditor: JsonSchemaObject };
		};
	};
};

// Every published version stays online for manifests that point their $schema at it.
const schemas = new Map(
	SCHEMA_VERSIONS.map((v) => [
		v,
		JSON.parse(fs.readFileSync(schemaPath(v), 'utf-8')) as ManifestJsonSchema,
	])
);
const ajv = new Ajv2020({ allErrors: true });
const validators = new Map([...schemas].map(([v, s]) => [v, ajv.compile(s)]));
const schema = schemas.get(MANIFEST_SCHEMA_VERSION)!;

/** Errors from the schema of the manifest's own schemaVersion (missing = 1). */
function schemaErrors(manifest: unknown): unknown[] {
	const version = (manifest as { schemaVersion?: number }).schemaVersion ?? 1;
	const validate = validators.get(version);
	if (!validate) return [`no published schema for version ${version}`];
	return validate(manifest) ? [] : (validate.errors ?? []);
}

const keys = (obj: JsonSchemaObject) => Object.keys(obj.properties).sort();

describe('fplugin JSON Schema', () => {
	it.each(SCHEMA_VERSIONS)('publishes fplugin-v%i.schema.json for that version', (v) => {
		expect(schemas.get(v)!.properties.schemaVersion.const).toBe(v);
	});

	it.each(SHIPPED_MANIFESTS)('accepts shipped manifest %s (and so does the app)', (file) => {
		const manifest: unknown = JSON.parse(fs.readFileSync(path.resolve(file), 'utf-8'));
		expect(schemaErrors(manifest)).toEqual([]);
		// Validated as the installer does for the manifest inside a zip, which may omit entrypointUrl.
		expect(() => validateManifest(manifest, { allowNoEntrypoint: true })).not.toThrow();
	});

	it('accepts a manifest without schemaVersion, like the app', () => {
		const { schemaVersion: _omit, ...unversioned } = scriptLabManifest;
		expect(schemaErrors(unversioned)).toEqual([]);
		expect(() => validateManifest(unversioned)).not.toThrow();
	});

	it('accepts the built-in Script Lab manifest', () => {
		expect(schemaErrors(scriptLabManifest)).toEqual([]);
	});

	it.each(SCHEMA_VERSIONS)('lists exactly the fields validateManifest allows at v%i', (v) => {
		const schema = schemas.get(v)!;
		expect(keys(schema)).toEqual([...manifestFieldsFor(v)].sort());
		const { field, sidePanel } = schema.$defs;
		expect(keys(field)).toEqual([...MANIFEST_V1_NESTED_FIELDS.field].sort());
		expect(keys(field.properties.options.items.oneOf[1])).toEqual(
			[...MANIFEST_V1_NESTED_FIELDS.selectOption].sort()
		);
		expect(keys(sidePanel)).toEqual([...MANIFEST_V1_NESTED_FIELDS.sidePanel].sort());
		expect(keys(sidePanel.properties.form)).toEqual(
			[...MANIFEST_V1_NESTED_FIELDS.sidePanelForm].sort()
		);
		expect(keys(sidePanel.properties.codeEditor)).toEqual(
			[...MANIFEST_V1_NESTED_FIELDS.sidePanelCodeEditor].sort()
		);
	});

	it('rejects unknown fields but allows x- extensions', () => {
		const base = { ...scriptLabManifest };
		expect(schemaErrors({ ...base, netwrok: [] })).not.toEqual([]);
		expect(schemaErrors({ ...base, 'x-homepage': 'https://example.org' })).toEqual([]);
	});

	// As found inside a plugin zip: `icon` needs a packaged plugin.
	const PACKAGED_V2 = {
		schemaVersion: 2,
		id: 'icon-demo',
		name: 'Icon Demo',
		version: '1.0.0',
		format: 'foldnano_json',
		applyStrategy: 'previewOnly',
	};

	it('accepts "icon" only at schemaVersion 2, like the app', () => {
		const v2 = { ...PACKAGED_V2, icon: 'icons/main.svg' };
		expect(schemaErrors(v2)).toEqual([]);
		expect(() => validateManifest(v2, { allowNoEntrypoint: true })).not.toThrow();
		const v1 = { ...v2, schemaVersion: 1 };
		expect(schemaErrors(v1)).not.toEqual([]);
		expect(() => validateManifest(v1, { allowNoEntrypoint: true })).toThrow(/schemaVersion/);
	});

	it.each(['../icon.svg', '/icon.svg', 'icon.png', '.hidden/icon.svg'])(
		'agrees with the app on icon path %j',
		(icon) => {
			const manifest = { ...PACKAGED_V2, icon };
			expect(schemaErrors(manifest)).not.toEqual([]);
			expect(() => validateManifest(manifest, { allowNoEntrypoint: true })).toThrow(/"icon"/);
		}
	);

	it('rejects a format/applyStrategy mismatch', () => {
		expect(schemaErrors({ ...scriptLabManifest, applyStrategy: 'replacePart' })).not.toEqual([]);
	});

	it.each([
		['api.example.org', true],
		['*.example.org', true],
		['localhost:8000', true],
		['*', true],
		['https://api.example.org', false],
		['API.example.org', false],
		["example.org 'unsafe-eval'", false],
	])('agrees with the app on network entry %j', (entry, allowed) => {
		const manifest = { ...scriptLabManifest, network: [entry] };
		expect(schemaErrors(manifest).length === 0).toBe(allowed);
		expect(networkEntryError(entry) === null).toBe(allowed);
	});

	it('uses the same id and version patterns as the app', () => {
		const props = schema.properties as unknown as Record<string, { pattern: string }>;
		expect(props.id.pattern).toBe(PLUGIN_ID_PATTERN.source);
		expect(props.version.pattern).toBe(PLUGIN_VERSION_PATTERN.source);
	});

	it('requires "*" to stand alone in network', () => {
		expect(schemaErrors({ ...scriptLabManifest, network: ['*', 'api.example.org'] })).not.toEqual(
			[]
		);
	});
});
