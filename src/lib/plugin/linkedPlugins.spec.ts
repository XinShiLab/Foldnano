import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

vi.mock('$lib/errorReporting', () => ({ reportError: vi.fn() }));

import FoldnanoDocument from '$lib/model/document.svelte';
import { makeHoneycombPart } from '$lib/model/test/testHelpers';
import { memoryDirectory, type MemoryTree } from '$lib/services/fileAccess/memoryFileSystem';
import type {
	IndexedDbFileHandleRecord,
	IndexedDbPluginRecord,
} from '$lib/services/storage/indexedDbTypes';
import {
	checkLinkedPluginFolder,
	isIgnoredLinkedPath,
	readLinkedPluginFolder,
} from './linkedPluginFolder';
import { PluginRegistry } from './PluginRegistry.svelte';
import { PluginCoordinator } from './PluginCoordinator.svelte';
import {
	LinkedPluginChangeDeclinedError,
	PluginDevMode,
	type LinkedPluginReview,
} from './PluginDevMode.svelte';
import { prepareLocalZipInstall } from './PluginInstaller';
import { buildNewManifest } from './pluginScaffold';
import type { PluginManifest } from './types';

const ID = 'dev.example';

function manifestJson(overrides: Partial<PluginManifest> = {}): string {
	return JSON.stringify({
		schemaVersion: 2,
		id: ID,
		name: 'Dev Example',
		version: '0.1.0',
		format: 'foldnano_json',
		applyStrategy: 'previewOnly',
		...overrides,
	});
}

function pluginTree(extra: MemoryTree = {}, manifest: Partial<PluginManifest> = {}): MemoryTree {
	return { 'fplugin.json': manifestJson(manifest), 'plugin.py': 'def run(ctx): pass\n', ...extra };
}

function makeDb(records: IndexedDbPluginRecord[] = []) {
	const plugins = new Map(records.map((r) => [r.id, r]));
	const handles = new Map<string, IndexedDbFileHandleRecord>();
	const settings = new Map<string, unknown>();
	return {
		plugins,
		handles,
		loadAllPlugins: vi.fn(async () => [...plugins.values()]),
		savePlugin: vi.fn(async (r: IndexedDbPluginRecord) => void plugins.set(r.id, r)),
		updatePluginRecord: vi.fn(async (id: string, patch: Partial<IndexedDbPluginRecord>) => {
			plugins.set(id, { ...plugins.get(id)!, ...patch });
		}),
		deletePlugin: vi.fn(async (id: string) => void plugins.delete(id)),
		deletePluginFiles: vi.fn(async () => {}),
		saveFileHandle: vi.fn(async (r: IndexedDbFileHandleRecord) => void handles.set(r.id, r)),
		loadFileHandle: vi.fn(async (id: string) => handles.get(id) ?? null),
		deleteFileHandle: vi.fn(async (id: string) => void handles.delete(id)),
		getSetting: vi.fn(async (key: string) => settings.get(key)),
		setSetting: vi.fn(async (key: string, value: unknown) => void settings.set(key, value)),
	};
}

function makeBridge() {
	return {
		initRuntime: vi.fn(async () => {}),
		installPlugin: vi.fn(async () => {}),
		runPlugin: vi.fn(async () => ({
			logs: [],
			artifacts: {},
			pluginResult: null,
			primaryArtifact: null,
			mutationLog: null,
		})),
		terminate: vi.fn(),
	};
}

/** Registry + coordinator + dev mode over in-memory storage, with `tree` linkable as a folder. */
async function setup(tree: MemoryTree = pluginTree()) {
	const db = makeDb();
	const registry = new PluginRegistry(db as never);
	const doc = new FoldnanoDocument('doc', 'Doc');
	doc.parts.push(makeHoneycombPart('Part'));
	const bridges: Array<ReturnType<typeof makeBridge>> = [];
	const coordinator = new PluginCoordinator(
		registry,
		() => doc,
		undefined,
		() => null,
		(() => {
			const bridge = makeBridge();
			bridges.push(bridge);
			return bridge;
		}) as never
	);
	registry.setBusyCheck((id) => coordinator.isPluginBusyOrPending(id));
	const devMode = new PluginDevMode(registry, () => coordinator, db as never);
	coordinator.setLinkedFolderReader((plugin) => devMode.readFolder(plugin));
	await devMode.ready;
	await devMode.setEnabled(true);
	const dir = memoryDirectory('my-plugin', tree);
	vi.stubGlobal(
		'showDirectoryPicker',
		vi.fn(async () => dir)
	);
	return { db, registry, coordinator, devMode, bridges, dir, tree };
}

function sentZipFiles(bridge: ReturnType<typeof makeBridge>, call = 0): Record<string, string> {
	const args = bridge.runPlugin.mock.calls[call] as unknown as [{ pluginZipData: ArrayBuffer }];
	const files = unzipSync(new Uint8Array(args[0].pluginZipData));
	return Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strFromU8(v)]));
}

describe('readLinkedPluginFolder', () => {
	it('zips the folder minus dot-folders, caches and environments', async () => {
		const dir = memoryDirectory(
			'p',
			pluginTree({
				'helpers.py': 'X = 1',
				'.git': { HEAD: 'ref' },
				'.venv': { lib: { 'big.py': 'x' } },
				__pycache__: { 'helpers.cpython-314.pyc': 'bin' },
				'old.zip': 'zip',
				'.DS_Store': '',
			})
		);
		const read = await readLinkedPluginFolder(dir);
		expect(read.manifest.id).toBe(ID);
		expect(read.fileNames.sort()).toEqual(['fplugin.json', 'helpers.py', 'plugin.py']);
	});

	it('needs fplugin.json at the top of the folder', async () => {
		await expect(readLinkedPluginFolder(memoryDirectory('p', { 'plugin.py': '' }))).rejects.toThrow(
			/No fplugin.json/
		);
	});

	it('reports manifest errors the way install does', async () => {
		const dir = memoryDirectory('p', pluginTree({}, { version: 'not-semver' } as never));
		await expect(readLinkedPluginFolder(dir)).rejects.toThrow(/Invalid fplugin.json/);
	});

	it('changes the environment fingerprint for requirements, not for code', async () => {
		const tree = pluginTree();
		const dir = memoryDirectory('p', tree);
		const first = await readLinkedPluginFolder(dir);
		tree['plugin.py'] = 'def run(ctx): print(1)\n';
		expect((await readLinkedPluginFolder(dir)).envFingerprint).toBe(first.envFingerprint);
		tree['fplugin.json'] = manifestJson({ requirements: ['numpy'] });
		expect((await readLinkedPluginFolder(dir)).envFingerprint).not.toBe(first.envFingerprint);
	});

	it('ignores by name only at the last path segment', () => {
		expect(isIgnoredLinkedPath('pkg/.hidden', 'file')).toBe(true);
		expect(isIgnoredLinkedPath('venv', 'directory')).toBe(true);
		expect(isIgnoredLinkedPath('venv', 'file')).toBe(false);
		expect(isIgnoredLinkedPath('pkg/mod.py', 'file')).toBe(false);
	});
});

describe('linking a folder', () => {
	it('registers a linked plugin and stores only the handle', async () => {
		const { devMode, db, dir } = await setup();
		const plugin = await devMode.linkFolder();
		expect(plugin?.origin).toBe('linked');
		expect(plugin?.linked?.folderName).toBe('my-plugin');
		const record = db.plugins.get(ID)!;
		expect(record.linked?.handleId).toBe(plugin?.linked?.handleId);
		expect(db.handles.get(record.linked!.handleId)?.handle).toBe(dir);
	});

	it('refuses an id that is already installed, and installing over a linked id', async () => {
		const { devMode, registry } = await setup();
		await devMode.linkFolder();
		await expect(devMode.linkFolder()).rejects.toThrow(/already linked/);

		const linked = registry.get(ID)!;
		const zip = zipSync({ 'fplugin.json': strToU8(manifestJson()), 'plugin.py': strToU8('') });
		const prepared = await prepareLocalZipInstall(
			{ arrayBuffer: async () => zip.buffer } as File,
			registry
		);
		expect(prepared.status).toBe('blocked-linked');
		expect(registry.get(ID)).toBe(linked);
	});

	it('removes the handle when the plugin is unlinked', async () => {
		const { devMode, db } = await setup();
		const plugin = (await devMode.linkFolder())!;
		devMode.unlink(ID);
		expect(db.plugins.has(ID)).toBe(false);
		await vi.waitFor(() => expect(db.handles.has(plugin.linked!.handleId)).toBe(false));
	});

	it('reloads a linked plugin from storage with unknown access', async () => {
		const { devMode, db } = await setup();
		await devMode.linkFolder();
		const registry = new PluginRegistry(db as never);
		await registry.ready;
		const plugin = registry.get(ID)!;
		expect(plugin.origin).toBe('linked');
		expect(plugin.linked?.access).toBe('unknown');
	});
});

describe('running a linked plugin', () => {
	it('sends the folder as it is now on every run', async () => {
		const { devMode, coordinator, bridges, tree } = await setup(
			pluginTree({ 'helpers.py': 'X = 1' })
		);
		await devMode.linkFolder();
		await coordinator.activate(ID);
		await coordinator.run(ID);
		expect(sentZipFiles(bridges[0], 0)['helpers.py']).toBe('X = 1');

		tree['helpers.py'] = 'X = 2';
		tree['extra.py'] = 'Y = 3';
		await coordinator.run(ID);
		const second = sentZipFiles(bridges[0], 1);
		expect(second['helpers.py']).toBe('X = 2');
		expect(second['extra.py']).toBe('Y = 3');
	});

	it('picks up new parameters and keeps remembered values', async () => {
		const param = (id: string, def: number) => ({ id, label: id, type: 'number', default: def });
		const { devMode, coordinator, registry, tree } = await setup(
			pluginTree({}, { parameters: [param('a', 1)] } as never)
		);
		await devMode.linkFolder();
		await coordinator.activate(ID);
		registry.get(ID)!.paramValues = { a: 5 };
		tree['fplugin.json'] = manifestJson({
			name: 'Renamed',
			parameters: [param('a', 1), param('b', 2)],
		} as never);
		await coordinator.run(ID);
		const plugin = registry.get(ID)!;
		expect(plugin.manifest.name).toBe('Renamed');
		expect(plugin.paramValues).toEqual({ a: 5, b: 2 });
	});

	it('refuses a folder whose manifest id changed', async () => {
		const { devMode, coordinator, tree } = await setup();
		await devMode.linkFolder();
		await coordinator.activate(ID);
		tree['fplugin.json'] = manifestJson({ id: 'dev.other' });
		await expect(coordinator.run(ID)).rejects.toThrow(/now declares the id "dev.other"/);
	});

	it('marks a moved folder as missing', async () => {
		const { devMode, coordinator, registry, dir } = await setup();
		await devMode.linkFolder();
		dir.missing = true;
		await expect(coordinator.activate(ID)).rejects.toThrow(/can't be found/);
		expect(registry.get(ID)!.linked?.access).toBe('missing');
	});

	it('asks for access and reports a refusal', async () => {
		const { devMode, coordinator, registry, dir } = await setup();
		await devMode.linkFolder();
		dir.permissions.read = 'prompt';
		dir.permissions.onRequest = 'denied';
		await expect(coordinator.activate(ID)).rejects.toThrow(/needs permission/);
		expect(registry.get(ID)!.linked?.access).toBe('denied');
	});

	it('turning dev mode off deactivates and hides linked plugins', async () => {
		const { devMode, coordinator, registry } = await setup();
		await devMode.linkFolder();
		await coordinator.activate(ID);
		await devMode.setEnabled(false);
		const plugin = registry.get(ID)!;
		expect(plugin.enabled).toBe(false);
		expect(plugin.status).toBe('deactivated');
	});
});

describe('dev environment', () => {
	it('keeps the warm worker for code edits and rebuilds it when requirements change', async () => {
		const { devMode, coordinator, bridges, tree } = await setup();
		await devMode.linkFolder();
		await coordinator.activate(ID);
		tree['plugin.py'] = 'def run(ctx): print(2)\n';
		await coordinator.run(ID);
		expect(bridges).toHaveLength(1);

		tree['fplugin.json'] = manifestJson({ requirements: ['numpy'] });
		await coordinator.run(ID);
		expect(bridges).toHaveLength(2);
		expect(bridges[0].terminate).toHaveBeenCalled();
		expect(bridges[1].installPlugin).toHaveBeenCalledWith(ID, ['numpy'], []);
		expect(bridges[1].runPlugin).toHaveBeenCalledTimes(1);
	});

	it('stamps runs as dev with the tier they would get when installed', async () => {
		const { devMode, coordinator, registry } = await setup(
			pluginTree({}, { network: ['api.example.org'] })
		);
		await devMode.linkFolder();
		await coordinator.activate(ID);
		await coordinator.run(ID);
		expect(registry.get(ID)!.logs[0]).toMatch(/· dev \(would run as: custom\)$/);
	});

	it('restarts the environment on request', async () => {
		const { devMode, coordinator, bridges, registry } = await setup();
		await devMode.linkFolder();
		await coordinator.activate(ID);
		await coordinator.restartLinkedEnvironment(ID);
		expect(bridges).toHaveLength(2);
		expect(bridges[0].terminate).toHaveBeenCalled();
		expect(registry.get(ID)!.status).toBe('active');
	});

	it('activating a second linked plugin takes over the dev worker', async () => {
		const { devMode, coordinator, registry, bridges } = await setup();
		await devMode.linkFolder();
		await coordinator.activate(ID);
		const other = memoryDirectory('other', pluginTree({}, { id: 'dev.other' }));
		vi.stubGlobal(
			'showDirectoryPicker',
			vi.fn(async () => other)
		);
		await devMode.linkFolder();
		await coordinator.activate('dev.other');
		expect(registry.get(ID)!.status).toBe('registered');
		expect(bridges[0].terminate).toHaveBeenCalled();
		expect(coordinator.getActivationImpact(ID).evictedPluginIds).toEqual(['dev.other']);
	});

	it('drops the dev worker when dev mode is turned off', async () => {
		const { devMode, coordinator, bridges } = await setup();
		await devMode.linkFolder();
		await coordinator.activate(ID);
		await devMode.setEnabled(false);
		expect(bridges[0].terminate).toHaveBeenCalled();
	});
});

describe('reviewing a linked plugin', () => {
	it('asks before linking and links nothing when declined', async () => {
		const { devMode, registry } = await setup();
		const reviews: LinkedPluginReview[] = [];
		devMode.setReviewer(async (review) => {
			reviews.push(review);
			return false;
		});
		expect(await devMode.linkFolder()).toBeNull();
		expect(reviews.map((r) => r.kind)).toEqual(['link']);
		expect(registry.get(ID)).toBeUndefined();
	});

	it('asks again only when requirements or network change', async () => {
		const { devMode, coordinator, registry, tree, bridges } = await setup();
		await devMode.linkFolder();
		const reviews: LinkedPluginReview[] = [];
		let accept = false;
		devMode.setReviewer(async (review) => {
			reviews.push(review);
			return accept;
		});
		await coordinator.activate(ID);
		tree['plugin.py'] = 'def run(ctx): print(3)\n';
		await coordinator.run(ID);
		expect(reviews).toHaveLength(0);

		tree['fplugin.json'] = manifestJson({ network: ['api.example.org'] });
		await expect(coordinator.run(ID)).rejects.toBeInstanceOf(LinkedPluginChangeDeclinedError);
		expect(registry.get(ID)!.manifest.network).toBeUndefined();
		expect(bridges).toHaveLength(1);

		accept = true;
		await coordinator.run(ID);
		expect(reviews.map((r) => [r.kind, r.previous?.network, r.manifest.network])).toEqual([
			['change', undefined, ['api.example.org']],
			['change', undefined, ['api.example.org']],
		]);
		expect(registry.get(ID)!.manifest.network).toEqual(['api.example.org']);
	});
});

describe('linked plugin errors', () => {
	it('names files by their path in the linked folder', async () => {
		const { devMode, coordinator, registry, bridges } = await setup();
		await devMode.linkFolder();
		await coordinator.activate(ID);
		const error = Object.assign(new Error("NameError: name 'x' is not defined"), {
			traceback:
				'Traceback (most recent call last):\n  File "/plugin_run/helpers.py", line 3, in f\n',
		});
		bridges[0].runPlugin.mockRejectedValueOnce(error);
		await expect(coordinator.run(ID)).rejects.toBe(error);
		expect(registry.get(ID)!.errorTraceback).toContain('File "my-plugin/helpers.py", line 3');
	});
});

describe('creating a plugin in a folder', () => {
	const newManifest = () =>
		buildNewManifest({
			id: ID,
			name: 'Dev Example',
			version: '0.1.0',
			description: '',
			format: 'foldnano_mini',
			applyStrategy: 'replayMutationLog',
			requirements: [],
			network: [],
		});

	it('tells an existing plugin from a folder that needs a manifest', async () => {
		const { devMode } = await setup();
		expect(await devMode.inspectFolder(memoryDirectory('p', pluginTree()))).toEqual({
			kind: 'plugin',
		});
		expect(await devMode.inspectFolder(memoryDirectory('p', { '.git': {} }))).toEqual({
			kind: 'new',
			empty: true,
			hasPluginPy: false,
		});
		expect(await devMode.inspectFolder(memoryDirectory('p', { 'plugin.py': 'x' }))).toEqual({
			kind: 'new',
			empty: false,
			hasPluginPy: true,
		});
	});

	it('writes the starter files, keeps an existing plugin.py, and links the folder', async () => {
		const { devMode, coordinator } = await setup();
		const tree: MemoryTree = { 'plugin.py': 'def run(ctx): pass  # mine\n' };
		const dir = memoryDirectory('new-plugin', tree);
		const plugin = await devMode.createPlugin(dir, newManifest(), { stubs: true });
		expect(plugin.origin).toBe('linked');
		expect(
			JSON.parse(String(new TextDecoder().decode(tree['fplugin.json'] as Uint8Array))).id
		).toBe(ID);
		expect(tree['plugin.py']).toBe('def run(ctx): pass  # mine\n');
		expect(Object.keys(tree)).toContain('.foldnano-stubs');
		expect(Object.keys(tree)).toContain('pyrightconfig.json');

		await coordinator.activate(ID);
		const read = await devMode.readFolder(plugin);
		expect(read.fileNames.sort()).toEqual(['fplugin.json', 'plugin.py']);
	});

	it('asks for write access and refuses without it', async () => {
		const { devMode, registry } = await setup();
		const dir = memoryDirectory('ro', {}, { readwrite: 'prompt', onRequest: 'denied' });
		await expect(devMode.createPlugin(dir, newManifest(), { stubs: false })).rejects.toThrow(
			/permission to write/
		);
		expect(registry.get(ID)).toBeUndefined();
	});

	it('refuses a folder that already has a manifest', async () => {
		const { devMode } = await setup();
		const dir = memoryDirectory('p', pluginTree(), { readwrite: 'granted' });
		await expect(devMode.createPlugin(dir, newManifest(), { stubs: false })).rejects.toThrow(
			/already has an fplugin.json/
		);
	});
});

describe('checkLinkedPluginFolder', () => {
	const check = (tree: MemoryTree) => checkLinkedPluginFolder(memoryDirectory('p', tree));
	const messages = async (tree: MemoryTree, level?: string) =>
		(await check(tree)).filter((i) => !level || i.level === level).map((i) => i.message);

	it('passes a valid plugin and says where it would run', async () => {
		const issues = await check(pluginTree({ '.git': {}, __pycache__: {} }));
		expect(issues.every((i) => i.level === 'info')).toBe(true);
		expect(issues.map((i) => i.message).join('\n')).toMatch(/fplugin.json is valid/);
		expect(issues.map((i) => i.message).join('\n')).toMatch(/standard environment/);
		expect(issues.map((i) => i.message).join('\n')).toMatch(/ignored\): \.git\/, __pycache__\//);
	});

	it('lists independent problems together', async () => {
		const errors = await messages({ 'fplugin.json': '{ nope', 'plugin.py': 'print(1)\n' }, 'error');
		expect(errors).toHaveLength(2);
		expect(errors[0]).toMatch(/no top-level `def run\(ctx\)`/);
		expect(errors[1]).toMatch(/not valid JSON/);
		expect(await messages({}, 'error')).toEqual([
			'No plugin.py at the top of the folder.',
			'No fplugin.json at the top of the folder.',
		]);
	});

	it('reports manifest errors the way install does', async () => {
		expect(await messages(pluginTree({}, { applyStrategy: 'replayMutationLog' }), 'error')).toEqual(
			[expect.stringMatching(/requires format "foldnano_mini"/)]
		);
	});

	it('warns about PyPI packages and wheels nobody installs', async () => {
		const warnings = await messages(
			pluginTree({ 'extra-1.0-py3-none-any.whl': 'w' }, { requirements: ['not-a-dist-pkg'] }),
			'warning'
		);
		expect(warnings[0]).toMatch(/PyPI.*not-a-dist-pkg/);
		expect(warnings[1]).toMatch(/not listed in "requirements".*extra-1.0-py3-none-any.whl/);
		expect(await messages(pluginTree({}, { network: ['api.example.org'] }), 'info')).toContainEqual(
			expect.stringMatching(/custom environment.*network access/)
		);
	});
});
