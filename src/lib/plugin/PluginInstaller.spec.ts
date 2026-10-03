import { beforeEach, describe, expect, it, vi } from 'vitest';
import { zipSync } from 'fflate';

import { prepareLocalZipInstall, preparePointerInstall } from './PluginInstaller';
import type { PluginManifest, PythonPlugin } from './types';

function makePlugin(manifest: PluginManifest, origin: 'builtin' | 'user'): PythonPlugin {
	return {
		manifest,
		origin,
		enabled: true,
		status: 'registered',
		resolvedCode: null,
		resolvedZipData: undefined,
		errorMessage: null,
		errorTraceback: null,
		logs: [],
		artifacts: {},
		pluginResult: null,
		paramValues: {},
		sidePanelValues: {},
		sidePanelCode: '',
		lastRunMutationLogLength: null,
	};
}

function makeClassifyRegistry(
	opts: {
		existing?: PythonPlugin;
		busy?: { busy: boolean; reason?: string };
	} = {}
) {
	return {
		get: (id: string) => (opts.existing?.manifest.id === id ? opts.existing : undefined),
		isPluginBusyForInstall: () => opts.busy ?? { busy: false },
	};
}

function makeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
	return {
		schemaVersion: 1,
		id: 'zip-demo',
		name: 'Zip Demo',
		version: '1.0.0',
		format: 'cadnano_json',
		applyStrategy: 'previewOnly',
		...overrides,
	};
}

// Bytes must come from the native realm: under jsdom, TextEncoder-produced
// arrays fail fflate's `instanceof Uint8Array` check (zipSync would recurse
// into them as folders). Buffer.from stays in the native realm.
function bytes(v: string | Uint8Array): Uint8Array {
	return typeof v === 'string' ? new Uint8Array(Buffer.from(v)) : v;
}

// jsdom's File doesn't implement arrayBuffer() — supply the one method prepareLocalZipInstall calls.
function makeFile(data: Uint8Array): File {
	const buffer = new ArrayBuffer(data.byteLength);
	new Uint8Array(buffer).set(data);
	const file = new File([buffer], 'plugin.zip');
	Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.resolve(buffer) });
	return file;
}

function makeZip(files: Record<string, string | Uint8Array>): Uint8Array {
	return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, bytes(v)])));
}

describe('prepareLocalZipInstall / preparePointerInstall', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.unstubAllGlobals();
	});

	it('returns ready for a new id, extracting only bundled bare-filename wheels', async () => {
		const registry = makeClassifyRegistry();
		const wheelBytes = bytes('wheel-bytes');
		const zip = makeZip({
			'fplugin.json': JSON.stringify(
				makeManifest({
					requirements: ['dep-1.0-py3-none-any.whl', '/plugins/shared/big.whl', 'numpy'],
				})
			),
			'plugin.py': 'def run(ctx): pass',
			'dep-1.0-py3-none-any.whl': wheelBytes,
		});

		const result = await prepareLocalZipInstall(makeFile(zip), registry);

		expect(result.status).toBe('ready');
		if (result.status === 'ready') {
			expect(result.manifest.id).toBe('zip-demo');
			expect(result.files?.wheels).toEqual([{ url: 'dep-1.0-py3-none-any.whl', data: wheelBytes }]);
		}
	});

	it('rejects zips without fplugin.json at the root', async () => {
		const zip = makeZip({ 'plugin.py': 'def run(ctx): pass' });
		await expect(prepareLocalZipInstall(makeFile(zip), makeClassifyRegistry())).rejects.toThrow(
			/No fplugin.json found/
		);
	});

	it('explains a zip made from the plugin folder instead of its files', async () => {
		const zip = makeZip({
			'my-plugin/fplugin.json': '{}',
			'my-plugin/plugin.py': 'def run(ctx): pass',
			'__MACOSX/my-plugin/._fplugin.json': '',
		});
		await expect(prepareLocalZipInstall(makeFile(zip), makeClassifyRegistry())).rejects.toThrow(
			/inside the folder "my-plugin\/".*not the folder/
		);
	});

	it('does not accept the legacy manifest.json filename', async () => {
		const zip = makeZip({
			'manifest.json': JSON.stringify(makeManifest()),
			'plugin.py': 'def run(ctx): pass',
		});
		await expect(prepareLocalZipInstall(makeFile(zip), makeClassifyRegistry())).rejects.toThrow(
			/No fplugin.json found/
		);
	});

	it('rejects zips without plugin.py at the root', async () => {
		const zip = makeZip({ 'fplugin.json': JSON.stringify(makeManifest()) });
		await expect(prepareLocalZipInstall(makeFile(zip), makeClassifyRegistry())).rejects.toThrow(
			/No plugin.py found/
		);
	});

	it('rejects when a bundled wheel requirement is missing from the zip', async () => {
		const zip = makeZip({
			'fplugin.json': JSON.stringify(makeManifest({ requirements: ['missing-1.0.whl'] })),
			'plugin.py': 'def run(ctx): pass',
		});
		await expect(prepareLocalZipInstall(makeFile(zip), makeClassifyRegistry())).rejects.toThrow(
			/Wheel "missing-1.0.whl" .* not found in the zip/
		);
	});

	it('returns blocked-builtin for an existing built-in id and writes nothing', async () => {
		const registry = makeClassifyRegistry({
			existing: makePlugin(makeManifest(), 'builtin'),
		});
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);
		const pointer = makeManifest({
			format: 'foldnano_mini',
			applyStrategy: 'replayMutationLog',
			entrypoint: 'def run(ctx): raise RuntimeError("placeholder")',
			sidePanel: { type: 'codeEditor', codeEditor: { execution: 'entrypoint' } },
		});

		const result = await preparePointerInstall(pointer, registry);

		expect(result).toEqual({
			status: 'blocked-builtin',
			message: '"zip-demo" is a built-in plugin and cannot be replaced.',
		});
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('returns blocked-busy when the registry reports the id busy, and writes nothing', async () => {
		const registry = makeClassifyRegistry({ busy: { busy: true, reason: 'currently running' } });
		const pointer = makeManifest({
			format: 'foldnano_mini',
			applyStrategy: 'replayMutationLog',
			entrypoint: 'def run(ctx): raise RuntimeError("placeholder")',
			sidePanel: { type: 'codeEditor', codeEditor: { execution: 'entrypoint' } },
		});

		const result = await preparePointerInstall(pointer, registry);

		expect(result).toEqual({
			status: 'blocked-busy',
			message: 'Cannot install "zip-demo": currently running.',
		});
	});

	it('returns blocked-busy when no busy check is configured, and writes nothing', async () => {
		const registry = makeClassifyRegistry({
			busy: { busy: true, reason: 'registry busy-check is not configured' },
		});
		const pointer = makeManifest({
			format: 'foldnano_mini',
			applyStrategy: 'replayMutationLog',
			entrypoint: 'def run(ctx): raise RuntimeError("placeholder")',
			sidePanel: { type: 'codeEditor', codeEditor: { execution: 'entrypoint' } },
		});

		const result = await preparePointerInstall(pointer, registry);

		expect(result).toEqual({
			status: 'blocked-busy',
			message: 'Cannot install "zip-demo": registry busy-check is not configured.',
		});
	});

	it('returns needs-confirm for an existing non-builtin id, carrying both manifests, and writes nothing', async () => {
		const existingManifest = makeManifest({ version: '1.0.0' });
		const registry = makeClassifyRegistry({
			existing: makePlugin(existingManifest, 'user'),
		});
		const pointer = makeManifest({
			format: 'foldnano_mini',
			applyStrategy: 'replayMutationLog',
			entrypoint: 'def run(ctx): raise RuntimeError("placeholder")',
			sidePanel: { type: 'codeEditor', codeEditor: { execution: 'entrypoint' } },
			version: '2.0.0',
		});

		const result = await preparePointerInstall(pointer, registry);

		expect(result.status).toBe('needs-confirm');
		if (result.status === 'needs-confirm') {
			expect(result.incoming.version).toBe('2.0.0');
			expect(result.existing).toBe(existingManifest);
		}
	});

	it('returns ready for a runtime-code pointer without fetching', async () => {
		const registry = makeClassifyRegistry();
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);
		const pointer = makeManifest({
			format: 'foldnano_mini',
			applyStrategy: 'replayMutationLog',
			entrypoint: 'def run(ctx): raise RuntimeError("placeholder")',
			sidePanel: { type: 'codeEditor', codeEditor: { execution: 'entrypoint' } },
		});

		const result = await preparePointerInstall(pointer, registry);

		expect(result).toEqual({ status: 'ready', manifest: pointer, files: null });
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('rejects a malformed pointer before any fetch', async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);

		await expect(
			preparePointerInstall({ schemaVersion: 1, name: 'No Id' }, makeClassifyRegistry())
		).rejects.toThrow(/id/);

		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('fetches the pointer zip and returns the inner manifest as ready', async () => {
		const registry = makeClassifyRegistry();
		// Inner manifest differs from the pointer — the inner copy must win.
		const zip = makeZip({
			'fplugin.json': JSON.stringify(makeManifest({ name: 'Inner Name', version: '2.0.0' })),
			'plugin.py': 'def run(ctx): pass',
		});
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: () => Promise.resolve(zip.slice(0).buffer),
			})
		);

		const pointer = makeManifest({ entrypointUrl: '/plugins/zip_demo/zip_demo.zip' });
		const result = await preparePointerInstall(pointer, registry);

		expect(fetch).toHaveBeenCalledWith('/plugins/zip_demo/zip_demo.zip');
		expect(result.status).toBe('ready');
		if (result.status === 'ready') {
			expect(result.manifest.name).toBe('Inner Name');
			expect(result.manifest.version).toBe('2.0.0');
		}
	});

	it('rejects an id mismatch between the pointer and the zip’s inner manifest', async () => {
		const zip = makeZip({
			'fplugin.json': JSON.stringify(makeManifest({ id: 'other-id' })),
			'plugin.py': 'def run(ctx): pass',
		});
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: () => Promise.resolve(zip.slice(0).buffer),
			})
		);

		const pointer = makeManifest({ entrypointUrl: '/plugins/zip_demo/zip_demo.zip' });
		await expect(preparePointerInstall(pointer, makeClassifyRegistry())).rejects.toThrow(
			/id mismatch/
		);
	});

	it('records the pointer entrypointUrl on the inner manifest when it omits one', async () => {
		const zip = makeZip({
			'fplugin.json': JSON.stringify(makeManifest()),
			'plugin.py': 'def run(ctx): pass',
		});
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: () => Promise.resolve(zip.slice(0).buffer),
			})
		);

		const pointer = makeManifest({ entrypointUrl: '/plugins/zip_demo/zip_demo.zip' });
		const result = await preparePointerInstall(pointer, makeClassifyRegistry());

		expect(result.status).toBe('ready');
		if (result.status === 'ready') {
			expect(result.manifest.entrypointUrl).toBe('/plugins/zip_demo/zip_demo.zip');
		}
	});
});
