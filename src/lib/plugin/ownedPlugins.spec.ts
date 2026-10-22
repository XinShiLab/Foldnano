import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import {
	AUTHORING_HINT_KEY,
	buildOwnedManifest,
	buildPluginZip,
	bumpPatchVersion,
	generateOwnedPluginId,
	isRestorableOwnedZip,
	ownedPluginZipFilename,
	readPluginPy,
} from './ownedPlugins';
import { classifyManifest, validateManifest } from './manifestValidation';
import { classifyEnv } from './envClassification';

const CODE = 'def run(ctx):\n    ctx.log("hi")\n';

describe('owned plugin packaging', () => {
	it('generates local.* ids that pass manifest id validation', () => {
		const id = generateOwnedPluginId();
		expect(id).toMatch(/^local\.[0-9a-z]{8}$/);
		expect(generateOwnedPluginId()).not.toBe(id);
	});

	it("builds a valid packaged manifest with Script Lab's run contract", () => {
		const manifest = buildOwnedManifest({
			id: 'local.abc12345',
			name: '  Staple Tidy ',
			description: ' ',
			requirements: ['numpy'],
		});
		expect(manifest).toMatchObject({
			name: 'Staple Tidy',
			version: '1.0.0',
			format: 'foldnano_mini',
			applyStrategy: 'replayMutationLog',
			requirements: ['numpy'],
			[AUTHORING_HINT_KEY]: { source: 'scriptLab' },
		});
		expect(manifest.description).toBeUndefined();
		expect(validateManifest(manifest, { allowNoEntrypoint: true })).toEqual(manifest);
		expect(classifyManifest(manifest)).toBe('packaged');
		expect(classifyEnv(manifest)).toBe('standard');
	});

	it('zips fplugin.json and plugin.py, and reads plugin.py back', () => {
		const manifest = buildOwnedManifest({ id: 'local.abc12345', name: 'X', requirements: [] });
		const zip = buildPluginZip(manifest, CODE);
		const files = unzipSync(zip);
		expect(Object.keys(files).sort()).toEqual(['fplugin.json', 'plugin.py']);
		expect(JSON.parse(strFromU8(files['fplugin.json']))).toEqual(manifest);
		expect(readPluginPy(zip)).toBe(CODE);
	});

	it('bumps only the patch number', () => {
		expect(bumpPatchVersion('1.0.0')).toBe('1.0.1');
		expect(bumpPatchVersion('2.3.9')).toBe('2.3.10');
		expect(() => bumpPatchVersion('1.0')).toThrow();
	});

	it('treats only hinted fplugin.json + plugin.py zips as restorable', () => {
		const manifest = buildOwnedManifest({ id: 'local.abc12345', name: 'X', requirements: [] });
		const files = ['fplugin.json', 'plugin.py'];
		expect(isRestorableOwnedZip(manifest, files)).toBe(true);
		expect(isRestorableOwnedZip(manifest, [...files, 'helper.py'])).toBe(false);
		const { [AUTHORING_HINT_KEY]: _hint, ...unhinted } = manifest;
		expect(isRestorableOwnedZip(unhinted, files)).toBe(false);
		expect(
			isRestorableOwnedZip(
				{ ...manifest, sidePanel: { type: 'codeEditor', codeEditor: { execution: 'input' } } },
				files
			)
		).toBe(false);
	});

	it('names the backup zip after the plugin and version', () => {
		const manifest = buildOwnedManifest({
			id: 'local.abc12345',
			name: 'Staple Tidy!',
			version: '1.0.2',
			requirements: [],
		});
		expect(ownedPluginZipFilename(manifest)).toBe('staple-tidy-1.0.2.zip');
	});
});
