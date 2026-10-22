import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/errorReporting', () => ({
	reportError: vi.fn(),
}));

import { PluginInstallGate } from './PluginInstallGate.svelte';
import { PluginRegistry } from '$lib/plugin/PluginRegistry.svelte';
import { FoldnanoIndexedDb } from '$lib/services/storage/indexeddb/FoldnanoIndexedDb';
import { InvalidOperationError } from '$lib/errors';
import { reportError } from '$lib/errorReporting';
import type { PluginManifest } from '$lib/plugin/types';

const reportErrorMock = vi.mocked(reportError);

function makeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
	return {
		schemaVersion: 1,
		id: 'demo-plugin',
		name: 'Demo Plugin',
		version: '1.0.0',
		format: 'cadnano_json',
		applyStrategy: 'previewOnly',
		entrypoint: 'def run(ctx): pass',
		...overrides,
	};
}

function deferredWrite() {
	let resolve!: () => void;
	const promise = new Promise<void>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

function makeRegistry(
	overrides: {
		registerNew?: ReturnType<typeof vi.fn>;
		replaceConfirmed?: ReturnType<typeof vi.fn>;
		isPluginBusyForInstall?: (id: string) => { busy: boolean; reason?: string };
	} = {}
) {
	return {
		registerNew: overrides.registerNew ?? vi.fn().mockResolvedValue(undefined),
		replaceConfirmed: overrides.replaceConfirmed ?? vi.fn().mockResolvedValue(undefined),
		isPluginBusyForInstall: overrides.isPluginBusyForInstall ?? (() => ({ busy: false })),
	};
}

describe('PluginInstallGate', () => {
	beforeEach(() => {
		reportErrorMock.mockClear();
	});

	it('resolves installed only after registerNew resolves for a ready result', async () => {
		const write = deferredWrite();
		const registerNew = vi.fn().mockReturnValue(write.promise);
		const registry = makeRegistry({ registerNew });
		const gate = new PluginInstallGate(() => registry);
		const manifest = makeManifest();

		const outcomePromise = gate.requestInstall(async () => ({
			status: 'ready',
			manifest,
			files: null,
		}));

		let settled = false;
		outcomePromise.then(() => {
			settled = true;
		});
		await Promise.resolve();
		await Promise.resolve();
		expect(settled).toBe(false);

		write.resolve();
		const outcome = await outcomePromise;

		expect(outcome).toEqual({ status: 'installed', manifest });
		expect(registerNew).toHaveBeenCalledWith(manifest, null);
		expect(reportErrorMock).not.toHaveBeenCalled();
	});

	it('resolves error and reports it once (silently) when prepare() rejects, leaving pending untouched', async () => {
		const gate = new PluginInstallGate(() => makeRegistry());

		const outcome = await gate.requestInstall(async () => {
			throw new Error('zip parse failed');
		});

		expect(outcome).toEqual({ status: 'error', message: 'zip parse failed' });
		expect(gate.pending).toBeNull();
		expect(reportErrorMock).toHaveBeenCalledTimes(1);
		expect(reportErrorMock).toHaveBeenCalledWith(expect.any(Error), 'plugin:install', {
			notify: false,
		});
		expect(reportErrorMock.mock.calls[0][0]).toMatchObject({ message: 'zip parse failed' });
	});

	it('resolves error and reports it once (silently) when the registerNew commit fails, without stranding pending', async () => {
		const registerNew = vi.fn().mockRejectedValue(new Error('write failed'));
		const gate = new PluginInstallGate(() => makeRegistry({ registerNew }));
		const manifest = makeManifest();

		const outcome = await gate.requestInstall(async () => ({
			status: 'ready',
			manifest,
			files: null,
		}));

		expect(outcome).toEqual({ status: 'error', message: 'write failed' });
		expect(gate.pending).toBeNull();
		expect(reportErrorMock).toHaveBeenCalledTimes(1);
		expect(reportErrorMock).toHaveBeenCalledWith(expect.any(Error), 'plugin:install', {
			notify: false,
		});
	});

	it('reports a built-in collision as an InvalidOperationError and resolves blocked, without any registry write', async () => {
		const registerNew = vi.fn();
		const replaceConfirmed = vi.fn();
		const gate = new PluginInstallGate(() => makeRegistry({ registerNew, replaceConfirmed }));

		const outcome = await gate.requestInstall(async () => ({
			status: 'blocked-builtin',
			message: '"script-lab" is a built-in plugin and cannot be replaced.',
		}));

		expect(outcome).toEqual({ status: 'blocked' });
		expect(registerNew).not.toHaveBeenCalled();
		expect(replaceConfirmed).not.toHaveBeenCalled();
		expect(reportErrorMock).toHaveBeenCalledTimes(1);
		expect(reportErrorMock).toHaveBeenCalledWith(
			expect.any(InvalidOperationError),
			'plugin:install'
		);
		expect(reportErrorMock.mock.calls[0][0]).toMatchObject({
			message: '"script-lab" is a built-in plugin and cannot be replaced.',
		});
	});

	it('reports a busy collision as an InvalidOperationError and resolves blocked, without any registry write', async () => {
		const registerNew = vi.fn();
		const replaceConfirmed = vi.fn();
		const gate = new PluginInstallGate(() => makeRegistry({ registerNew, replaceConfirmed }));

		const outcome = await gate.requestInstall(async () => ({
			status: 'blocked-busy',
			message: 'Cannot install "demo-plugin": currently running.',
		}));

		expect(outcome).toEqual({ status: 'blocked' });
		expect(registerNew).not.toHaveBeenCalled();
		expect(replaceConfirmed).not.toHaveBeenCalled();
		expect(reportErrorMock).toHaveBeenCalledTimes(1);
		expect(reportErrorMock).toHaveBeenCalledWith(
			expect.any(InvalidOperationError),
			'plugin:install'
		);
		expect(reportErrorMock.mock.calls[0][0]).toMatchObject({
			message: 'Cannot install "demo-plugin": currently running.',
		});
	});

	it('with review, parks a ready install until confirmPending() registers it via registerNew', async () => {
		const registerNew = vi.fn().mockResolvedValue(undefined);
		const replaceConfirmed = vi.fn();
		const gate = new PluginInstallGate(() => makeRegistry({ registerNew, replaceConfirmed }));
		const manifest = makeManifest({ network: ['api.example.org'] });

		const outcomePromise = gate.requestInstall(
			async () => ({ status: 'ready', manifest, files: null }),
			{ review: true }
		);
		await Promise.resolve();
		await Promise.resolve();
		expect(gate.pending).toEqual({
			incoming: manifest,
			files: null,
			existing: null,
			restorable: false,
		});
		expect(registerNew).not.toHaveBeenCalled();

		await gate.confirmPending();

		expect(await outcomePromise).toEqual({ status: 'installed', manifest });
		expect(registerNew).toHaveBeenCalledWith(manifest, null);
		expect(replaceConfirmed).not.toHaveBeenCalled();
	});

	it('with review, cancelling writes nothing', async () => {
		const registerNew = vi.fn();
		const gate = new PluginInstallGate(() => makeRegistry({ registerNew }));

		const outcomePromise = gate.requestInstall(
			async () => ({ status: 'ready', manifest: makeManifest(), files: null }),
			{ review: true }
		);
		await Promise.resolve();
		await Promise.resolve();
		gate.cancelPending();

		expect(await outcomePromise).toEqual({ status: 'cancelled' });
		expect(registerNew).not.toHaveBeenCalled();
	});

	it('parks needs-confirm until confirmPending() resolves it via replaceConfirmed, not registerNew', async () => {
		const registerNew = vi.fn();
		const replaceConfirmed = vi.fn().mockResolvedValue(undefined);
		const gate = new PluginInstallGate(() => makeRegistry({ registerNew, replaceConfirmed }));
		const incoming = makeManifest({ version: '2.0.0' });
		const existing = makeManifest({ version: '1.0.0' });

		const outcomePromise = gate.requestInstall(async () => ({
			status: 'needs-confirm',
			incoming,
			files: null,
			existing,
		}));

		let settled = false;
		outcomePromise.then(() => {
			settled = true;
		});
		await Promise.resolve();
		await Promise.resolve();
		expect(settled).toBe(false);
		expect(gate.pending).toEqual({ incoming, files: null, existing, restorable: false });

		await gate.confirmPending();
		const outcome = await outcomePromise;

		expect(outcome).toEqual({ status: 'installed', manifest: incoming });
		expect(gate.pending).toBeNull();
		expect(replaceConfirmed).toHaveBeenCalledTimes(1);
		expect(replaceConfirmed).toHaveBeenCalledWith(incoming, null);
		expect(registerNew).not.toHaveBeenCalled();
		expect(reportErrorMock).not.toHaveBeenCalled();
	});

	it('resolves error and reports it once (silently) when replaceConfirmed rejects, clears pending, and releases the gate for a later install', async () => {
		const replaceConfirmed = vi.fn().mockRejectedValue(new Error('replace failed'));
		const gate = new PluginInstallGate(() => makeRegistry({ replaceConfirmed }));
		const incoming = makeManifest({ version: '2.0.0' });
		const existing = makeManifest({ version: '1.0.0' });

		const outcomePromise = gate.requestInstall(async () => ({
			status: 'needs-confirm',
			incoming,
			files: null,
			existing,
		}));
		await Promise.resolve();
		await Promise.resolve();

		await gate.confirmPending();
		const outcome = await outcomePromise;

		expect(outcome).toEqual({ status: 'error', message: 'replace failed' });
		expect(gate.pending).toBeNull();
		expect(reportErrorMock).toHaveBeenCalledTimes(1);
		expect(reportErrorMock).toHaveBeenCalledWith(expect.any(Error), 'plugin:install', {
			notify: false,
		});

		const nextManifest = makeManifest({ id: 'other-plugin' });
		const nextOutcome = await gate.requestInstall(async () => ({
			status: 'ready',
			manifest: nextManifest,
			files: null,
		}));
		expect(nextOutcome).toEqual({ status: 'installed', manifest: nextManifest });
	});

	it('resolves error and reports it once (silently) when the confirmation-time busy check throws, clears pending, and releases the gate', async () => {
		const isPluginBusyForInstall = vi.fn().mockImplementation(() => {
			throw new Error('busy check failed');
		});
		const gate = new PluginInstallGate(() => makeRegistry({ isPluginBusyForInstall }));
		const incoming = makeManifest({ version: '2.0.0' });
		const existing = makeManifest({ version: '1.0.0' });

		const outcomePromise = gate.requestInstall(async () => ({
			status: 'needs-confirm',
			incoming,
			files: null,
			existing,
		}));
		await Promise.resolve();
		await Promise.resolve();

		await gate.confirmPending();
		const outcome = await outcomePromise;

		expect(outcome).toEqual({ status: 'error', message: 'busy check failed' });
		expect(gate.pending).toBeNull();
		expect(reportErrorMock).toHaveBeenCalledTimes(1);
		expect(reportErrorMock).toHaveBeenCalledWith(expect.any(Error), 'plugin:install', {
			notify: false,
		});

		const nextManifest = makeManifest({ id: 'other-plugin' });
		const nextOutcome = await gate.requestInstall(async () => ({
			status: 'ready',
			manifest: nextManifest,
			files: null,
		}));
		expect(nextOutcome).toEqual({ status: 'installed', manifest: nextManifest });
	});

	it('resolves cancelled and clears pending when cancelPending() is called, without any registry write or report', async () => {
		const registerNew = vi.fn();
		const replaceConfirmed = vi.fn();
		const gate = new PluginInstallGate(() => makeRegistry({ registerNew, replaceConfirmed }));
		const incoming = makeManifest({ version: '2.0.0' });
		const existing = makeManifest({ version: '1.0.0' });

		const outcomePromise = gate.requestInstall(async () => ({
			status: 'needs-confirm',
			incoming,
			files: null,
			existing,
		}));
		await Promise.resolve();
		await Promise.resolve();

		gate.cancelPending();
		const outcome = await outcomePromise;

		expect(outcome).toEqual({ status: 'cancelled' });
		expect(gate.pending).toBeNull();
		expect(registerNew).not.toHaveBeenCalled();
		expect(replaceConfirmed).not.toHaveBeenCalled();
		expect(reportErrorMock).not.toHaveBeenCalled();
	});

	it('refuses a second concurrent requestInstall() while the first is still preparing, reporting the refusal once (silently)', async () => {
		const firstPrepare = deferredWrite();
		const secondPrepare = vi.fn();
		const gate = new PluginInstallGate(() => makeRegistry());
		const manifest = makeManifest();

		const firstPromise = gate.requestInstall(async () => {
			await firstPrepare.promise;
			return { status: 'ready', manifest, files: null };
		});

		const secondOutcome = await gate.requestInstall(secondPrepare);

		expect(secondOutcome).toEqual({
			status: 'error',
			message: 'Another plugin install is already in progress.',
		});
		expect(secondPrepare).not.toHaveBeenCalled();
		expect(gate.pending).toBeNull();
		expect(reportErrorMock).toHaveBeenCalledTimes(1);
		expect(reportErrorMock).toHaveBeenCalledWith(expect.any(Error), 'plugin:install', {
			notify: false,
		});

		firstPrepare.resolve();
		const firstOutcome = await firstPromise;
		expect(firstOutcome).toEqual({ status: 'installed', manifest });
	});
});

describe('PluginInstallGate confirmPending() passes IndexedDB-cloneable data to replaceConfirmed()', () => {
	beforeEach(() => {
		reportErrorMock.mockClear();
	});

	it('does not pass a reactive $state proxy to replaceConfirmed()', async () => {
		const replaceConfirmed = vi.fn().mockResolvedValue(undefined);
		const gate = new PluginInstallGate(() => makeRegistry({ replaceConfirmed }));
		const incoming = makeManifest({ version: '2.0.0' });
		const existing = makeManifest({ version: '1.0.0' });
		const files = {
			id: incoming.id,
			manifestVersion: incoming.version,
			wheels: [{ url: 'dep-1.0-py3-none-any.whl', data: new Uint8Array([1, 2, 3]) }],
			cachedAt: 1,
		};

		const outcomePromise = gate.requestInstall(async () => ({
			status: 'needs-confirm',
			incoming,
			files,
			existing,
		}));
		await Promise.resolve();
		await Promise.resolve();

		await gate.confirmPending();
		await outcomePromise;

		expect(replaceConfirmed).toHaveBeenCalledTimes(1);
		const [passedManifest, passedFiles] = replaceConfirmed.mock.calls[0];
		// IndexedDB cannot structured-clone Svelte state proxies.
		expect(() => structuredClone(passedManifest)).not.toThrow();
		expect(() => structuredClone(passedFiles)).not.toThrow();
		expect(passedManifest).toEqual(incoming);
		expect(passedFiles).toEqual(files);
	});
});

describe('PluginInstallGate confirmation-time busy re-check (real PluginRegistry)', () => {
	const isolatedDbs: FoldnanoIndexedDb[] = [];

	beforeEach(() => {
		reportErrorMock.mockClear();
	});

	afterEach(async () => {
		for (const db of isolatedDbs.splice(0)) {
			db.close();
			await db.delete();
		}
	});

	it('refuses confirmPending() when the plugin became busy while the dialog was open, reporting once', async () => {
		const db = new FoldnanoIndexedDb(`test-install-gate-${crypto.randomUUID()}`);
		isolatedDbs.push(db);
		const registry = new PluginRegistry(db);
		let busy = false;
		registry.setBusyCheck(() =>
			busy ? { busy: true, reason: 'currently running' } : { busy: false }
		);
		await registry.ready;

		const existingManifest = makeManifest({ version: '1.0.0' });
		await registry.registerNew(existingManifest, null);

		const gate = new PluginInstallGate(() => registry);
		const incoming = makeManifest({ version: '2.0.0' });

		const outcomePromise = gate.requestInstall(async () => ({
			status: 'needs-confirm',
			incoming,
			files: null,
			existing: existingManifest,
		}));
		await Promise.resolve();
		await Promise.resolve();

		busy = true; // the plugin started running while the confirmation dialog was open
		await gate.confirmPending();
		const outcome = await outcomePromise;

		expect(outcome).toEqual({ status: 'blocked' });
		expect(registry.get('demo-plugin')?.manifest.version).toBe('1.0.0');
		expect(reportErrorMock).toHaveBeenCalledTimes(1);
		expect(reportErrorMock).toHaveBeenCalledWith(
			expect.any(InvalidOperationError),
			'plugin:install'
		);
		expect(reportErrorMock.mock.calls[0][0]).toMatchObject({
			message: 'Cannot install "demo-plugin": currently running.',
		});
	});

	it('replaces an existing plugin end to end against a real IndexedDB write, persisting cloneable manifest and zip data', async () => {
		const db = new FoldnanoIndexedDb(`test-install-gate-replace-${crypto.randomUUID()}`);
		isolatedDbs.push(db);
		const registry = new PluginRegistry(db);
		registry.setBusyCheck(() => ({ busy: false }));
		await registry.ready;

		const existingManifest = makeManifest({ version: '1.0.0' });
		await registry.registerNew(existingManifest, null);

		const gate = new PluginInstallGate(() => registry);
		const incoming = makeManifest({ version: '2.0.0' });
		const zipData = new Uint8Array([80, 75, 3, 4, 1, 2, 3, 4]);
		const files = {
			id: incoming.id,
			manifestVersion: incoming.version,
			entrypointZipData: zipData,
			wheels: [],
			cachedAt: Date.now(),
		};

		const outcomePromise = gate.requestInstall(async () => ({
			status: 'needs-confirm',
			incoming,
			files,
			existing: existingManifest,
		}));
		await Promise.resolve();
		await Promise.resolve();

		await gate.confirmPending();
		const outcome = await outcomePromise;

		expect(outcome).toEqual({ status: 'installed', manifest: incoming });
		expect(registry.get('demo-plugin')?.manifest.version).toBe('2.0.0');
		const stored = await db.plugins.get('demo-plugin');
		expect((stored?.manifest as PluginManifest | undefined)?.version).toBe('2.0.0');
		const storedFiles = await db.pluginFiles.get('demo-plugin');
		expect(Array.from(storedFiles?.entrypointZipData ?? [])).toEqual(Array.from(zipData));
		expect(reportErrorMock).not.toHaveBeenCalled();
	});
});

describe('PluginInstallGate restore as editable', () => {
	it('registers a restorable install as owned only when asked', async () => {
		const registerNew = vi.fn().mockResolvedValue(undefined);
		const gate = new PluginInstallGate(() => makeRegistry({ registerNew }));
		const manifest = makeManifest();

		const outcome = gate.requestInstall(
			async () => ({ status: 'ready', manifest, files: null, restorable: true }),
			{ review: true }
		);
		await vi.waitFor(() => expect(gate.pending?.restorable).toBe(true));
		await gate.confirmPending({ asEditable: true });
		await outcome;
		expect(registerNew).toHaveBeenCalledWith(manifest, null, {
			authoring: { source: 'scriptLab' },
		});
	});

	it('ignores asEditable for a zip that is not restorable', async () => {
		const registerNew = vi.fn().mockResolvedValue(undefined);
		const gate = new PluginInstallGate(() => makeRegistry({ registerNew }));
		const manifest = makeManifest();

		const outcome = gate.requestInstall(
			async () => ({ status: 'ready', manifest, files: null, restorable: false }),
			{ review: true }
		);
		await vi.waitFor(() => expect(gate.pending).not.toBeNull());
		await gate.confirmPending({ asEditable: true });
		await outcome;
		expect(registerNew).toHaveBeenCalledWith(manifest, null);
	});
});
