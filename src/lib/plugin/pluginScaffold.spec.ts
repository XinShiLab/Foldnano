import { describe, expect, it } from 'vitest';
import { validateManifest, VALID_STRATEGIES } from './manifestValidation';
import {
	buildNewManifest,
	loadApiStubs,
	parseList,
	starterPluginFiles,
	starterPluginPy,
	STRATEGIES_FOR_FORMAT,
	STUBS_DIR,
	suggestPluginId,
	type NewPluginFields,
	type ScaffoldFormat,
} from './pluginScaffold';

const fields = (overrides: Partial<NewPluginFields> = {}): NewPluginFields => ({
	id: 'my-tool',
	name: 'My Tool',
	version: '0.1.0',
	description: '',
	format: 'foldnano_mini',
	applyStrategy: 'replayMutationLog',
	requirements: [],
	network: [],
	...overrides,
});

describe('STRATEGIES_FOR_FORMAT', () => {
	it('lists exactly the strategies validation accepts for each format', () => {
		for (const format of Object.keys(STRATEGIES_FOR_FORMAT) as ScaffoldFormat[]) {
			for (const strategy of VALID_STRATEGIES) {
				const accepted = (() => {
					try {
						validateManifest(
							{
								schemaVersion: 2,
								id: 'x',
								name: 'x',
								version: '1.0.0',
								format,
								applyStrategy: strategy,
							},
							{ allowNoEntrypoint: true }
						);
						return true;
					} catch {
						return false;
					}
				})();
				expect(STRATEGIES_FOR_FORMAT[format].includes(strategy), `${format} + ${strategy}`).toBe(
					accepted
				);
			}
		}
	});
});

describe('buildNewManifest', () => {
	it('writes only the fields that are set, at the current schema version', () => {
		expect(
			buildNewManifest(fields(), { schemaUrl: 'https://x/schemas/fplugin-v2.schema.json' })
		).toEqual({
			$schema: 'https://x/schemas/fplugin-v2.schema.json',
			schemaVersion: 2,
			id: 'my-tool',
			name: 'My Tool',
			version: '0.1.0',
			format: 'foldnano_mini',
			applyStrategy: 'replayMutationLog',
		});
		const full = buildNewManifest(
			fields({
				description: ' Does things. ',
				requirements: ['numpy'],
				network: ['api.example.org'],
			})
		);
		expect(full.description).toBe('Does things.');
		expect(full.requirements).toEqual(['numpy']);
		expect(full.network).toEqual(['api.example.org']);
	});

	it('reports what is wrong', () => {
		expect(() => buildNewManifest(fields({ version: 'one' }))).toThrow(/version/);
		expect(() => buildNewManifest(fields({ id: '1abc' }))).toThrow(/id/);
	});
});

describe('suggestPluginId / parseList', () => {
	it('derives a valid id from the name', () => {
		expect(suggestPluginId('My Staple Tool!')).toBe('my-staple-tool');
		expect(suggestPluginId('3D export')).toBe('plugin-3d-export');
		expect(suggestPluginId('')).toBe('plugin');
	});

	it('splits on commas and whitespace', () => {
		expect(parseList(' numpy, scipy\n networkx ,,')).toEqual(['numpy', 'scipy', 'networkx']);
	});
});

describe('starterPluginPy', () => {
	it('returns the result the strategy expects', () => {
		const py = (format: ScaffoldFormat, applyStrategy: NewPluginFields['applyStrategy']) =>
			starterPluginPy(buildNewManifest(fields({ format, applyStrategy })));
		expect(py('foldnano_mini', 'replayMutationLog')).toContain('set_result_mutation_log');
		expect(py('foldnano_json', 'replacePart')).toContain('set_result_foldnano_json');
		expect(py('cadnano_json', 'replaceRegion')).toContain('set_result_cadnano_json');
		for (const format of Object.keys(STRATEGIES_FOR_FORMAT) as ScaffoldFormat[]) {
			const preview = py(format, 'previewOnly');
			expect(preview).toContain('def run(ctx: PluginContext) -> None:');
			expect(preview).not.toMatch(/set_result_(mutation_log|foldnano_json|cadnano_json)/);
		}
	});

	it('escapes quotes and backslashes in the docstring', () => {
		const py = starterPluginPy(
			buildNewManifest(
				fields({ name: 'Say "hi"', description: 'Reads C:\\Users\\Alice """notes"""' })
			)
		);
		expect(py.split('\n')[0]).toBe(
			String.raw`"""Say \"hi\": Reads C:\\Users\\Alice \"\"\"notes\"\"\""""`
		);
	});
});

describe('starterPluginFiles', () => {
	it('adds the API stubs under a dot-folder with a pyright config', async () => {
		const files = await starterPluginFiles(buildNewManifest(fields()), {
			pluginPy: true,
			stubs: true,
		});
		expect(Object.keys(files)).toContain(`${STUBS_DIR}/foldnano/plugin.pyi`);
		expect(Object.keys(files)).toContain(`${STUBS_DIR}/foldnano_mini/__init__.pyi`);
		expect(JSON.parse(files['pyrightconfig.json'])).toEqual({
			stubPath: STUBS_DIR,
			typeCheckingMode: 'standard',
			reportMissingModuleSource: 'none',
		});
		expect(Object.keys(await loadApiStubs()).length).toBeGreaterThan(5);
	});

	it('leaves plugin.py out when asked', async () => {
		const files = await starterPluginFiles(buildNewManifest(fields()), {
			pluginPy: false,
			stubs: false,
		});
		expect(Object.keys(files)).toEqual(['fplugin.json']);
	});
});
