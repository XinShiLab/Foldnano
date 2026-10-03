import fs from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import {
	MANIFEST_SCHEMA_VERSION,
	MANIFEST_V1_FIELDS,
	MANIFEST_V1_NESTED_FIELDS,
	PLUGIN_ID_PATTERN,
	PLUGIN_VERSION_PATTERN,
	validateManifest,
} from './manifestValidation';
import { networkEntryError } from './networkPolicy';
import { scriptLabManifest } from './scriptLabManifest';

// The published schema is the public manifest contract for plugin authors. Both it and
// validateManifest reject unknown fields, so this suite keeps their field lists, the shipped
// manifests and MANIFEST_SCHEMA_VERSION from drifting apart.

const SCHEMA_PATH = path.resolve(`static/schemas/fplugin-v${MANIFEST_SCHEMA_VERSION}.schema.json`);
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

const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf-8')) as JsonSchemaObject & {
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
const validate = new Ajv2020({ allErrors: true }).compile(schema);

function schemaErrors(manifest: unknown): unknown[] {
	return validate(manifest) ? [] : (validate.errors ?? []);
}

const keys = (obj: JsonSchemaObject) => Object.keys(obj.properties).sort();

describe('fplugin JSON Schema', () => {
	it('describes the current manifest schema version', () => {
		expect(schema.properties.schemaVersion.const).toBe(MANIFEST_SCHEMA_VERSION);
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

	it('lists exactly the fields validateManifest allows', () => {
		expect(keys(schema)).toEqual([...MANIFEST_V1_FIELDS].sort());
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
