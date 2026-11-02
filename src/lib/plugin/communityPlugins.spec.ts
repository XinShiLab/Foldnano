import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { zipSync } from 'fflate';

import listing from './community/listing.json';
import { communityPlugins, validateCommunityEntry } from './communityPlugins';
import { corePlugins } from './corePlugins';
import type { CommunityPluginEntry } from './communityPlugins';
import { prepareCommunityInstall } from './PluginInstaller';

const MANIFEST = {
	schemaVersion: 2,
	id: 'community-test',
	name: 'Community Test',
	version: '1.0.0',
	format: 'foldnano_json',
	applyStrategy: 'previewOnly',
	repository: 'https://github.com/example/community-test',
};

// Native-realm bytes: jsdom's TextEncoder arrays fail fflate's instanceof check.
const bytes = (s: string) => new Uint8Array(Buffer.from(s));

function makeZip(manifest: object = MANIFEST): Uint8Array {
	return zipSync({
		'fplugin.json': bytes(JSON.stringify(manifest)),
		'plugin.py': bytes('def run(ctx):\n    pass\n'),
	});
}

function makeEntry(zip: Uint8Array, overrides: Partial<CommunityPluginEntry> = {}) {
	return validateCommunityEntry({
		id: MANIFEST.id,
		version: MANIFEST.version,
		name: MANIFEST.name,
		repository: MANIFEST.repository,
		zip: {
			url: 'https://plugins.example/community-test-1.0.0.zip',
			sha256: createHash('sha256').update(zip).digest('hex'),
		},
		listed: '2026-11-02',
		...overrides,
	});
}

const registry = { get: () => undefined, isPluginBusyForInstall: () => ({ busy: false }) };

function serve(zip: Uint8Array) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response(new Uint8Array(zip).buffer as ArrayBuffer, { status: 200 }))
	);
}

describe('community listing', () => {
	it('every shipped entry passes the app’s manifest and icon checks', () => {
		for (const entry of listing.plugins) expect(() => validateCommunityEntry(entry)).not.toThrow();
		expect(listing.source.commit).toMatch(/^[0-9a-f]{40}$/);
	});

	it('lists each id once', () => {
		const ids = listing.plugins.map((e) => e.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('leaves out plugins that still ship as core', () => {
		const coreIds = new Set(corePlugins.map((m) => m.id));
		expect(communityPlugins.map((e) => e.id)).toEqual(
			listing.plugins.map((e) => e.id).filter((id) => !coreIds.has(id))
		);
	});

	it('refuses entries without source, a pinned hash or a valid tag', () => {
		const zip = makeZip();
		expect(() => makeEntry(zip, { repository: undefined })).toThrow(/repository/);
		expect(() =>
			makeEntry(zip, { zip: { url: 'https://plugins.example/a.zip', sha256: 'abc' } })
		).toThrow(/sha256/);
		expect(() =>
			makeEntry(zip, { zip: { url: 'http://plugins.example/a.zip', sha256: '0'.repeat(64) } })
		).toThrow(/https/);
		expect(() => makeEntry(zip, { tags: ['two words'] })).toThrow();
	});
});

describe('prepareCommunityInstall', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('installs a zip whose hash matches, without a cross-origin entrypointUrl', async () => {
		const zip = makeZip();
		serve(zip);
		const result = await prepareCommunityInstall(makeEntry(zip), registry);
		expect(result.status).toBe('ready');
		if (result.status !== 'ready') return;
		expect(result.manifest.id).toBe('community-test');
		expect(result.manifest.entrypointUrl).toBeUndefined();
	});

	it('refuses a file that changed since it was listed', async () => {
		const entry = makeEntry(makeZip());
		serve(makeZip({ ...MANIFEST, description: 'changed' }));
		await expect(prepareCommunityInstall(entry, registry)).rejects.toThrow(
			/changed since it was listed/
		);
	});

	it('refuses a zip whose version differs from the listing', async () => {
		const zip = makeZip();
		serve(zip);
		await expect(
			prepareCommunityInstall(makeEntry(zip, { version: '1.0.1' }), registry)
		).rejects.toThrow(/listing says 1\.0\.1/);
	});

	it('refuses a zip whose id differs from the listing', async () => {
		const zip = makeZip({ ...MANIFEST, id: 'other-id' });
		serve(zip);
		await expect(prepareCommunityInstall(makeEntry(zip), registry)).rejects.toThrow(/id mismatch/);
	});

	it('reports a failed download', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(null, { status: 404, statusText: 'Not Found' }))
		);
		await expect(prepareCommunityInstall(makeEntry(makeZip()), registry)).rejects.toThrow(/404/);
	});
});
