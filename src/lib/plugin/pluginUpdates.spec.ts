import { describe, expect, it } from 'vitest';

import { communityPlugins } from './communityPlugins';
import { hubPlugins } from './corePlugins';
import { availableUpdate, compareVersions, findHubListing, listingVersion } from './pluginUpdates';
import type { PluginManifest, PythonPlugin } from './types';

type UpdateCandidate = Pick<PythonPlugin, 'origin' | 'authoring' | 'manifest'>;

function installed(
	manifest: PluginManifest,
	version: string,
	overrides: Partial<UpdateCandidate> = {}
): UpdateCandidate {
	return { origin: 'user', authoring: null, manifest: { ...manifest, version }, ...overrides };
}

describe('compareVersions', () => {
	it.each([
		['1.0.0', '1.0.1'],
		['1.0.9', '1.0.10'],
		['1.9.0', '1.10.0'],
		['1.0.0', '2.0.0'],
		['1.0.0-alpha', '1.0.0'],
		['1.0.0-alpha', '1.0.0-alpha.1'],
		['1.0.0-alpha.1', '1.0.0-alpha.beta'],
		['1.0.0-beta.2', '1.0.0-beta.11'],
		['1.0.0-rc.1', '1.0.0'],
	])('%s is older than %s', (older, newer) => {
		expect(compareVersions(older, newer)).toBeLessThan(0);
		expect(compareVersions(newer, older)).toBeGreaterThan(0);
	});

	it('ignores build metadata', () => {
		expect(compareVersions('1.0.0+build.1', '1.0.0+build.2')).toBe(0);
	});
});

describe('availableUpdate', () => {
	const core = hubPlugins[0];

	it('offers the listing when it is newer than the installed copy', () => {
		const ref = availableUpdate(installed(core, '0.0.1'));
		expect(ref?.kind).toBe('core');
		expect(ref && listingVersion(ref)).toBe(core.version);
	});

	it('offers nothing for the same or a newer installed version', () => {
		expect(availableUpdate(installed(core, core.version))).toBeNull();
		expect(availableUpdate(installed(core, '999.0.0'))).toBeNull();
	});

	it('offers nothing for plugins made here, linked folders or unlisted ids', () => {
		expect(
			availableUpdate(installed(core, '0.0.1', { authoring: { source: 'scriptLab' } }))
		).toBeNull();
		expect(availableUpdate(installed(core, '0.0.1', { origin: 'linked' }))).toBeNull();
		expect(availableUpdate(installed({ ...core, id: 'not-listed' }, '0.0.1'))).toBeNull();
	});

	it('finds community listings too', () => {
		const entry = communityPlugins[0];
		if (!entry) return;
		expect(findHubListing(entry.id)?.kind).toBe('community');
	});
});
