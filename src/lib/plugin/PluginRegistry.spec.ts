import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/services/storage/indexeddb/FoldnanoIndexedDb', async (importOriginal) => {
	const actual =
		await importOriginal<typeof import('$lib/services/storage/indexeddb/FoldnanoIndexedDb')>();
	return {
		...actual,
		foldnanoIndexedDb: {
			deletePlugin: vi.fn().mockResolvedValue(undefined),
			loadAllPlugins: vi.fn().mockResolvedValue([]),
		},
	};
});

import { PluginRegistry } from './PluginRegistry.svelte';
import { SCRIPT_LAB_ID } from './scriptLabManifest';
import type { FoldnanoIndexedDb } from '$lib/services/storage/indexeddb/FoldnanoIndexedDb';
import type { PluginManifest } from './types';

describe('PluginRegistry', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('registers Script Lab as a built-in plugin on construction', async () => {
		const registry = new PluginRegistry();
		await registry.ready;

		const plugin = registry.get(SCRIPT_LAB_ID);
		expect(plugin).toBeDefined();
		expect(plugin?.origin).toBe('builtin');
		expect(plugin?.manifest.sidePanel?.type).toBe('codeEditor');
	});

	it('does not remove built-in plugins', async () => {
		const registry = new PluginRegistry();
		await registry.ready;

		expect(registry.remove(SCRIPT_LAB_ID)).toBe(false);
		expect(registry.get(SCRIPT_LAB_ID)).toBeDefined();
	});

	it('flags stored pre-zip-format plugins as needs-reinstall on load', async () => {
		const { foldnanoIndexedDb } = await import('$lib/services/storage/indexeddb/FoldnanoIndexedDb');
		vi.mocked(foldnanoIndexedDb.loadAllPlugins).mockResolvedValueOnce([
			{
				id: 'legacy-inline',
				manifest: {
					schemaVersion: 1,
					id: 'legacy-inline',
					name: 'Legacy Inline',
					version: '1.0.0',
					format: 'cadnano_json',
					applyStrategy: 'previewOnly',
					entrypoint: 'def run(ctx): pass',
				},
			},
			{
				id: 'legacy-py-url',
				manifest: {
					schemaVersion: 1,
					id: 'legacy-py-url',
					name: 'Legacy Py URL',
					version: '1.0.0',
					format: 'cadnano_json',
					applyStrategy: 'previewOnly',
					entrypointUrl: '/plugins/legacy/plugin.py',
				},
			},
			{
				id: 'packaged-zip',
				manifest: {
					schemaVersion: 1,
					id: 'packaged-zip',
					name: 'Packaged Zip',
					version: '1.0.0',
					format: 'cadnano_json',
					applyStrategy: 'previewOnly',
					entrypointUrl: '/plugins/packaged/packaged.zip',
				},
			},
		] as never);

		const registry = new PluginRegistry();
		await registry.ready;

		expect(registry.get('legacy-inline')?.status).toBe('needs-reinstall');
		expect(registry.get('legacy-py-url')?.status).toBe('needs-reinstall');
		expect(registry.get('packaged-zip')?.status).toBe('registered');
	});
});

describe('PluginRegistry registerNew/replaceConfirmed', () => {
	const isolatedDbs: FoldnanoIndexedDb[] = [];

	afterEach(async () => {
		for (const db of isolatedDbs.splice(0)) {
			db.close();
			await db.delete();
		}
	});

	async function freshDb(): Promise<FoldnanoIndexedDb> {
		const { FoldnanoIndexedDb } = await import('$lib/services/storage/indexeddb/FoldnanoIndexedDb');
		const db = new FoldnanoIndexedDb(`test-plugin-registry-${crypto.randomUUID()}`);
		isolatedDbs.push(db);
		return db;
	}

	function manifest(id: string, overrides: Partial<PluginManifest> = {}): PluginManifest {
		return {
			schemaVersion: 1,
			id,
			name: id,
			version: '1.0.0',
			format: 'cadnano_json',
			applyStrategy: 'previewOnly',
			entrypoint: 'def run(ctx): pass',
			...overrides,
		};
	}

	it('registers a brand-new plugin id, persisting it and updating the in-memory registry', async () => {
		const db = await freshDb();
		const registry = new PluginRegistry(db);
		registry.setBusyCheck(() => ({ busy: false }));
		await registry.ready;

		await registry.registerNew(manifest('new-plugin'), null);

		expect(registry.get('new-plugin')?.origin).toBe('user');
		const stored = await db.plugins.get('new-plugin');
		expect((stored?.manifest as PluginManifest | undefined)?.id).toBe('new-plugin');
	});

	it('loads manifests stored before versioning as schema version 1', async () => {
		const db = await freshDb();
		const { schemaVersion: _omit, ...unversioned } = manifest('pre-beta', {
			entrypoint: undefined,
			entrypointUrl: '/plugins/pre_beta/pre_beta.zip',
		});
		await db.plugins.put({ id: 'pre-beta', manifest: unversioned });

		const registry = new PluginRegistry(db);
		await registry.ready;

		expect(registry.get('pre-beta')?.manifest.schemaVersion).toBe(1);
		expect(registry.get('pre-beta')?.status).not.toBe('needs-reinstall');
	});

	it('keeps plugins installed before the id and version rules', async () => {
		const db = await freshDb();
		const legacy = manifest('old plugin/1', {
			version: 'latest',
			entrypoint: undefined,
			entrypointUrl: '/plugins/old/old.zip',
		});
		await db.plugins.put({ id: 'old plugin/1', manifest: legacy });

		const registry = new PluginRegistry(db);
		await registry.ready;

		expect(registry.get('old plugin/1')?.manifest.version).toBe('latest');
		expect(registry.get('old plugin/1')?.status).not.toBe('needs-reinstall');
	});

	it('flags manifests stored by a newer app for reinstall', async () => {
		const db = await freshDb();
		await db.plugins.put({ id: 'future', manifest: { ...manifest('future'), schemaVersion: 2 } });

		const registry = new PluginRegistry(db);
		await registry.ready;

		expect(registry.get('future')?.status).toBe('needs-reinstall');
	});

	it('rolls back both tables when the registerNew transaction fails partway through', async () => {
		const db = await freshDb();
		const registry = new PluginRegistry(db);
		registry.setBusyCheck(() => ({ busy: false }));
		await registry.ready;

		const files = {
			id: 'rollback-plugin',
			manifestVersion: '1.0.0',
			wheels: [],
			cachedAt: Date.now(),
		};
		vi.spyOn(db.pluginFiles, 'put').mockRejectedValueOnce(new Error('simulated failure'));

		await expect(registry.registerNew(manifest('rollback-plugin'), files)).rejects.toThrow(
			'simulated failure'
		);

		expect(registry.get('rollback-plugin')).toBeUndefined();
		expect(await db.plugins.get('rollback-plugin')).toBeUndefined();
		expect(await db.pluginFiles.get('rollback-plugin')).toBeUndefined();
	});

	it('rolls back a failed replaceConfirmed, leaving the previous records unchanged', async () => {
		const db = await freshDb();
		const registry = new PluginRegistry(db);
		registry.setBusyCheck(() => ({ busy: false }));
		await registry.ready;

		const originalFiles = {
			id: 'replace-plugin',
			manifestVersion: '1.0.0',
			wheels: [],
			cachedAt: 1,
		};
		await registry.registerNew(manifest('replace-plugin', { version: '1.0.0' }), originalFiles);
		const beforePlugins = await db.plugins.get('replace-plugin');
		const beforeFiles = await db.pluginFiles.get('replace-plugin');

		vi.spyOn(db.pluginFiles, 'put').mockRejectedValueOnce(new Error('simulated failure'));

		await expect(
			registry.replaceConfirmed(manifest('replace-plugin', { version: '2.0.0' }), originalFiles)
		).rejects.toThrow('simulated failure');

		expect(await db.plugins.get('replace-plugin')).toEqual(beforePlugins);
		expect(await db.pluginFiles.get('replace-plugin')).toEqual(beforeFiles);
		expect(registry.get('replace-plugin')?.manifest.version).toBe('1.0.0');
	});

	it('refuses to replace a built-in plugin', async () => {
		const db = await freshDb();
		const registry = new PluginRegistry(db);
		registry.setBusyCheck(() => ({ busy: false }));
		await registry.ready;

		await expect(registry.replaceConfirmed(manifest(SCRIPT_LAB_ID), null)).rejects.toThrow(
			/built-in/
		);
		expect(await db.plugins.get(SCRIPT_LAB_ID)).toBeUndefined();
	});

	it('replaces an existing user plugin end to end', async () => {
		const db = await freshDb();
		const registry = new PluginRegistry(db);
		registry.setBusyCheck(() => ({ busy: false }));
		await registry.ready;

		await registry.registerNew(manifest('user-plugin', { version: '1.0.0' }), null);
		await registry.replaceConfirmed(manifest('user-plugin', { version: '2.0.0' }), null);

		expect(registry.get('user-plugin')?.manifest.version).toBe('2.0.0');
		const stored = await db.plugins.get('user-plugin');
		expect((stored?.manifest as PluginManifest | undefined)?.version).toBe('2.0.0');
	});

	it('clears cached files when a packaged plugin is replaced with a codeless one', async () => {
		const db = await freshDb();
		const registry = new PluginRegistry(db);
		registry.setBusyCheck(() => ({ busy: false }));
		await registry.ready;

		const files = { id: 'packaged-plugin', manifestVersion: '1.0.0', wheels: [], cachedAt: 1 };
		await registry.registerNew(manifest('packaged-plugin', { version: '1.0.0' }), files);
		expect(await db.pluginFiles.get('packaged-plugin')).toBeDefined();

		await registry.replaceConfirmed(manifest('packaged-plugin', { version: '2.0.0' }), null);

		expect(await db.pluginFiles.get('packaged-plugin')).toBeUndefined();
	});

	it('refuses registerNew when the busy check reports busy, without writing to storage', async () => {
		const db = await freshDb();
		const registry = new PluginRegistry(db);
		registry.setBusyCheck(() => ({ busy: true, reason: 'currently running' }));
		await registry.ready;

		await expect(registry.registerNew(manifest('busy-plugin'), null)).rejects.toThrow(
			/currently running/
		);
		expect(await db.plugins.get('busy-plugin')).toBeUndefined();
	});

	it('refuses replaceConfirmed when the busy check reports busy, without writing to storage', async () => {
		const db = await freshDb();
		const registry = new PluginRegistry(db);
		registry.setBusyCheck(() => ({ busy: false }));
		await registry.ready;
		await registry.registerNew(manifest('later-busy-plugin', { version: '1.0.0' }), null);
		const before = await db.plugins.get('later-busy-plugin');

		const busyRegistry = new PluginRegistry(db);
		busyRegistry.setBusyCheck(() => ({ busy: true, reason: 'has an unapplied result' }));
		await busyRegistry.ready;

		await expect(
			busyRegistry.replaceConfirmed(manifest('later-busy-plugin', { version: '2.0.0' }), null)
		).rejects.toThrow(/has an unapplied result/);
		expect(await db.plugins.get('later-busy-plugin')).toEqual(before);
	});

	it('lets only one of two concurrent registerNew calls for the same id succeed', async () => {
		const db = await freshDb();
		const registry = new PluginRegistry(db);
		registry.setBusyCheck(() => ({ busy: false }));
		await registry.ready;

		const first = registry.registerNew(manifest('race-plugin', { version: '1.0.0' }), null);
		const second = registry.registerNew(manifest('race-plugin', { version: '2.0.0' }), null);

		const results = await Promise.allSettled([first, second]);

		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
		expect(registry.all.filter((p) => p.manifest.id === 'race-plugin')).toHaveLength(1);
	});

	it('fails closed when registerNew is called without a busy check configured', async () => {
		const db = await freshDb();
		const registry = new PluginRegistry(db);
		await registry.ready;

		await expect(registry.registerNew(manifest('unwired-plugin'), null)).rejects.toThrow(
			/registry busy-check is not configured/
		);
		expect(await db.plugins.get('unwired-plugin')).toBeUndefined();
	});

	it('fails closed when replaceConfirmed is called without a busy check configured', async () => {
		const db = await freshDb();
		await db.plugins.add({
			id: 'preseeded-plugin',
			manifest: manifest('preseeded-plugin') as unknown as object,
		});
		const registry = new PluginRegistry(db);
		await registry.ready;

		await expect(
			registry.replaceConfirmed(manifest('preseeded-plugin', { version: '2.0.0' }), null)
		).rejects.toThrow(/registry busy-check is not configured/);
		const stored = await db.plugins.get('preseeded-plugin');
		expect((stored?.manifest as PluginManifest | undefined)?.version).toBe('1.0.0');
	});

	it('refuses to configure the busy check a second time', async () => {
		const db = await freshDb();
		const registry = new PluginRegistry(db);
		registry.setBusyCheck(() => ({ busy: false }));
		await registry.ready;

		expect(() => registry.setBusyCheck(() => ({ busy: false }))).toThrow(/already configured/);
	});

	it('rejects registerNew for an id that is already registered, without writing', async () => {
		const db = await freshDb();
		const registry = new PluginRegistry(db);
		registry.setBusyCheck(() => ({ busy: false }));
		await registry.ready;
		await registry.registerNew(manifest('dup-plugin', { version: '1.0.0' }), null);

		const writeSpy = vi.spyOn(db, 'saveInstalledPlugin');
		await expect(
			registry.registerNew(manifest('dup-plugin', { version: '2.0.0' }), null)
		).rejects.toThrow(/already registered/);

		expect(writeSpy).not.toHaveBeenCalled();
		expect(registry.get('dup-plugin')?.manifest.version).toBe('1.0.0');
	});

	it('rejects replaceConfirmed for an id that was never registered', async () => {
		const db = await freshDb();
		const registry = new PluginRegistry(db);
		registry.setBusyCheck(() => ({ busy: false }));
		await registry.ready;

		await expect(registry.replaceConfirmed(manifest('never-existed'), null)).rejects.toThrow(
			/Cannot replace "never-existed" because it is not installed/
		);
	});
});

describe('PluginRegistry isPluginBusyForInstall', () => {
	const isolatedDbs: FoldnanoIndexedDb[] = [];

	afterEach(async () => {
		for (const db of isolatedDbs.splice(0)) {
			db.close();
			await db.delete();
		}
	});

	async function freshDb(): Promise<FoldnanoIndexedDb> {
		const { FoldnanoIndexedDb } = await import('$lib/services/storage/indexeddb/FoldnanoIndexedDb');
		const db = new FoldnanoIndexedDb(`test-busy-for-install-${crypto.randomUUID()}`);
		isolatedDbs.push(db);
		return db;
	}

	it('fails closed when no busy check is configured', async () => {
		const registry = new PluginRegistry();
		await registry.ready;

		expect(registry.isPluginBusyForInstall('any-id')).toEqual({
			busy: true,
			reason: 'registry busy-check is not configured',
		});
	});

	it('delegates to the configured busy check', async () => {
		const registry = new PluginRegistry();
		registry.setBusyCheck(() => ({ busy: true, reason: 'currently running' }));
		await registry.ready;

		expect(registry.isPluginBusyForInstall('any-id')).toEqual({
			busy: true,
			reason: 'currently running',
		});
	});

	it('reports busy while a registerNew reservation is in flight, and the concurrent write is refused', async () => {
		const db = await freshDb();
		const registry = new PluginRegistry(db);
		registry.setBusyCheck(() => ({ busy: false }));
		await registry.ready;

		const pluginManifest: PluginManifest = {
			schemaVersion: 1,
			id: 'reserved-for-install',
			name: 'reserved-for-install',
			version: '1.0.0',
			format: 'cadnano_json',
			applyStrategy: 'previewOnly',
			entrypoint: 'def run(ctx): pass',
		};

		let resolveWrite!: () => void;
		vi.spyOn(db, 'saveInstalledPlugin').mockReturnValue(
			new Promise((resolve) => {
				resolveWrite = resolve;
			})
		);

		const registerPromise = registry.registerNew(pluginManifest, null);

		expect(registry.isPluginBusyForInstall('reserved-for-install')).toEqual({
			busy: true,
			reason: 'plugin installation or replacement is already in progress',
		});
		await expect(registry.registerNew(pluginManifest, null)).rejects.toThrow(
			'Cannot install or replace plugin "reserved-for-install": plugin installation or replacement is already in progress.'
		);

		resolveWrite();
		await registerPromise;
	});

	it('permits registration when idle', async () => {
		const registry = new PluginRegistry();
		registry.setBusyCheck(() => ({ busy: false }));
		await registry.ready;

		expect(registry.isPluginBusyForInstall('any-id')).toEqual({ busy: false });
	});
});

describe('PluginRegistry owned plugins', () => {
	function makeDb() {
		return {
			loadAllPlugins: vi.fn().mockResolvedValue([]),
			saveInstalledPlugin: vi.fn().mockResolvedValue(undefined),
			updatePluginRecord: vi.fn().mockResolvedValue(undefined),
			deletePlugin: vi.fn().mockResolvedValue(undefined),
			deletePluginFiles: vi.fn().mockResolvedValue(undefined),
		};
	}

	function makeOwnedManifest(version = '1.0.0'): PluginManifest {
		return {
			schemaVersion: 1,
			id: 'local.abc12345',
			name: 'Mine',
			version,
			format: 'foldnano_mini',
			applyStrategy: 'replayMutationLog',
		};
	}

	async function makeRegistry(db = makeDb()) {
		const registry = new PluginRegistry(db as unknown as FoldnanoIndexedDb);
		registry.setBusyCheck(() => ({ busy: false }));
		await registry.ready;
		return { registry, db };
	}

	it('stores ownership on the record, not the manifest', async () => {
		const { registry, db } = await makeRegistry();
		const plugin = await registry.registerNew(makeOwnedManifest(), null, {
			authoring: { source: 'scriptLab' },
		});
		expect(plugin.authoring).toEqual({ source: 'scriptLab' });
		expect(db.saveInstalledPlugin.mock.calls[0][0]).toMatchObject({
			id: 'local.abc12345',
			authoring: { source: 'scriptLab' },
		});
	});

	it('keeps ownership and the draft when an owned plugin is replaced', async () => {
		const { registry, db } = await makeRegistry();
		const first = await registry.registerNew(makeOwnedManifest(), null, {
			authoring: { source: 'scriptLab' },
		});
		first.draftCode = 'draft';
		const { buildPluginZip, pluginFilesRecord } = await import('./ownedPlugins');
		const next = makeOwnedManifest('1.0.1');
		const replaced = await registry.replaceConfirmed(
			next,
			pluginFilesRecord(next, buildPluginZip(next, 'def run(ctx): pass'))
		);
		expect(replaced.authoring).toEqual({ source: 'scriptLab' });
		expect(replaced.draftCode).toBe('draft');
		expect(db.saveInstalledPlugin.mock.calls[1][0]).toMatchObject({ draftCode: 'draft' });
	});

	it('clears the draft when an owned version is saved', async () => {
		const { registry, db } = await makeRegistry();
		const first = await registry.registerNew(makeOwnedManifest(), null, {
			authoring: { source: 'scriptLab' },
		});
		first.draftCode = 'draft';
		const saved = await registry.saveOwnedVersion(makeOwnedManifest('1.0.1'), {
			id: 'local.abc12345',
			manifestVersion: '1.0.1',
			wheels: [],
			cachedAt: 0,
		});
		expect(saved.draftCode).toBeNull();
		expect(saved.manifest.version).toBe('1.0.1');
		expect(db.saveInstalledPlugin.mock.calls[1][0]).not.toHaveProperty('draftCode');
	});

	it('refuses owned saves and drafts for plugins not made here', async () => {
		const { registry } = await makeRegistry();
		await registry.registerNew(makeOwnedManifest(), null);
		await expect(
			registry.saveOwnedVersion(makeOwnedManifest('1.0.1'), {
				id: 'local.abc12345',
				manifestVersion: '1.0.1',
				wheels: [],
				cachedAt: 0,
			})
		).rejects.toThrow(/not made in this browser/);
		await expect(registry.persistDraft('local.abc12345', 'x')).rejects.toThrow();
	});

	it('restores ownership and the draft from storage', async () => {
		const db = makeDb();
		db.loadAllPlugins.mockResolvedValueOnce([
			{
				id: 'local.abc12345',
				manifest: makeOwnedManifest(),
				authoring: { source: 'scriptLab', lastExportedVersion: '1.0.0' },
				draftCode: 'draft',
			},
		]);
		const { registry } = await makeRegistry(db);
		const plugin = registry.get('local.abc12345');
		expect(plugin?.authoring).toEqual({ source: 'scriptLab', lastExportedVersion: '1.0.0' });
		expect(plugin?.draftCode).toBe('draft');
	});

	it('records the exported version', async () => {
		const { registry, db } = await makeRegistry();
		await registry.registerNew(makeOwnedManifest(), null, { authoring: { source: 'scriptLab' } });
		await registry.markExported('local.abc12345', '1.0.0');
		expect(registry.get('local.abc12345')?.authoring?.lastExportedVersion).toBe('1.0.0');
		expect(db.updatePluginRecord).toHaveBeenCalledWith('local.abc12345', {
			authoring: { source: 'scriptLab', lastExportedVersion: '1.0.0' },
		});
	});
});

describe('PluginRegistry owned plugins against a real database', () => {
	const dbs: FoldnanoIndexedDb[] = [];

	afterEach(async () => {
		for (const db of dbs.splice(0)) {
			db.close();
			await db.delete();
		}
	});

	async function freshDb(name = `test-owned-${crypto.randomUUID()}`): Promise<FoldnanoIndexedDb> {
		const { FoldnanoIndexedDb } = await import('$lib/services/storage/indexeddb/FoldnanoIndexedDb');
		const db = new FoldnanoIndexedDb(name);
		dbs.push(db);
		return db;
	}

	async function registryOn(db: FoldnanoIndexedDb): Promise<PluginRegistry> {
		const registry = new PluginRegistry(db);
		registry.setBusyCheck(() => ({ busy: false }));
		await registry.ready;
		return registry;
	}

	async function ownedPackage(version: string, code: string, extra: Record<string, string> = {}) {
		const { buildOwnedManifest, pluginFilesRecord } = await import('./ownedPlugins');
		const { zipSync, strToU8 } = await import('fflate');
		const manifest = buildOwnedManifest({
			id: 'local.abc12345',
			name: 'Mine',
			version,
			requirements: [],
		});
		const zip = zipSync({
			'fplugin.json': strToU8(JSON.stringify(manifest)),
			'plugin.py': strToU8(code),
			...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, strToU8(v)])),
		});
		return { manifest, files: pluginFilesRecord(manifest, zip) };
	}

	it('refuses a save from a tab whose loaded version is stale', async () => {
		const name = `test-owned-${crypto.randomUUID()}`;
		const dbA = await freshDb(name);
		const tabA = await registryOn(dbA);
		const v100 = await ownedPackage('1.0.0', 'v100');
		await tabA.registerNew(v100.manifest, v100.files, { authoring: { source: 'scriptLab' } });

		const { FoldnanoIndexedDb, PluginVersionConflictError } =
			await import('$lib/services/storage/indexeddb/FoldnanoIndexedDb');
		const dbB = new FoldnanoIndexedDb(name);
		const tabB = await registryOn(dbB);

		for (const version of ['1.0.1', '1.0.2']) {
			const next = await ownedPackage(version, version);
			await tabA.saveOwnedVersion(next.manifest, next.files);
		}
		const stale = await ownedPackage('1.0.1', 'stale');
		await expect(tabB.saveOwnedVersion(stale.manifest, stale.files)).rejects.toBeInstanceOf(
			PluginVersionConflictError
		);
		dbB.close();

		const stored = await dbA.loadPluginFiles('local.abc12345');
		expect(stored?.manifestVersion).toBe('1.0.2');
	});

	it('ends ownership when replaced by a package the editor would strip', async () => {
		const registry = await registryOn(await freshDb());
		const v100 = await ownedPackage('1.0.0', 'v100');
		const plugin = await registry.registerNew(v100.manifest, v100.files, {
			authoring: { source: 'scriptLab' },
		});
		plugin.draftCode = 'draft';

		const multiFile = await ownedPackage('1.1.0', 'import helper', { 'helper.py': 'x = 1' });
		const replaced = await registry.replaceConfirmed(multiFile.manifest, multiFile.files);
		expect(replaced.authoring).toBeNull();
		expect(replaced.draftCode).toBeNull();
	});

	it('keeps ownership and the draft when replaced by an editable package', async () => {
		const registry = await registryOn(await freshDb());
		const v100 = await ownedPackage('1.0.0', 'v100');
		const plugin = await registry.registerNew(v100.manifest, v100.files, {
			authoring: { source: 'scriptLab' },
		});
		plugin.draftCode = 'draft';

		const next = await ownedPackage('1.0.0', 'same version, new code');
		const replaced = await registry.replaceConfirmed(next.manifest, next.files);
		expect(replaced.authoring).toEqual({ source: 'scriptLab' });
		expect(replaced.draftCode).toBe('draft');
	});
});
