import { communityPlugins, type CommunityPluginEntry } from './communityPlugins';
import { hubPlugins } from './corePlugins';
import {
	prepareCommunityInstall,
	preparePointerInstall,
	type PreparedInstall,
} from './PluginInstaller';
import type { PluginRegistry } from './PluginRegistry.svelte';
import type { PluginManifest, PythonPlugin } from './types';

/** Where the Hub lists a plugin: a core pointer manifest or a community listing entry. */
export type HubListingRef =
	{ kind: 'core'; manifest: PluginManifest } | { kind: 'community'; entry: CommunityPluginEntry };

export function findHubListing(id: string): HubListingRef | null {
	const manifest = hubPlugins.find((m) => m.id === id);
	if (manifest) return { kind: 'core', manifest };
	const entry = communityPlugins.find((e) => e.id === id);
	return entry ? { kind: 'community', entry } : null;
}

export function listingVersion(ref: HubListingRef): string {
	return ref.kind === 'core' ? ref.manifest.version : ref.entry.version;
}

function compareIdentifiers(a: string, b: string): number {
	const numA = /^\d+$/.test(a);
	const numB = /^\d+$/.test(b);
	if (numA && numB) return Number(a) - Number(b);
	if (numA !== numB) return numA ? -1 : 1;
	return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Semver precedence (semver.org § 11): negative when `a` is older than `b`. Build metadata is
 * ignored; a pre-release sorts before its release. Inputs are validated manifest versions.
 */
export function compareVersions(a: string, b: string): number {
	const [coreA, preA] = a.split('+')[0].split(/-(.*)/s);
	const [coreB, preB] = b.split('+')[0].split(/-(.*)/s);
	const partsA = coreA.split('.').map(Number);
	const partsB = coreB.split('.').map(Number);
	for (let i = 0; i < 3; i++) {
		if (partsA[i] !== partsB[i]) return partsA[i] - partsB[i];
	}
	if (!preA || !preB) return preA ? -1 : preB ? 1 : 0;
	const idsA = preA.split('.');
	const idsB = preB.split('.');
	for (let i = 0; i < Math.min(idsA.length, idsB.length); i++) {
		const c = compareIdentifiers(idsA[i], idsB[i]);
		if (c !== 0) return c;
	}
	return idsA.length - idsB.length;
}

/**
 * The listing to update an installed plugin from, when the Hub lists a newer version. Only
 * installed packages qualify: not built-ins, linked dev folders, or plugins made here (whose
 * versions are the user's own, even if the id matches a listing).
 */
export function availableUpdate(
	plugin: Pick<PythonPlugin, 'origin' | 'authoring' | 'manifest'>
): HubListingRef | null {
	if (plugin.origin !== 'user' || plugin.authoring) return null;
	const ref = findHubListing(plugin.manifest.id);
	if (!ref) return null;
	return compareVersions(listingVersion(ref), plugin.manifest.version) > 0 ? ref : null;
}

export function prepareListingInstall(
	ref: HubListingRef,
	registry: Pick<PluginRegistry, 'get' | 'isPluginBusyForInstall'>
): Promise<PreparedInstall> {
	return ref.kind === 'core'
		? preparePointerInstall(ref.manifest, registry)
		: prepareCommunityInstall(ref.entry, registry);
}
