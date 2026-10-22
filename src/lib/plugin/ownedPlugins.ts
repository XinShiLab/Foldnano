/**
 * Packaging for owned plugins: plugins the user makes from Script Lab and keeps editing in
 * the app. Pure helpers; persistence is `PluginRegistry`, runs are `PluginCoordinator`.
 * See docs/script-lab.md § Owned plugins.
 */

import { strFromU8, strToU8, zipSync } from 'fflate';
import { MANIFEST_SCHEMA_VERSION, PLUGIN_ID_PATTERN } from './manifestValidation';
import { unzipCapped } from './sizeLimits';
import { requirementSources } from './envClassification';
import { OWNED_PLUGIN_ICON_FILE } from './pluginIcon';
import type { PluginManifest } from './types';
import type { IndexedDbPluginFilesRecord } from '$lib/services/storage/indexedDbTypes';

/** Generated ids live under this prefix, so they never clash with distributed plugins. */
export const OWNED_PLUGIN_ID_PREFIX = 'local.';

/**
 * Manifest extension carried by exported zips. Only a hint that triggers "Restore as
 * editable?" on import; ownership itself is the local `authoring` record field.
 */
export const AUTHORING_HINT_KEY = 'x-foldnano-authoring';

export const OWNED_PLUGIN_FIRST_VERSION = '1.0.0';

const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const ID_RANDOM_LENGTH = 8;

/** Files an owned plugin's zip holds; anything else rules out Restore as editable. */
const OWNED_ZIP_FILES = new Set(['fplugin.json', 'plugin.py', OWNED_PLUGIN_ICON_FILE]);

export function generateOwnedPluginId(
	randomValues: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes)
): string {
	const bytes = randomValues(new Uint8Array(ID_RANDOM_LENGTH));
	const suffix = Array.from(bytes, (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join('');
	const id = `${OWNED_PLUGIN_ID_PREFIX}${suffix}`;
	if (!PLUGIN_ID_PATTERN.test(id)) throw new Error(`Generated plugin id "${id}" is invalid.`);
	return id;
}

export interface OwnedManifestFields {
	id: string;
	name: string;
	description?: string;
	version?: string;
	requirements: readonly string[];
	/** Bundle an icon as icon.svg (`buildPluginZip` writes the file). */
	hasIcon?: boolean;
}

/** Script Lab's run contract (`foldnano_mini` + `replayMutationLog`) as a packaged manifest. */
export function buildOwnedManifest(fields: OwnedManifestFields): PluginManifest {
	const description = fields.description?.trim();
	return {
		schemaVersion: MANIFEST_SCHEMA_VERSION,
		id: fields.id,
		name: fields.name.trim(),
		version: fields.version ?? OWNED_PLUGIN_FIRST_VERSION,
		format: 'foldnano_mini',
		applyStrategy: 'replayMutationLog',
		...(description ? { description } : {}),
		...(fields.hasIcon ? { icon: OWNED_PLUGIN_ICON_FILE } : {}),
		...(fields.requirements.length > 0 ? { requirements: [...fields.requirements] } : {}),
		[AUTHORING_HINT_KEY]: { source: 'scriptLab' },
	};
}

/** `iconSvg` is written as icon.svg; pass it exactly when `manifest.icon` names that file. */
export function buildPluginZip(
	manifest: PluginManifest,
	code: string,
	iconSvg: string | null = null
): Uint8Array {
	if ((manifest.icon === OWNED_PLUGIN_ICON_FILE) !== (iconSvg !== null)) {
		throw new Error(
			`An owned plugin's manifest must name ${OWNED_PLUGIN_ICON_FILE} exactly when it has an icon.`
		);
	}
	return zipSync({
		'fplugin.json': strToU8(`${JSON.stringify(manifest, null, '\t')}\n`),
		'plugin.py': strToU8(code),
		...(iconSvg !== null ? { [OWNED_PLUGIN_ICON_FILE]: strToU8(iconSvg) } : {}),
	});
}

export function pluginFilesRecord(
	manifest: PluginManifest,
	zip: Uint8Array
): IndexedDbPluginFilesRecord {
	return {
		id: manifest.id,
		manifestVersion: manifest.version,
		entrypointZipData: zip,
		wheels: [],
		cachedAt: Date.now(),
	};
}

/** plugin.py from a stored zip; empty when the zip has none. */
export function readPluginPy(zip: Uint8Array): string {
	const file = unzipCapped(zip)['plugin.py'];
	return file ? strFromU8(file) : '';
}

/** 1.2.3 → 1.2.4. Versions only move up: they key the plugin file cache. */
export function bumpPatchVersion(version: string): string {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
	if (!match) throw new Error(`Cannot bump version "${version}": expected MAJOR.MINOR.PATCH.`);
	return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

/**
 * True when the owned-plugin editor can edit this package without losing anything: it rebuilds
 * the zip from fplugin.json, plugin.py and an optional icon.svg, and re-derives requirements from
 * imports, so extra files, other icon paths, side panels and requirements imports can't produce
 * (PyPI, wheels, standard extras) rule it out.
 */
export function isOwnedEditablePackage(
	manifest: PluginManifest,
	fileNames: readonly string[]
): boolean {
	const sources = requirementSources(manifest);
	return (
		!manifest.sidePanel &&
		!manifest.entrypoint &&
		fileNames.includes('plugin.py') &&
		fileNames.every((name) => OWNED_ZIP_FILES.has(name)) &&
		(manifest.icon === undefined || manifest.icon === OWNED_PLUGIN_ICON_FILE) &&
		fileNames.includes(OWNED_PLUGIN_ICON_FILE) === (manifest.icon !== undefined) &&
		sources.pypi.length === 0 &&
		sources.bundled.length === 0 &&
		sources.firstParty.length === 0
	);
}

/** File names inside a stored plugin's zip; empty when there is none. */
export function pluginZipFileNames(files: IndexedDbPluginFilesRecord | null): string[] {
	return files?.entrypointZipData ? Object.keys(unzipCapped(files.entrypointZipData)) : [];
}

/** True for a zip this app exported from an owned plugin, which can be restored as editable. */
export function isRestorableOwnedZip(
	manifest: PluginManifest,
	fileNames: readonly string[]
): boolean {
	const hint = manifest[AUTHORING_HINT_KEY];
	return (
		typeof hint === 'object' &&
		hint !== null &&
		(hint as { source?: unknown }).source === 'scriptLab' &&
		isOwnedEditablePackage(manifest, fileNames)
	);
}

/** e.g. "Staple Tidy" v1.0.2 → "staple-tidy-1.0.2.zip". */
export function ownedPluginZipFilename(manifest: PluginManifest): string {
	const slug =
		manifest.name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '') || 'plugin';
	return `${slug}-${manifest.version}.zip`;
}

export function downloadPluginZip(manifest: PluginManifest, zip: Uint8Array): void {
	const blob = new Blob([zip as BlobPart], { type: 'application/zip' });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = ownedPluginZipFilename(manifest);
	anchor.click();
	// Safari can cancel a download whose URL is revoked in the same task.
	setTimeout(() => URL.revokeObjectURL(url), 0);
}
