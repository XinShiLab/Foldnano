/**
 * Create, save and export owned plugins (Make Plugin and the owned-plugin editor).
 * See docs/script-lab.md § Owned plugins.
 */

import {
	buildOwnedManifest,
	buildPluginZip,
	bumpPatchVersion,
	downloadPluginZip,
	generateOwnedPluginId,
	pluginFilesRecord,
	readPluginPy,
} from './ownedPlugins';
import { MANIFEST_SCHEMA_VERSION } from './manifestValidation';
import { OWNED_PLUGIN_ICON_FILE, validatePluginIconSvg } from './pluginIcon';
import type { PluginCoordinator } from './PluginCoordinator.svelte';
import type { PluginRegistry } from './PluginRegistry.svelte';
import type { PluginManifest, PythonPlugin } from './types';
import { foldnanoIndexedDb } from '$lib/services/storage/indexeddb/FoldnanoIndexedDb';

type Registry = Pick<PluginRegistry, 'get' | 'registerNew' | 'saveOwnedVersion' | 'markExported'>;
type Coordinator = Pick<PluginCoordinator, 'resolveScriptRequirements'>;

export interface OwnedPluginDeps {
	registry: Registry;
	coordinator: Coordinator;
}

export interface CreatedOwnedPlugin {
	plugin: PythonPlugin;
	manifest: PluginManifest;
	zip: Uint8Array;
}

/** Packages `code` as a new owned plugin and installs it. */
export async function createOwnedPlugin(
	{ registry, coordinator }: OwnedPluginDeps,
	fields: { id: string; name: string; description?: string; code: string; iconSvg?: string | null }
): Promise<CreatedOwnedPlugin> {
	if (!fields.name.trim()) throw new Error('Give the plugin a name.');
	if (!fields.code.trim()) throw new Error('The script is empty.');
	const iconSvg = fields.iconSvg ? validatePluginIconSvg(fields.iconSvg) : null;
	const requirements = await coordinator.resolveScriptRequirements(fields.code);
	// A random id clashing is unlikely but cheap to rule out.
	let id = fields.id;
	while (registry.get(id)) id = generateOwnedPluginId();
	const manifest = buildOwnedManifest({ ...fields, id, requirements, hasIcon: iconSvg !== null });
	const zip = buildPluginZip(manifest, fields.code, iconSvg);
	const plugin = await registry.registerNew(manifest, pluginFilesRecord(manifest, zip), {
		authoring: { source: 'scriptLab' },
	});
	return { plugin, manifest, zip };
}

/**
 * Saves `code` as the owned plugin's next patch version, re-deriving its requirements.
 * `iconSvg`: undefined keeps the current icon, null removes it, a string replaces it.
 */
export async function saveOwnedPluginVersion(
	{ registry, coordinator }: OwnedPluginDeps,
	pluginId: string,
	code: string,
	iconSvg?: string | null,
	draftCode: string | null = null
): Promise<PythonPlugin> {
	const plugin = registry.get(pluginId);
	if (!plugin?.authoring) throw new Error(`"${pluginId}" was not made in this browser.`);
	if (!code.trim()) throw new Error('The plugin editor is empty.');
	const icon =
		iconSvg === undefined
			? (plugin.iconSvg ?? null)
			: iconSvg === null
				? null
				: validatePluginIconSvg(iconSvg);
	const requirements = await coordinator.resolveScriptRequirements(code);
	const { requirements: _previous, icon: _previousIcon, ...rest } = plugin.manifest;
	const manifest: PluginManifest = {
		...rest,
		// A restored v1 zip moves to the current schema, which `icon` needs.
		schemaVersion: MANIFEST_SCHEMA_VERSION,
		version: bumpPatchVersion(plugin.manifest.version),
		...(icon !== null ? { icon: OWNED_PLUGIN_ICON_FILE } : {}),
		...(requirements.length > 0 ? { requirements } : {}),
	};
	const zip = buildPluginZip(manifest, code, icon);
	return registry.saveOwnedVersion(manifest, pluginFilesRecord(manifest, zip), draftCode);
}

/** Saves the saved code as a new version with a different icon (null removes it); keeps the draft. */
export async function changeOwnedPluginIcon(
	deps: OwnedPluginDeps,
	pluginId: string,
	iconSvg: string | null
): Promise<PythonPlugin> {
	const code = readPluginPy(await loadOwnedPluginZip(pluginId));
	const draft = deps.registry.get(pluginId)?.draftCode ?? null;
	return saveOwnedPluginVersion(deps, pluginId, code, iconSvg, draft);
}

/** The saved version's zip, as installed. */
export async function loadOwnedPluginZip(pluginId: string): Promise<Uint8Array> {
	const files = await foldnanoIndexedDb.loadPluginFiles(pluginId);
	if (!files?.entrypointZipData) throw new Error(`No saved files for "${pluginId}".`);
	return files.entrypointZipData;
}

/** Downloads the saved version as a zip and records it as backed up. */
export async function exportOwnedPlugin(registry: Registry, pluginId: string): Promise<void> {
	const plugin = registry.get(pluginId);
	if (!plugin) throw new Error(`Plugin "${pluginId}" is not installed.`);
	downloadPluginZip(plugin.manifest, await loadOwnedPluginZip(pluginId));
	await registry.markExported(pluginId, plugin.manifest.version);
}

/** True when the saved version is newer than the last backup download. */
export function needsBackup(plugin: PythonPlugin): boolean {
	return Boolean(
		plugin.authoring && plugin.authoring.lastExportedVersion !== plugin.manifest.version
	);
}
