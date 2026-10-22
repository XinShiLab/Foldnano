import { describe, expect, it, vi } from 'vitest';
import { createOwnedPlugin, needsBackup, saveOwnedPluginVersion } from './ownedPluginActions';
import { readPluginPy } from './ownedPlugins';
import type { PluginManifest, PythonPlugin } from './types';

const CODE = 'import numpy\n\ndef run(ctx):\n    pass\n';

function makeDeps(existing: Partial<PythonPlugin> | null = null) {
	const registry = {
		get: vi.fn(() => (existing as PythonPlugin | null) ?? undefined),
		registerNew: vi.fn(
			async (manifest: PluginManifest, _files: unknown, _opts?: unknown) =>
				({ manifest }) as PythonPlugin
		),
		saveOwnedVersion: vi.fn(async (manifest) => ({ manifest }) as PythonPlugin),
		markExported: vi.fn(),
	};
	const coordinator = { resolveScriptRequirements: vi.fn().mockResolvedValue(['numpy']) };
	return { registry, coordinator };
}

describe('owned plugin actions', () => {
	it('packages the script with requirements from its imports, as an owned plugin', async () => {
		const deps = makeDeps();
		const { manifest, zip } = await createOwnedPlugin(deps, {
			id: 'local.abc12345',
			name: 'Mine',
			code: CODE,
		});
		expect(manifest).toMatchObject({
			id: 'local.abc12345',
			version: '1.0.0',
			requirements: ['numpy'],
		});
		expect(readPluginPy(zip)).toBe(CODE);
		const [, files, opts] = deps.registry.registerNew.mock.calls[0];
		expect(files).toMatchObject({ id: 'local.abc12345', manifestVersion: '1.0.0' });
		expect(opts).toEqual({ authoring: { source: 'scriptLab' } });
	});

	it('refuses an empty name or script', async () => {
		await expect(
			createOwnedPlugin(makeDeps(), { id: 'local.abc12345', name: ' ', code: CODE })
		).rejects.toThrow(/name/);
		await expect(
			createOwnedPlugin(makeDeps(), { id: 'local.abc12345', name: 'X', code: '  ' })
		).rejects.toThrow(/empty/);
	});

	it('saves the next patch version and re-derives requirements', async () => {
		const deps = makeDeps({
			authoring: { source: 'scriptLab' },
			manifest: {
				schemaVersion: 1,
				id: 'local.abc12345',
				name: 'Mine',
				version: '1.0.4',
				format: 'foldnano_mini',
				applyStrategy: 'replayMutationLog',
				requirements: ['scipy'],
			},
		});
		deps.coordinator.resolveScriptRequirements.mockResolvedValueOnce([]);
		await saveOwnedPluginVersion(deps, 'local.abc12345', 'def run(ctx): pass\n');
		const [manifest] = deps.registry.saveOwnedVersion.mock.calls[0];
		expect(manifest.version).toBe('1.0.5');
		expect(manifest).not.toHaveProperty('requirements');
	});

	it('flags owned plugins whose saved version has not been exported', () => {
		const manifest = { version: '1.0.1' } as PythonPlugin['manifest'];
		expect(needsBackup({ manifest, authoring: { source: 'scriptLab' } } as PythonPlugin)).toBe(
			true
		);
		expect(
			needsBackup({
				manifest,
				authoring: { source: 'scriptLab', lastExportedVersion: '1.0.1' },
			} as PythonPlugin)
		).toBe(false);
		expect(needsBackup({ manifest, authoring: null } as PythonPlugin)).toBe(false);
	});
});
