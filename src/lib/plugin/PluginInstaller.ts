import { strFromU8 } from 'fflate';
import { classifyManifest, validateManifest } from './manifestValidation';
import type { PluginManifest } from './types';
import { isOwnedEditablePackage, isRestorableOwnedZip } from './ownedPlugins';
import { bundledIconSvg } from './pluginIcon';
import type { PluginRegistry } from './PluginRegistry.svelte';
import type { IndexedDbPluginFilesRecord } from '$lib/services/storage/indexedDbTypes';

import { MAX_PLUGIN_ZIP_BYTES, readResponseCapped, unzipCapped } from './sizeLimits';

export { MAX_PLUGIN_ZIP_BYTES };

/**
 * Unified plugin installer. Every file/URL-delivered plugin is a single zip:
 *
 *   my_plugin.zip
 *   ├── fplugin.json   — manifest (required, at zip root; the source of truth)
 *   ├── plugin.py      — Python entrypoint (required, at zip root)
 *   ├── *.py / assets  — any supporting files
 *   └── *.whl          — wheels listed as bare filenames in requirements
 *
 * Both delivery routes prepare a result that PluginInstallGate commits after
 * any required confirmation.
 *
 * The manifest INSIDE the zip is authoritative — a pasted/hosted manifest is
 * only a locator (id + entrypointUrl). The full zip is stored in IndexedDB at
 * install time; activation never fetches.
 */

/** True for requirements like "pkg-1.0-py3-none-any.whl" that must ship inside the zip. */
function isBundledWheelRequirement(req: string): boolean {
	return req.endsWith('.whl') && !req.includes('/');
}

interface ProcessedPluginZip {
	manifest: PluginManifest;
	files: IndexedDbPluginFilesRecord | null;
	/** A local zip exported from a plugin made with Script Lab; can be restored as editable. */
	restorable: boolean;
	/** The owned-plugin editor could edit this package (see `isOwnedEditablePackage`). */
	ownedEditable: boolean;
}

/** Side-effect-free: no persistence, no registry access. */
export function processPluginZip(
	zipBytes: Uint8Array,
	opts: { sourceUrl?: string; expectedId?: string } = {}
): ProcessedPluginZip {
	if (zipBytes.byteLength > MAX_PLUGIN_ZIP_BYTES) {
		throw new Error(
			`Plugin zip exceeds the ${Math.round(MAX_PLUGIN_ZIP_BYTES / 1024 / 1024)} MB limit.`
		);
	}
	let files: Record<string, Uint8Array>;
	try {
		files = unzipCapped(zipBytes);
	} catch (e) {
		throw new Error(`Failed to parse zip: ${e instanceof Error ? e.message : String(e)}`);
	}

	const manifestBytes = files['fplugin.json'];
	if (!manifestBytes) {
		// Zipping a folder (e.g. macOS "Compress") nests everything one level down.
		const nested = Object.keys(files).find(
			(name) => /^[^/]+\/fplugin\.json$/.test(name) && !name.startsWith('__MACOSX/')
		);
		if (nested) {
			const folder = nested.slice(0, nested.indexOf('/') + 1);
			throw new Error(
				`fplugin.json is inside the folder "${folder}" in the zip, but it must be at the zip root. ` +
					`Zip the plugin's files themselves, not the folder that contains them.`
			);
		}
		throw new Error('No fplugin.json found at the zip root.');
	}
	let manifest: PluginManifest;
	try {
		const raw = JSON.parse(strFromU8(manifestBytes));
		// allowNoEntrypoint: the zip itself carries plugin.py; the inner manifest
		// may omit entrypointUrl (or restate the canonical zip URL).
		manifest = validateManifest(raw, { allowNoEntrypoint: true });
	} catch (e) {
		throw new Error(`Invalid fplugin.json: ${e instanceof Error ? e.message : String(e)}`);
	}

	if (opts.expectedId && manifest.id !== opts.expectedId) {
		throw new Error(
			`Plugin id mismatch: the manifest inside the zip declares "${manifest.id}" ` +
				`but "${opts.expectedId}" was requested.`
		);
	}

	const runtimeCode = classifyManifest(manifest) === 'runtime-code';
	if (!runtimeCode && !files['plugin.py']) {
		throw new Error('No plugin.py found at the zip root.');
	}

	// Checked here for a readable install error; the registry reads it again to store it.
	if (manifest.icon) bundledIconSvg(manifest.icon, files[manifest.icon]);

	// Wheels shipped inside the zip are referenced as bare filenames in
	// requirements. URL / absolute-path wheels stay activate-time fetches.
	const wheels: Array<{ url: string; data: Uint8Array }> = [];
	for (const req of manifest.requirements ?? []) {
		if (isBundledWheelRequirement(req)) {
			const wheelBytes = files[req];
			if (!wheelBytes) {
				throw new Error(`Wheel "${req}" listed in requirements not found in the zip.`);
			}
			wheels.push({ url: req, data: wheelBytes });
		}
	}

	// Runtime-code manifests inside a zip are unusual but legal — they have no
	// packaged code to cache unless they bundle wheels.
	const filesRecord: IndexedDbPluginFilesRecord | null =
		!runtimeCode || wheels.length > 0
			? {
					id: manifest.id,
					manifestVersion: manifest.version,
					entrypointZipData: runtimeCode ? undefined : zipBytes,
					wheels,
					cachedAt: Date.now(),
				}
			: null;

	// Keep provenance: a pointer-installed plugin remembers where its zip lives.
	const registeredManifest: PluginManifest =
		!manifest.entrypointUrl && opts.sourceUrl && !runtimeCode
			? { ...manifest, entrypointUrl: opts.sourceUrl }
			: manifest;

	const fileNames = Object.keys(files);
	const restorable = !opts.sourceUrl && !runtimeCode && isRestorableOwnedZip(manifest, fileNames);
	const ownedEditable = !runtimeCode && isOwnedEditablePackage(manifest, fileNames);

	return { manifest: registeredManifest, files: filesRecord, restorable, ownedEditable };
}

export type PreparedInstall =
	| {
			status: 'ready';
			manifest: PluginManifest;
			files: IndexedDbPluginFilesRecord | null;
			restorable?: boolean;
	  }
	| { status: 'blocked-builtin'; message: string }
	| { status: 'blocked-linked'; message: string }
	| { status: 'blocked-busy'; message: string }
	| {
			status: 'needs-confirm';
			incoming: PluginManifest;
			files: IndexedDbPluginFilesRecord | null;
			existing: PluginManifest;
			restorable?: boolean;
			/** Replacing a plugin made here with a package its editor can't handle. */
			endsEditing?: boolean;
	  };

type InstallReadinessRegistry = Pick<PluginRegistry, 'get' | 'isPluginBusyForInstall'>;

function classifyReadiness(
	manifest: PluginManifest,
	files: IndexedDbPluginFilesRecord | null,
	registry: InstallReadinessRegistry,
	restorable = false,
	ownedEditable = false
): PreparedInstall {
	const existing = registry.get(manifest.id);
	if (existing?.origin === 'builtin') {
		return {
			status: 'blocked-builtin',
			message: `"${manifest.id}" is a built-in plugin and cannot be replaced.`,
		};
	}
	if (existing?.origin === 'linked') {
		return {
			status: 'blocked-linked',
			message: `"${manifest.id}" is linked to a folder in dev mode. Unlink it before installing a zip with the same id.`,
		};
	}
	const busy = registry.isPluginBusyForInstall(manifest.id);
	if (busy.busy) {
		return {
			status: 'blocked-busy',
			message: `Cannot install "${manifest.id}": ${busy.reason ?? 'currently busy'}.`,
		};
	}
	if (!existing) return { status: 'ready', manifest, files, restorable };
	return {
		status: 'needs-confirm',
		incoming: manifest,
		files,
		existing: existing.manifest,
		restorable,
		endsEditing: Boolean(existing.authoring) && !ownedEditable,
	};
}

function prepareZipBytesInstall(
	zipBytes: Uint8Array,
	registry: InstallReadinessRegistry,
	opts: { sourceUrl?: string; expectedId?: string } = {}
): PreparedInstall {
	const { manifest, files, restorable, ownedEditable } = processPluginZip(zipBytes, opts);
	return classifyReadiness(manifest, files, registry, restorable, ownedEditable);
}

export async function prepareLocalZipInstall(
	file: File,
	registry: InstallReadinessRegistry
): Promise<PreparedInstall> {
	const zipBytes = new Uint8Array(await file.arrayBuffer());
	return prepareZipBytesInstall(zipBytes, registry);
}

export async function preparePointerInstall(
	pointer: unknown,
	registry: InstallReadinessRegistry
): Promise<PreparedInstall> {
	// Validate unknown input before classification or fetch.
	const manifest = validateManifest(pointer);
	const kind = classifyManifest(manifest);
	if (kind === 'runtime-code') return classifyReadiness(manifest, null, registry);
	if (kind === 'legacy' || !manifest.entrypointUrl) {
		throw new Error(`"${manifest.name}" uses the old plugin format — package it as a zip.`);
	}
	const response = await fetch(manifest.entrypointUrl);
	if (!response.ok) {
		throw new Error(`Failed to fetch plugin zip: ${response.status} ${response.statusText}`);
	}
	const zipBytes = await readResponseCapped(response, MAX_PLUGIN_ZIP_BYTES, 'The plugin zip');
	return prepareZipBytesInstall(zipBytes, registry, {
		sourceUrl: manifest.entrypointUrl,
		expectedId: manifest.id,
	});
}
