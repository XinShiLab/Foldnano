import { describe, expect, it } from 'vitest';
import { parseDesignRaw, type FileMeta } from './index';
import { STANDALONE_MANIFEST_MESSAGE } from './fpluginParser';

const meta = (name: string, secondaryExtension?: string): FileMeta => ({
	name,
	extension: 'json',
	secondaryExtension,
	size: 1,
	type: 'application/json',
});

const manifest = {
	schemaVersion: 1,
	id: 'my-plugin',
	name: 'My Plugin',
	version: '1.0.0',
	format: 'cadnano_json',
	applyStrategy: 'previewOnly',
	entrypointUrl: '/plugins/my_plugin/my_plugin.zip',
};

describe('fpluginParser', () => {
	it('refuses a bare manifest and points to Import zip', () => {
		expect(() => parseDesignRaw(manifest, meta('my.fplugin.json', 'fplugin'))).toThrow(
			STANDALONE_MANIFEST_MESSAGE
		);
		expect(STANDALONE_MANIFEST_MESSAGE).toMatch(/Import zip/);
	});

	it('recognizes a manifest by shape even without the .fplugin extension', () => {
		expect(() => parseDesignRaw(manifest, meta('plugin.json'))).toThrow(
			STANDALONE_MANIFEST_MESSAGE
		);
	});
});
