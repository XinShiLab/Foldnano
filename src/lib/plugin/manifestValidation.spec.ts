import { describe, expect, it } from 'vitest';

import {
	MANIFEST_SCHEMA_VERSION,
	SUPPORTED_REQUIREMENTS_ALLOWLIST,
	classifyManifest,
	validateManifest,
} from './manifestValidation';

function manifest(overrides: Record<string, unknown>) {
	return {
		schemaVersion: 1,
		id: 'plugin-id',
		name: 'Plugin',
		version: '1.0.0',
		entrypointUrl: '/plugins/demo/demo.zip',
		...overrides,
	};
}

/** Runtime-code (Script-Lab-like) manifest: placeholder inline entrypoint. */
function runtimeCodeManifest(overrides: Record<string, unknown> = {}) {
	return manifest({
		format: 'foldnano_mini',
		applyStrategy: 'replayMutationLog',
		entrypoint: 'def run(ctx): raise RuntimeError("placeholder")',
		entrypointUrl: undefined,
		sidePanel: {
			type: 'codeEditor',
			icon: 'code',
			codeEditor: { filename: 'script.py', execution: 'entrypoint' },
		},
		...overrides,
	});
}

describe('validateManifest', () => {
	describe('id and version format', () => {
		const base = (overrides: Record<string, unknown>) =>
			manifest({ format: 'foldnano_json', applyStrategy: 'previewOnly', ...overrides });

		it.each(['my-plugin', 'pyOrigamiBreak', 'gc_colorizer', 'org.example.tool', 'a'])(
			'accepts id %j',
			(id) => {
				expect(validateManifest(base({ id })).id).toBe(id);
			}
		);

		it.each(['a/b', 'my plugin', '-leading', '1st', 'é', 'x'.repeat(65)])('rejects id %j', (id) => {
			expect(() => validateManifest(base({ id }))).toThrow(/"id" .* must start with a letter/);
		});

		it.each(['1.0.0', '0.1.2', '2.0.0-beta.1', '1.0.0+build.5'])(
			'accepts version %j',
			(version) => {
				expect(validateManifest(base({ version })).version).toBe(version);
			}
		);

		it.each(['latest', '1.0', 'v1.0.0', '01.0.0', '1.0.0 '])('rejects version %j', (version) => {
			expect(() => validateManifest(base({ version }))).toThrow(/semantic version/);
		});
	});

	describe('schemaVersion', () => {
		const base = () => manifest({ format: 'foldnano_json', applyStrategy: 'previewOnly' });

		it('reads a manifest without schemaVersion as version 1', () => {
			const { schemaVersion: _omit, ...unversioned } = base();
			expect(validateManifest(unversioned).schemaVersion).toBe(1);
		});

		it('still rejects unknown fields in an unversioned manifest', () => {
			const { schemaVersion: _omit, ...unversioned } = base();
			expect(() => validateManifest({ ...unversioned, network2: [] })).toThrow(
				/Unknown field "network2"/
			);
		});

		it('refuses a manifest newer than this app, before looking at its fields', () => {
			expect(() => validateManifest({ ...base(), schemaVersion: 2, permissions: {} })).toThrow(
				/needs a newer version of Foldnano/
			);
		});

		it.each(['1', 0, 1.5])('rejects schemaVersion %j', (schemaVersion) => {
			expect(() => validateManifest({ ...base(), schemaVersion })).toThrow(/positive integer/);
		});

		it('matches the published version constant', () => {
			expect(MANIFEST_SCHEMA_VERSION).toBe(1);
		});
	});

	describe('unknown fields', () => {
		const base = () => manifest({ format: 'foldnano_json', applyStrategy: 'previewOnly' });
		const field = { id: 'n', label: 'N', type: 'number', default: 1 };

		it('rejects a misspelled top-level field', () => {
			expect(() => validateManifest({ ...base(), netwrok: ['api.example.org'] })).toThrow(
				/Unknown field "netwrok" in the manifest/
			);
		});

		it('allows x- extensions and a $schema reference at the top level', () => {
			expect(() =>
				validateManifest({
					...base(),
					$schema: 'https://example.org/fplugin-v1.schema.json',
					'x-homepage': 'https://example.org',
				})
			).not.toThrow();
		});

		it('rejects unknown fields in parameters and select options', () => {
			expect(() => validateManifest({ ...base(), parameters: [{ ...field, hint: 'x' }] })).toThrow(
				/Unknown field "hint" in parameter "n"/
			);
			expect(() =>
				validateManifest({
					...base(),
					parameters: [
						{
							id: 's',
							label: 'S',
							type: 'select',
							default: 'a',
							options: [{ value: 'a', label: 'A', colour: 'red' }],
						},
					],
				})
			).toThrow(/Unknown field "colour" in an option of parameter "s"/);
		});

		it('rejects unknown fields in the side panel', () => {
			expect(() =>
				validateManifest({
					...base(),
					sidePanel: { type: 'form', form: { fields: [field] }, width: 3 },
				})
			).toThrow(/Unknown field "width" in "sidePanel"/);
			expect(() =>
				validateManifest({
					...base(),
					sidePanel: { type: 'form', form: { fields: [field], layout: 'grid' } },
				})
			).toThrow(/"sidePanel.form"/);
			expect(() =>
				validateManifest(
					runtimeCodeManifest({
						sidePanel: {
							type: 'codeEditor',
							codeEditor: { execution: 'entrypoint', theme: 'dark' },
						},
					})
				)
			).toThrow(/"sidePanel.codeEditor"/);
		});

		it('does not allow x- extensions below the top level', () => {
			expect(() =>
				validateManifest({ ...base(), parameters: [{ ...field, 'x-note': 'n' }] })
			).toThrow(/Unknown field "x-note"/);
		});
	});

	it('accepts cadnano_json region replacement manifests', () => {
		expect(() =>
			validateManifest(
				manifest({
					format: 'cadnano_json',
					applyStrategy: 'replaceRegionKeepAnnotationsWhereMatched',
				})
			)
		).not.toThrow();
	});

	it('rejects cadnano_json whole-part replacement manifests', () => {
		expect(() =>
			validateManifest(
				manifest({
					format: 'cadnano_json',
					applyStrategy: 'replacePartKeepAnnotationsWhereMatched',
				})
			)
		).toThrow(/format "cadnano_json" requires applyStrategy to be replaceRegion/);
	});

	it('accepts foldnano_json whole-part replacement manifests', () => {
		expect(() =>
			validateManifest(
				manifest({
					format: 'foldnano_json',
					applyStrategy: 'replacePart',
				})
			)
		).not.toThrow();
	});

	it('rejects foldnano_json region replacement manifests', () => {
		expect(() =>
			validateManifest(
				manifest({
					format: 'foldnano_json',
					applyStrategy: 'replaceRegion',
				})
			)
		).toThrow(/format "foldnano_json" requires applyStrategy to be replacePart/);
	});

	it('accepts form side panel manifests', () => {
		expect(() =>
			validateManifest(
				manifest({
					format: 'foldnano_json',
					applyStrategy: 'previewOnly',
					sidePanel: {
						type: 'form',
						icon: 'form',
						form: {
							fields: [
								{
									id: 'label',
									label: 'Label',
									type: 'string',
									default: 'demo',
								},
							],
						},
					},
				})
			)
		).not.toThrow();
	});

	it('accepts codeEditor side panel manifests', () => {
		expect(() =>
			validateManifest(
				manifest({
					format: 'foldnano_json',
					applyStrategy: 'previewOnly',
					sidePanel: {
						type: 'codeEditor',
						icon: 'code',
						codeEditor: {
							filename: 'script.py',
						},
					},
				})
			)
		).not.toThrow();
	});

	it('accepts codeEditor execution mode "entrypoint"', () => {
		expect(() => validateManifest(runtimeCodeManifest())).not.toThrow();
	});

	it('rejects invalid codeEditor execution modes', () => {
		expect(() =>
			validateManifest(
				manifest({
					format: 'foldnano_json',
					applyStrategy: 'previewOnly',
					sidePanel: {
						type: 'codeEditor',
						codeEditor: {
							execution: 'module',
						},
					},
				})
			)
		).toThrow(/"sidePanel.codeEditor.execution" must be input or entrypoint/);
	});

	it('rejects invalid side panel icons', () => {
		expect(() =>
			validateManifest(
				manifest({
					format: 'foldnano_json',
					applyStrategy: 'previewOnly',
					sidePanel: {
						type: 'codeEditor',
						icon: 'custom-svg',
					},
				})
			)
		).toThrow(/"sidePanel.icon" must be/);
	});

	it('rejects form side panel manifests without fields', () => {
		expect(() =>
			validateManifest(
				manifest({
					format: 'foldnano_json',
					applyStrategy: 'previewOnly',
					sidePanel: {
						type: 'form',
						form: {
							fields: [],
						},
					},
				})
			)
		).toThrow(/"sidePanel.form.fields" must be a non-empty array/);
	});

	describe('requirement locations (same origin only)', () => {
		const withReqs = (requirements: string[]) =>
			manifest({ format: 'foldnano_json', applyStrategy: 'previewOnly', requirements });

		it('accepts package names and bundled wheel filenames', () => {
			expect(() =>
				validateManifest(withReqs(['numpy', 'scipy>=1.10', 'pkg-1.0-py3-none-any.whl']))
			).not.toThrow();
		});

		it('accepts wheels served by Foldnano itself', () => {
			expect(() =>
				validateManifest(
					withReqs([
						'/plugins/cadnano_mini/v0.1.0/pkg-1.0-py3-none-any.whl',
						`${location.origin}/wheels/pkg-1.0-py3-none-any.whl`,
					])
				)
			).not.toThrow();
		});

		it.each([
			'https://example.com/evil.whl',
			'http://localhost.attacker.example/pkg.whl',
			'//evil.example/pkg.whl',
		])('rejects wheel %j from another origin', (req) => {
			expect(() => validateManifest(withReqs([req]))).toThrow(/is not served by Foldnano/);
		});

		it.each(['/local/pkg', 'https://example.com/pkg.tar.gz'])(
			'rejects non-wheel location %j',
			(req) => {
				expect(() => validateManifest(withReqs([req]))).toThrow(/looks like a path or URL/);
			}
		);

		it('rejects PEP 508 direct references, even to a .whl', () => {
			expect(() => validateManifest(withReqs(['pkg @ https://example.com/pkg.whl']))).toThrow(
				/direct URL reference/
			);
		});

		it('rejects surrounding whitespace, which fetch() would strip', () => {
			expect(() => validateManifest(withReqs([' https://evil.example/pkg.whl']))).toThrow(
				/leading or trailing spaces/
			);
		});

		it('SUPPORTED_REQUIREMENTS_ALLOWLIST is null by default (permissive mode)', () => {
			expect(SUPPORTED_REQUIREMENTS_ALLOWLIST).toBeNull();
		});
	});

	describe('network', () => {
		const withNetwork = (network: unknown) =>
			manifest({ format: 'foldnano_json', applyStrategy: 'previewOnly', network });

		it('accepts declared hosts and "*"', () => {
			expect(() => validateManifest(withNetwork(['api.example.org']))).not.toThrow();
			expect(() => validateManifest(withNetwork(['*']))).not.toThrow();
		});

		it('rejects entries that are not bare host names', () => {
			expect(() => validateManifest(withNetwork(['https://api.example.org']))).toThrow(
				/"network" entry/
			);
			expect(() => validateManifest(withNetwork('api.example.org'))).toThrow(/array/);
		});
	});

	it('rejects manifests that mix popup parameters and form side panel fields', () => {
		expect(() =>
			validateManifest(
				manifest({
					format: 'foldnano_json',
					applyStrategy: 'previewOnly',
					parameters: [
						{
							id: 'threshold',
							label: 'Threshold',
							type: 'number',
							default: 1,
						},
					],
					sidePanel: {
						type: 'form',
						form: {
							fields: [
								{
									id: 'label',
									label: 'Label',
									type: 'string',
								},
							],
						},
					},
				})
			)
		).toThrow(/cannot declare both "parameters" and "sidePanel.form.fields"/);
	});

	describe('entrypointUrl (same origin only)', () => {
		const withUrl = (entrypointUrl: string) =>
			manifest({ format: 'foldnano_json', applyStrategy: 'previewOnly', entrypointUrl });

		it('accepts a zip served by Foldnano, relative or absolute', () => {
			expect(() => validateManifest(withUrl('/plugins/demo/demo.zip'))).not.toThrow();
			expect(() => validateManifest(withUrl(`${location.origin}/plugin.zip`))).not.toThrow();
		});

		it.each([
			'https://evil.example.com/malicious.zip',
			'https://fold.xinshilab.com/plugin.zip',
			'http://localhost:9000/plugin.zip',
			'//evil.example/plugin.zip',
			' https://evil.example/plugin.zip',
		])('rejects %j and points to Import zip', (url) => {
			expect(() => validateManifest(withUrl(url))).toThrow(/is not served by Foldnano.*Import zip/);
		});
	});

	describe('unified zip packaging', () => {
		it('rejects manifests that set both entrypoint and entrypointUrl', () => {
			expect(() =>
				validateManifest(
					manifest({
						format: 'foldnano_json',
						applyStrategy: 'previewOnly',
						entrypoint: 'def run(ctx): pass',
						entrypointUrl: '/plugins/demo/demo.zip',
					})
				)
			).toThrow(/cannot set both "entrypoint" and "entrypointUrl"/);
		});

		it('rejects inline entrypoint on plugins without codeEditor execution "entrypoint"', () => {
			expect(() =>
				validateManifest(
					manifest({
						format: 'cadnano_json',
						applyStrategy: 'previewOnly',
						entrypoint: 'def run(ctx): pass',
						entrypointUrl: undefined,
					})
				)
			).toThrow(/Inline "entrypoint" is only supported/);
		});

		it('rejects raw .py entrypointUrls', () => {
			expect(() =>
				validateManifest(
					manifest({
						format: 'cadnano_json',
						applyStrategy: 'previewOnly',
						entrypointUrl: '/plugins/demo/plugin.py',
					})
				)
			).toThrow(/must point to a plugin \.zip bundle/);
		});

		it('recognises a zip entrypointUrl with a query string', () => {
			expect(() =>
				validateManifest(
					manifest({
						format: 'cadnano_json',
						applyStrategy: 'previewOnly',
						entrypointUrl: '/plugins/demo/demo.zip?v=2',
					})
				)
			).not.toThrow();
		});

		it('rejects entrypointUrl on runtime-code (execution "entrypoint") plugins', () => {
			expect(() =>
				validateManifest(
					runtimeCodeManifest({
						entrypoint: undefined,
						entrypointUrl: '/plugins/demo/demo.zip',
					})
				)
			).toThrow(/execute the editor buffer/);
		});

		it('allows the inner zip manifest to omit entrypointUrl (allowNoEntrypoint)', () => {
			expect(() =>
				validateManifest(
					manifest({
						format: 'cadnano_json',
						applyStrategy: 'previewOnly',
						entrypointUrl: undefined,
					}),
					{ allowNoEntrypoint: true }
				)
			).not.toThrow();
		});
	});

	describe('classifyManifest', () => {
		it('classifies zip-URL manifests as packaged', () => {
			expect(classifyManifest({ entrypointUrl: '/plugins/demo/demo.zip' })).toBe('packaged');
			expect(classifyManifest({ entrypointUrl: '/plugins/demo/demo.zip?v=2' })).toBe('packaged');
			expect(classifyManifest({})).toBe('packaged'); // stored local install
		});

		it('classifies Script-Lab-like manifests as runtime-code', () => {
			expect(
				classifyManifest({
					entrypoint: 'def run(ctx): pass',
					sidePanel: { codeEditor: { execution: 'entrypoint' } },
				})
			).toBe('runtime-code');
		});

		it('classifies pre-unification shapes as legacy', () => {
			expect(classifyManifest({ entrypoint: 'def run(ctx): pass' })).toBe('legacy');
			expect(classifyManifest({ entrypointUrl: '/plugins/demo/plugin.py' })).toBe('legacy');
			expect(
				classifyManifest({
					entrypointUrl: '/plugins/demo/demo.zip',
					sidePanel: { codeEditor: { execution: 'entrypoint' } },
				})
			).toBe('legacy');
		});
	});

	describe('parameter field constraints (#10 + #11)', () => {
		function withParams(fields: Record<string, unknown>[]) {
			return manifest({
				format: 'foldnano_json',
				applyStrategy: 'previewOnly',
				parameters: fields,
			});
		}

		it('rejects min > max', () => {
			expect(() =>
				validateManifest(withParams([{ id: 'n', label: 'N', type: 'number', min: 10, max: 5 }]))
			).toThrow(/has min > max/);
		});

		it('rejects non-finite min, max, and step', () => {
			expect(() =>
				validateManifest(withParams([{ id: 'n', label: 'N', type: 'number', min: NaN }]))
			).toThrow(/min must be a finite number/);
			expect(() =>
				validateManifest(withParams([{ id: 'n', label: 'N', type: 'number', max: Infinity }]))
			).toThrow(/max must be a finite number/);
			expect(() =>
				validateManifest(withParams([{ id: 'n', label: 'N', type: 'number', step: NaN }]))
			).toThrow(/step must be a finite number/);
		});

		it('rejects non-positive step', () => {
			expect(() =>
				validateManifest(withParams([{ id: 'n', label: 'N', type: 'number', step: 0 }]))
			).toThrow(/step must be greater than 0/);
			expect(() =>
				validateManifest(withParams([{ id: 'n', label: 'N', type: 'number', step: -1 }]))
			).toThrow(/step must be greater than 0/);
		});

		it('accepts negative and fractional min/max/step', () => {
			expect(() =>
				validateManifest(
					withParams([{ id: 'n', label: 'N', type: 'number', min: -10.5, max: 20.75, step: 0.25 }])
				)
			).not.toThrow();
		});

		it('rejects NaN and both infinities as a numeric default', () => {
			expect(() =>
				validateManifest(withParams([{ id: 'n', label: 'N', type: 'number', default: NaN }]))
			).toThrow(/default must be a finite number/);
			expect(() =>
				validateManifest(withParams([{ id: 'n', label: 'N', type: 'number', default: Infinity }]))
			).toThrow(/default must be a finite number/);
			expect(() =>
				validateManifest(withParams([{ id: 'n', label: 'N', type: 'number', default: -Infinity }]))
			).toThrow(/default must be a finite number/);
		});

		it('rejects a type-wrong default for every field type, without coercing it', () => {
			expect(() =>
				validateManifest(withParams([{ id: 'n', label: 'N', type: 'number', default: '5' }]))
			).toThrow(/default must be a finite number/);
			expect(() =>
				validateManifest(withParams([{ id: 's', label: 'S', type: 'string', default: 5 }]))
			).toThrow(/default must be a string/);
			expect(() =>
				validateManifest(withParams([{ id: 'b', label: 'B', type: 'boolean', default: 'true' }]))
			).toThrow(/default must be a boolean/);
			expect(() =>
				validateManifest(
					withParams([{ id: 'sel', label: 'Sel', type: 'select', options: ['a', 'b'], default: 1 }])
				)
			).toThrow(/default must be a string/);
		});

		it('rejects a numeric default outside min/max or misaligned to step; accepts one that satisfies all three', () => {
			expect(() =>
				validateManifest(
					withParams([{ id: 'n', label: 'N', type: 'number', min: 0, max: 10, default: -1 }])
				)
			).toThrow(/default -1 is below min 0/);
			expect(() =>
				validateManifest(
					withParams([{ id: 'n', label: 'N', type: 'number', min: 0, max: 10, default: 11 }])
				)
			).toThrow(/default 11 is above max 10/);
			expect(() =>
				validateManifest(
					withParams([
						{ id: 'n', label: 'N', type: 'number', min: 0, max: 10, step: 2, default: 3 },
					])
				)
			).toThrow(/default 3 must be in increments of 2 from 0/);
			expect(() =>
				validateManifest(
					withParams([
						{ id: 'n', label: 'N', type: 'number', min: 0, max: 10, step: 2, default: 4 },
					])
				)
			).not.toThrow();
		});

		it('reports a misaligned numeric default with an increments-of wording', () => {
			expect(() =>
				validateManifest(
					withParams([
						{ id: 'amount', label: 'Amount', type: 'number', min: 0, step: 2, default: 3 },
					])
				)
			).toThrow('Parameter "amount" default 3 must be in increments of 2 from 0');
		});

		it('normalizes select options for both bare-string and {value, label} forms', () => {
			expect(() =>
				validateManifest(
					withParams([
						{
							id: 'sel',
							label: 'Sel',
							type: 'select',
							options: ['a', { value: 'b', label: 'B' }],
							default: 'b',
						},
					])
				)
			).not.toThrow();
		});

		it('rejects a malformed select option element', () => {
			expect(() =>
				validateManifest(withParams([{ id: 'sel', label: 'Sel', type: 'select', options: [42] }]))
			).toThrow(/non-empty string value/);
			expect(() =>
				validateManifest(
					withParams([{ id: 'sel', label: 'Sel', type: 'select', options: [{ label: 'A' }] }])
				)
			).toThrow(/non-empty string value/);
			expect(() =>
				validateManifest(
					withParams([{ id: 'sel', label: 'Sel', type: 'select', options: [{ value: 'a' }] }])
				)
			).toThrow(/non-empty string label/);
			expect(() =>
				validateManifest(
					withParams([
						{
							id: 'sel',
							label: 'Sel',
							type: 'select',
							options: [{ value: 'a', label: '' }],
						},
					])
				)
			).toThrow(/non-empty string label/);
			expect(() =>
				validateManifest(
					withParams([
						{ id: 'sel', label: 'Sel', type: 'select', options: [{ value: '', label: 'A' }] },
					])
				)
			).toThrow(/non-empty string value/);
		});

		it('rejects duplicate select option values in bare-string, object, and mixed forms', () => {
			expect(() =>
				validateManifest(
					withParams([{ id: 'sel', label: 'Sel', type: 'select', options: ['a', 'a'] }])
				)
			).toThrow(/duplicate select option value "a"/);
			expect(() =>
				validateManifest(
					withParams([
						{
							id: 'sel',
							label: 'Sel',
							type: 'select',
							options: [
								{ value: 'a', label: 'A' },
								{ value: 'a', label: 'A again' },
							],
						},
					])
				)
			).toThrow(/duplicate select option value "a"/);
			expect(() =>
				validateManifest(
					withParams([
						{
							id: 'sel',
							label: 'Sel',
							type: 'select',
							options: ['a', { value: 'a', label: 'A again' }],
						},
					])
				)
			).toThrow(/duplicate select option value "a"/);
		});

		it('rejects a select default not present in the normalized option values', () => {
			expect(() =>
				validateManifest(
					withParams([
						{ id: 'sel', label: 'Sel', type: 'select', options: ['a', 'b'], default: 'c' },
					])
				)
			).toThrow(/default "c" is not in options/);
		});
	});
});
