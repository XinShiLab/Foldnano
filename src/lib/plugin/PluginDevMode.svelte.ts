/**
 * Plugin dev mode: link a plugin folder on disk and run it as-is on every Run. Owns the dev mode
 * setting, folder handles and permission state; reading the folder is `linkedPluginFolder.ts`,
 * running is `PluginCoordinator`. See docs/python-plugin-system.md § Plugin dev mode.
 */

import {
	ensureAccess,
	getFileHandle,
	isEffectivelyEmpty,
	isMissingHandleError,
	pickDirectory,
	queryAccess,
	supportsFileSystemAccess,
	writeFile,
} from '$lib/services/fileAccess/fileAccess';
import {
	foldnanoIndexedDb,
	type FoldnanoIndexedDb,
} from '$lib/services/storage/indexeddb/FoldnanoIndexedDb';
import {
	checkLinkedPluginFolder,
	readLinkedPluginFolder,
	type LinkedFolderRead,
	type PluginCheckIssue,
} from './linkedPluginFolder';
import { downloadPluginZip } from './ownedPlugins';
import { starterPluginFiles } from './pluginScaffold';
import type { PluginRegistry } from './PluginRegistry.svelte';
import type { PluginCoordinator } from './PluginCoordinator.svelte';
import type { PluginManifest, PythonPlugin } from './types';

/**
 * What the user is asked to accept: a folder being linked, or a re-read that changes what the
 * plugin installs or reaches over the network.
 */
export interface LinkedPluginReview {
	kind: 'link' | 'change';
	folderName: string;
	manifest: PluginManifest;
	/** The manifest accepted so far; null when linking. */
	previous: PluginManifest | null;
}

/** Resolves true when the user accepts. */
export type LinkedPluginReviewer = (review: LinkedPluginReview) => Promise<boolean>;

/** True when `next` installs or reaches something `previous` didn't (or no longer does). */
export function changesEnvironmentDisclosure(
	previous: PluginManifest,
	next: PluginManifest
): boolean {
	const same = (a: string[] | undefined, b: string[] | undefined) =>
		JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...(b ?? [])].sort());
	return !same(previous.requirements, next.requirements) || !same(previous.network, next.network);
}

/** A picked folder: already a plugin, or a candidate for a new one (`createPlugin`). */
export type PickedFolderState =
	{ kind: 'plugin' } | { kind: 'new'; empty: boolean; hasPluginPy: boolean };

async function fileExists(dir: FileSystemDirectoryHandle, path: string): Promise<boolean> {
	try {
		await getFileHandle(dir, path);
		return true;
	} catch (e) {
		if (e instanceof DOMException && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError'))
			return false;
		throw e;
	}
}

const DEV_MODE_SETTING = 'pluginDevMode';
/** Lets the picker reopen where the user last linked a plugin folder. */
const PICKER_ID = 'foldnano-plugin-dev';

type DevModeDb = Pick<
	FoldnanoIndexedDb,
	'getSetting' | 'setSetting' | 'saveFileHandle' | 'loadFileHandle' | 'deleteFileHandle'
>;

export class PluginDevMode {
	/** The Dev tab's switch; linked plugins are hidden and stopped while it is off. */
	enabled: boolean = $state(false);
	readonly supported = supportsFileSystemAccess();
	ready: Promise<void>;

	readonly #registry: PluginRegistry;
	readonly #getCoordinator: () => PluginCoordinator;
	readonly #db: DevModeDb;
	#reviewer: LinkedPluginReviewer | undefined;

	constructor(
		registry: PluginRegistry,
		getCoordinator: () => PluginCoordinator,
		db: DevModeDb = foldnanoIndexedDb
	) {
		this.#registry = registry;
		this.#getCoordinator = getCoordinator;
		this.#db = db;
		this.ready = this.#load();
	}

	/** Wired by the UI; without one, links and environment changes are accepted as-is. */
	setReviewer(reviewer: LinkedPluginReviewer): void {
		this.#reviewer = reviewer;
	}

	get linkedPlugins(): PythonPlugin[] {
		return this.#registry.all.filter((p) => p.origin === 'linked');
	}

	async #load(): Promise<void> {
		try {
			this.enabled = (await this.#db.getSetting<boolean>(DEV_MODE_SETTING)) === true;
		} catch (e) {
			console.warn('[PluginDevMode] Failed to load the dev mode setting:', e);
		}
		await this.#registry.ready;
		for (const plugin of this.linkedPlugins) {
			plugin.enabled = this.enabled;
			void this.#checkAccess(plugin);
		}
	}

	async setEnabled(enabled: boolean): Promise<void> {
		this.enabled = enabled;
		const coordinator = this.#getCoordinator();
		for (const plugin of this.linkedPlugins) {
			if (!enabled) {
				coordinator.stopPlugin(plugin.manifest.id);
				if (coordinator.pendingApply?.pluginId === plugin.manifest.id)
					coordinator.cancelApply(plugin.manifest.id);
				coordinator.deactivate(plugin.manifest.id);
			}
			plugin.enabled = enabled;
		}
		if (!enabled) coordinator.releaseLinkedEnvironment();
		await this.#db.setSetting(DEV_MODE_SETTING, enabled);
	}

	/** Picks a folder and registers its plugin. Resolves null when the user cancels the picker. */
	async linkFolder(): Promise<PythonPlugin | null> {
		const dir = await this.pickFolder();
		return dir ? this.linkPickedFolder(dir) : null;
	}

	/** The folder picker, reopening where the last plugin folder was; null when cancelled. */
	pickFolder(): Promise<FileSystemDirectoryHandle | null> {
		return pickDirectory({ id: PICKER_ID });
	}

	/** Whether a picked folder already is a plugin, or could become one with a new manifest. */
	async inspectFolder(dir: FileSystemDirectoryHandle): Promise<PickedFolderState> {
		let hasManifest = false;
		let hasPluginPy = false;
		for await (const entry of dir.values()) {
			if (entry.kind !== 'file') continue;
			if (entry.name === 'fplugin.json') hasManifest = true;
			if (entry.name === 'plugin.py') hasPluginPy = true;
		}
		if (hasManifest) return { kind: 'plugin' };
		return { kind: 'new', empty: await isEffectivelyEmpty(dir), hasPluginPy };
	}

	/** Reviews and registers the plugin in a picked folder; null when the user declines. */
	async linkPickedFolder(dir: FileSystemDirectoryHandle): Promise<PythonPlugin | null> {
		const read = await readLinkedPluginFolder(dir);
		const accepted =
			!this.#reviewer ||
			(await this.#reviewer({
				kind: 'link',
				folderName: dir.name,
				manifest: read.manifest,
				previous: null,
			}));
		return accepted ? this.#register(dir, read) : null;
	}

	/**
	 * Writes a starter plugin into a picked folder that has no fplugin.json, then links it. Asks
	 * for write access first, so call it straight from the Create click. Existing files (e.g. a
	 * plugin.py the author already has) are never overwritten.
	 */
	async createPlugin(
		dir: FileSystemDirectoryHandle,
		manifest: PluginManifest,
		options: { stubs: boolean }
	): Promise<PythonPlugin> {
		if (!(await ensureAccess(dir, 'readwrite'))) {
			throw new Error(`Foldnano needs permission to write to "${dir.name}" to create the plugin.`);
		}
		const state = await this.inspectFolder(dir);
		if (state.kind === 'plugin') {
			throw new Error(`"${dir.name}" already has an fplugin.json. Link it instead.`);
		}
		const files = await starterPluginFiles(manifest, {
			pluginPy: !state.hasPluginPy,
			stubs: options.stubs,
		});
		for (const [path, text] of Object.entries(files)) {
			if (path !== 'fplugin.json' && (await fileExists(dir, path))) continue;
			await writeFile(dir, path, text);
		}
		// The user just wrote this manifest in the dialog; no second review.
		return this.#register(dir, await readLinkedPluginFolder(dir));
	}

	async #register(dir: FileSystemDirectoryHandle, read: LinkedFolderRead): Promise<PythonPlugin> {
		const handleId = crypto.randomUUID();
		const now = Date.now();
		await this.#db.saveFileHandle({
			id: handleId,
			kind: 'directory',
			purpose: 'plugin-dev',
			name: dir.name,
			handle: dir,
			createdAt: now,
			lastUsedAt: now,
		});
		try {
			const plugin = await this.#registry.registerLinked(read.manifest, read.files, {
				handleId,
				folderName: dir.name,
			});
			plugin.enabled = this.enabled;
			return plugin;
		} catch (e) {
			await this.#db.deleteFileHandle(handleId).catch(() => {});
			throw e;
		}
	}

	/** Points a linked plugin at a newly picked folder, which must declare the same id. */
	async relinkFolder(pluginId: string): Promise<boolean> {
		const plugin = this.#linked(pluginId);
		const dir = await pickDirectory({ id: PICKER_ID });
		if (!dir) return false;
		const read = await readLinkedPluginFolder(dir);
		if (read.manifest.id !== pluginId) {
			throw new Error(
				`The folder "${dir.name}" holds "${read.manifest.id}", not "${pluginId}". ` +
					'Unlink this plugin and link that folder instead.'
			);
		}
		const oldHandleId = plugin.linked!.handleId;
		const handleId = crypto.randomUUID();
		const now = Date.now();
		await this.#db.saveFileHandle({
			id: handleId,
			kind: 'directory',
			purpose: 'plugin-dev',
			name: dir.name,
			handle: dir,
			createdAt: now,
			lastUsedAt: now,
		});
		await this.#registry.relinkFolder(pluginId, { handleId, folderName: dir.name });
		await this.#db.deleteFileHandle(oldHandleId).catch(() => {});
		return true;
	}

	/** Forgets the folder and the plugin entry; the files on disk are untouched. */
	unlink(pluginId: string): void {
		this.#linked(pluginId);
		const coordinator = this.#getCoordinator();
		const busy = coordinator.isPluginBusyOrPending(pluginId);
		if (busy.busy) throw new Error(`Cannot unlink "${pluginId}": ${busy.reason ?? 'it is busy'}.`);
		coordinator.deactivate(pluginId);
		this.#registry.remove(pluginId);
	}

	/**
	 * `PluginCoordinator`'s `LinkedFolderReader`. Prompts for access when needed, so it must run
	 * from the Activate/Run click before other awaits.
	 */
	async readFolder(plugin: PythonPlugin): Promise<LinkedFolderRead> {
		return this.#withFolder(plugin, async (dir, folderName) => {
			const read = await readLinkedPluginFolder(dir);
			if (
				this.#reviewer &&
				changesEnvironmentDisclosure(plugin.manifest, read.manifest) &&
				!(await this.#reviewer({
					kind: 'change',
					folderName,
					manifest: read.manifest,
					previous: plugin.manifest,
				}))
			) {
				throw new LinkedPluginChangeDeclinedError(plugin.manifest.name);
			}
			return read;
		});
	}

	/** Check plugin: every problem and note for the linked folder, without running it. */
	checkFolder(plugin: PythonPlugin): Promise<PluginCheckIssue[]> {
		return this.#withFolder(plugin, (dir) => checkLinkedPluginFolder(dir));
	}

	/** Downloads the folder as the plugin zip Import zip expects (ignored files left out). */
	async exportZip(plugin: PythonPlugin): Promise<void> {
		const read = await this.#withFolder(plugin, (dir) => readLinkedPluginFolder(dir));
		downloadPluginZip(read.manifest, read.zip);
	}

	/**
	 * Runs `use` on a linked plugin's folder after getting read access (prompting if needed, so
	 * call it from a click), keeping `plugin.linked.access` up to date.
	 */
	async #withFolder<T>(
		plugin: PythonPlugin,
		use: (dir: FileSystemDirectoryHandle, folderName: string) => Promise<T>
	): Promise<T> {
		const linked = plugin.linked;
		if (!linked) throw new Error(`"${plugin.manifest.id}" is not a linked plugin.`);
		const setAccess = (access: NonNullable<PythonPlugin['linked']>['access']) => {
			if (plugin.linked) plugin.linked = { ...plugin.linked, access };
		};
		const record = await this.#db.loadFileHandle(linked.handleId);
		if (!record) {
			setAccess('missing');
			throw new Error(`The link to "${linked.folderName}" was lost. Re-link the folder.`);
		}
		const dir = record.handle as FileSystemDirectoryHandle;
		if (!(await ensureAccess(dir, 'read'))) {
			setAccess(await queryAccess(dir, 'read').catch(() => 'denied' as const));
			throw new Error(
				`Foldnano needs permission to read the folder "${linked.folderName}". ` +
					'Try again and allow access.'
			);
		}
		try {
			const result = await use(dir, linked.folderName);
			setAccess('granted');
			return result;
		} catch (e) {
			if (isMissingHandleError(e)) {
				setAccess('missing');
				throw new Error(
					`The folder "${linked.folderName}" can't be found. It may have been moved or deleted. Re-link it.`
				);
			}
			throw e;
		}
	}

	async #checkAccess(plugin: PythonPlugin): Promise<void> {
		const linked = plugin.linked;
		if (!linked) return;
		try {
			const record = await this.#db.loadFileHandle(linked.handleId);
			const access = record ? await queryAccess(record.handle, 'read') : 'missing';
			if (plugin.linked) plugin.linked = { ...plugin.linked, access };
		} catch (e) {
			console.warn('[PluginDevMode] Failed to check folder access:', e);
		}
	}

	#linked(pluginId: string): PythonPlugin {
		const plugin = this.#registry.get(pluginId);
		if (plugin?.origin !== 'linked' || !plugin.linked) {
			throw new Error(`"${pluginId}" is not a linked plugin.`);
		}
		return plugin;
	}
}

/** The user declined a changed requirements/network declaration; nothing ran. */
export class LinkedPluginChangeDeclinedError extends Error {
	constructor(name: string) {
		super(
			`"${name}" was not run: its new requirements or network access were not accepted. ` +
				'Change fplugin.json back, or run again and accept.'
		);
		this.name = 'LinkedPluginChangeDeclinedError';
	}
}
