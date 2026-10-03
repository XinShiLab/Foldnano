import { SvelteMap } from 'svelte/reactivity';
import type { PythonPlugin, PluginManifest, PluginStatus } from './types';
import { classifyManifest, MANIFEST_SCHEMA_VERSION, withSchemaVersion } from './manifestValidation';
import {
	foldnanoIndexedDb,
	type FoldnanoIndexedDb,
} from '$lib/services/storage/indexeddb/FoldnanoIndexedDb';
import type {
	IndexedDbPluginRecord,
	IndexedDbPluginFilesRecord,
} from '$lib/services/storage/indexedDbTypes';
import { builtinPlugins } from './corePlugins';

export type PluginBusyCheck = (pluginId: string) => { busy: boolean; reason?: string };

function toRecord(manifest: PluginManifest): IndexedDbPluginRecord {
	return { id: manifest.id, manifest: manifest as unknown as object };
}

/**
 * Reactive plugin instance. Class fields declared with $state are tracked by
 * Svelte so that mutations in PluginCoordinator (e.g. plugin.status = 'active')
 * automatically propagate to the UI.
 */
class PluginState implements PythonPlugin {
	manifest: PluginManifest;
	origin: 'builtin' | 'user';
	enabled: boolean = $state(false);
	status: PluginStatus = $state('registered');
	resolvedCode: string | null = $state(null);
	resolvedZipData: ArrayBuffer | undefined = $state(undefined);
	errorMessage: string | null = $state(null);
	errorTraceback: string | null = $state(null);
	logs: string[] = $state([]);
	artifacts: Record<string, string | Uint8Array> = $state({});
	pluginResult: Record<string, unknown> | null = $state(null);
	paramValues: Record<string, unknown> = $state({});
	sidePanelValues: Record<string, unknown> = $state({});
	sidePanelCode: string = $state('');
	lastRunMutationLogLength: number | null = $state(null);

	constructor(manifest: PluginManifest, origin: 'builtin' | 'user') {
		this.manifest = manifest;
		this.origin = origin;
		this.enabled = origin === 'user';
		this.resolvedCode = manifest.entrypoint ?? null;
		this.paramValues = Object.fromEntries(
			(manifest.parameters ?? []).map((p) => [p.id, p.default ?? null])
		);
		this.sidePanelValues = Object.fromEntries(
			(manifest.sidePanel?.form?.fields ?? []).map((field) => [field.id, field.default ?? null])
		);
		this.sidePanelCode = manifest.sidePanel?.codeEditor?.initialCode ?? '';
	}
}

/**
 * Reactive registry of all registered plugins.
 *
 * Plugins are persisted to IndexedDB (foldnano-db, "plugins" table, version 2).
 * Runtime state (status, logs, artifacts) is ephemeral — only the manifest is persisted.
 *
 * Call `await registry.ready` before rendering the plugin list to ensure the initial
 * load from IndexedDB has completed.
 */
export class PluginRegistry {
	/** Map from plugin ID → reactive plugin instance */
	plugins: SvelteMap<string, PythonPlugin> = new SvelteMap();

	/** Resolves once the initial IndexedDB load is complete. */
	ready: Promise<void>;

	readonly #db: FoldnanoIndexedDb;

	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- internal bookkeeping, UI never reads it
	#reservations = new Set<string>();
	#busyCheck: PluginBusyCheck | undefined;

	constructor(db: FoldnanoIndexedDb = foldnanoIndexedDb) {
		this.#db = db;
		for (const manifest of builtinPlugins) {
			this.plugins.set(manifest.id, new PluginState(manifest, 'builtin'));
		}
		this.ready = this.#loadFromStorage();
	}

	/** One-shot — throws if called twice, so nothing downstream of initial wiring can weaken it. */
	setBusyCheck(check: PluginBusyCheck): void {
		if (this.#busyCheck) {
			throw new Error('Plugin registry busy-check is already configured and cannot be replaced.');
		}
		this.#busyCheck = check;
	}

	/** True while a registerNew()/replaceConfirmed() call for `id` has an in-flight write. */
	hasReservation(id: string): boolean {
		return this.#reservations.has(id);
	}

	#getInstallBusyState(id: string): { busy: boolean; reason?: string } {
		if (this.#reservations.has(id)) {
			return { busy: true, reason: 'plugin installation or replacement is already in progress' };
		}
		if (!this.#busyCheck) {
			// Fail closed rather than treat "unwired" as "not busy".
			return { busy: true, reason: 'registry busy-check is not configured' };
		}
		return this.#busyCheck(id);
	}

	isPluginBusyForInstall(id: string): { busy: boolean; reason?: string } {
		return this.#getInstallBusyState(id);
	}

	#assertNotBusy(id: string): void {
		const result = this.#getInstallBusyState(id);
		if (result.busy) {
			throw new Error(
				`Cannot install or replace plugin "${id}": ${result.reason ?? 'currently busy'}.`
			);
		}
	}

	/** Registers a brand-new plugin id, refusing if it's already registered. The DB write is
	 *  awaited before the in-memory registry updates. */
	async registerNew(
		manifest: PluginManifest,
		files: IndexedDbPluginFilesRecord | null
	): Promise<PythonPlugin> {
		if (this.plugins.has(manifest.id)) {
			throw new Error(`Plugin id "${manifest.id}" is already registered.`);
		}
		this.#assertNotBusy(manifest.id);
		this.#reservations.add(manifest.id);
		try {
			await this.#db.saveInstalledPlugin(toRecord(manifest), files, /* isNew */ true);
			const plugin = new PluginState(manifest, 'user');
			this.plugins.set(manifest.id, plugin);
			return plugin;
		} finally {
			this.#reservations.delete(manifest.id);
		}
	}

	/** Replaces an existing, non-builtin plugin. Refuses for a builtin id or a missing existing
	 *  plugin — use registerNew() for those. */
	async replaceConfirmed(
		manifest: PluginManifest,
		files: IndexedDbPluginFilesRecord | null
	): Promise<PythonPlugin> {
		const existing = this.plugins.get(manifest.id);
		if (existing?.origin === 'builtin') {
			throw new Error(`Cannot replace built-in plugin "${manifest.id}".`);
		}
		if (!existing) {
			throw new Error(`Cannot replace "${manifest.id}" because it is not installed.`);
		}
		this.#assertNotBusy(manifest.id);
		this.#reservations.add(manifest.id);
		try {
			await this.#db.saveInstalledPlugin(toRecord(manifest), files, /* isNew */ false);
			const plugin = new PluginState(manifest, 'user');
			this.plugins.set(manifest.id, plugin);
			return plugin;
		} finally {
			this.#reservations.delete(manifest.id);
		}
	}

	/** Remove a plugin by ID. */
	remove(id: string): boolean {
		const plugin = this.plugins.get(id);
		if (plugin?.origin === 'builtin') return false;
		const deleted = this.plugins.delete(id);
		if (deleted) {
			this.#deletePlugin(id);
			this.#db
				.deletePluginFiles(id)
				.catch((e) => console.warn('[PluginRegistry] Failed to delete plugin files:', e));
		}
		return deleted;
	}

	/** Get a plugin by ID. */
	get(id: string): PythonPlugin | undefined {
		return this.plugins.get(id);
	}

	/** Enable or disable a plugin. For builtin plugins this is persisted to IndexedDB. */
	setEnabled(id: string, enabled: boolean): void {
		const plugin = this.plugins.get(id);
		if (!plugin) return;
		plugin.enabled = enabled;
		if (plugin.origin === 'builtin') {
			this.#db
				.savePluginEnabled(id, enabled)
				.catch((e) => console.warn('[PluginRegistry] Failed to save plugin enabled state:', e));
		}
	}

	/** All registered plugins as an array, in insertion order. */
	get all(): PythonPlugin[] {
		return [...this.plugins.values()];
	}

	// ---------------------------------------------------------------------------
	// Persistence (fire-and-forget writes; async initial load)
	// ---------------------------------------------------------------------------

	#deletePlugin(id: string): void {
		this.#db
			.deletePlugin(id)
			.catch((e) => console.warn('[PluginRegistry] Failed to delete plugin:', e));
	}

	async #loadFromStorage(): Promise<void> {
		try {
			const records = await this.#db.loadAllPlugins();
			for (const record of records) {
				const stored = (record as { manifest?: Partial<PluginManifest> }).manifest;
				if (stored && !this.plugins.has(record.id)) {
					// Records from before versioning carry no schemaVersion.
					const manifest = withSchemaVersion(stored) as PluginManifest;
					const state = new PluginState(manifest, 'user');
					// Records installed under the pre-zip plugin format, or by a newer app,
					// cannot be activated — flag them for re-import instead.
					if (
						classifyManifest(manifest) === 'legacy' ||
						manifest.schemaVersion > MANIFEST_SCHEMA_VERSION
					)
						state.status = 'needs-reinstall';
					this.plugins.set(record.id, state);
				}
				const plugin = this.plugins.get(record.id);
				if (plugin) {
					if (record.sidePanelCode !== undefined) plugin.sidePanelCode = record.sidePanelCode;
					if (record.enabled !== undefined) plugin.enabled = record.enabled;
				}
			}
		} catch (e) {
			console.warn('[PluginRegistry] Failed to load plugins from IndexedDB:', e);
		}
	}

	/** Saves a code-editor buffer; rejects on failure so the panel can show it isn't saved. */
	persistEditorCode(pluginId: string, code: string): Promise<void> {
		return this.#db.savePluginEditorState(pluginId, code);
	}
}
