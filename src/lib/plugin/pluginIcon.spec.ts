import { describe, expect, it, vi } from 'vitest';
import { zipSync } from 'fflate';
import {
	MAX_PLUGIN_ICON_BYTES,
	pluginIconDataUrl,
	readPluginIcon,
	readPluginIconFromZip,
	validatePluginIconSvg,
} from './pluginIcon';
import { PLUGIN_ICON_PRESETS } from './pluginIconPresets';
import { prepareLocalZipInstall } from './PluginInstaller';
import {
	buildOwnedManifest,
	buildPluginZip,
	isOwnedEditablePackage,
	isRestorableOwnedZip,
	pluginFilesRecord,
} from './ownedPlugins';
import { PluginRegistry } from './PluginRegistry.svelte';
import { changeOwnedPluginIcon, saveOwnedPluginVersion } from './ownedPluginActions';
import type { FoldnanoIndexedDb } from '$lib/services/storage/indexeddb/FoldnanoIndexedDb';
import type { PluginManifest } from './types';

vi.mock('$lib/services/storage/indexeddb/FoldnanoIndexedDb', () => ({
	foldnanoIndexedDb: {
		loadAllPlugins: vi.fn().mockResolvedValue([]),
		loadPluginFiles: vi.fn(),
	},
}));

const ICON =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 2h20v20H2z"/></svg>';
const svg = (body: string, attrs = '') =>
	`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"${attrs}>${body}</svg>`;

// Native-realm bytes: jsdom's TextEncoder output fails fflate's instanceof check.
const bytes = (v: string) => new Uint8Array(Buffer.from(v));
const makeZip = (files: Record<string, string>) =>
	zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, bytes(v)])));

function makeFile(data: Uint8Array): File {
	const buffer = new ArrayBuffer(data.byteLength);
	new Uint8Array(buffer).set(data);
	const file = new File([buffer], 'plugin.zip');
	Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.resolve(buffer) });
	return file;
}

const registryStub = { get: () => undefined, isPluginBusyForInstall: () => ({ busy: false }) };

function packagedManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
	return {
		schemaVersion: 2,
		id: 'icon-demo',
		name: 'Icon Demo',
		version: '1.0.0',
		format: 'foldnano_json',
		applyStrategy: 'previewOnly',
		icon: 'assets/icon.svg',
		...overrides,
	};
}

describe('validatePluginIconSvg', () => {
	it('accepts a plain SVG and every curated preset', () => {
		expect(validatePluginIconSvg(`  ${ICON}\n`)).toBe(ICON);
		for (const preset of PLUGIN_ICON_PRESETS) {
			expect(() => validatePluginIconSvg(preset.svg), preset.id).not.toThrow();
		}
	});

	it('accepts same-document references', () => {
		const withDefs = svg(
			'<defs><linearGradient id="g"/><path id="p" d="M0 0h1"/></defs><use href="#p" fill="url(#g)"/>'
		);
		expect(() => validatePluginIconSvg(withDefs)).not.toThrow();
	});

	it.each([
		['not XML', 'hello', /not a valid SVG/],
		['an HTML root', '<div></div>', /not a valid SVG/],
		['no namespace', '<svg viewBox="0 0 1 1"></svg>', /xmlns/],
		['no viewBox', '<svg xmlns="http://www.w3.org/2000/svg"></svg>', /viewBox/],
		['a script', svg('<script>alert(1)</script>'), /<script>/],
		['foreignObject', svg('<foreignObject><div/></foreignObject>'), /foreignObject/],
		['an event handler', svg('<path d="M0 0" onclick="x()"/>'), /event handlers/],
		['a handler on the root', svg('', ' onload="x()"'), /event handlers/],
		['an external use', svg('<use href="other.svg#a"/>'), /link to other files/],
		[
			'an xlink href',
			svg('<use xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="https://x/a.svg#a"/>'),
			/link to other files/,
		],
		['an image', svg('<image href="#x"/>'), /<image>/],
		['an animation', svg('<set attributeName="href" to="https://x"/>'), /<set>/],
		['an external fill', svg('<path d="M0 0" fill="url(https://x/p.svg#a)"/>'), /load other/],
		['a style import', svg('<style>@import url(x.css);</style>'), /styles/],
		['a doctype', `<!DOCTYPE svg>${ICON}`, /DOCTYPE/],
	])('rejects %s', (_label, text, error) => {
		expect(() => validatePluginIconSvg(text)).toThrow(error);
	});

	it('rejects an icon over the size cap', () => {
		const big = svg(`<path d="${'M0 0'.repeat(MAX_PLUGIN_ICON_BYTES / 4)}"/>`);
		expect(() => validatePluginIconSvg(big)).toThrow(/larger than/);
	});

	it('encodes a data URL safe to put in url("…")', () => {
		expect(pluginIconDataUrl(ICON)).not.toMatch(/["\s<>]/);
	});
});

describe('reading a bundled icon', () => {
	it('reads only the named entry', () => {
		const zip = makeZip({ 'assets/icon.svg': ICON, 'plugin.py': 'x' });
		expect(readPluginIconFromZip('assets/icon.svg', zip)).toBe(ICON);
		expect(() => readPluginIconFromZip('icon.svg', zip)).toThrow(/not in the zip/);
	});

	it('returns null for a manifest without an icon', () => {
		expect(readPluginIcon(packagedManifest({ icon: undefined }), null)).toBeNull();
	});
});

describe('installing a plugin with an icon', () => {
	it('accepts a zip whose icon is valid', async () => {
		const zip = makeZip({
			'fplugin.json': JSON.stringify(packagedManifest()),
			'plugin.py': 'def run(ctx): pass',
			'assets/icon.svg': ICON,
		});
		const result = await prepareLocalZipInstall(makeFile(zip), registryStub);
		expect(result).toMatchObject({ status: 'ready', manifest: { icon: 'assets/icon.svg' } });
	});

	it.each([
		['missing', {}, /not in the zip/],
		['unsafe', { 'assets/icon.svg': svg('<script/>') }, /<script>/],
	])('refuses a zip whose icon is %s', async (_label, extra, error) => {
		const zip = makeZip({
			'fplugin.json': JSON.stringify(packagedManifest()),
			'plugin.py': 'def run(ctx): pass',
			...extra,
		});
		await expect(prepareLocalZipInstall(makeFile(zip), registryStub)).rejects.toThrow(error);
	});
});

describe('owned plugins with an icon', () => {
	const owned = (hasIcon: boolean) =>
		buildOwnedManifest({ id: 'local.abc12345', name: 'Mine', requirements: [], hasIcon });

	it('bundles icon.svg and stays editable and restorable', () => {
		const manifest = owned(true);
		expect(manifest).toMatchObject({ schemaVersion: 2, icon: 'icon.svg' });
		const files = ['fplugin.json', 'plugin.py', 'icon.svg'];
		expect(isOwnedEditablePackage(manifest, files)).toBe(true);
		expect(isRestorableOwnedZip(manifest, files)).toBe(true);
	});

	it('is not editable when the manifest and icon.svg disagree, or the icon lives elsewhere', () => {
		expect(isOwnedEditablePackage(owned(false), ['fplugin.json', 'plugin.py', 'icon.svg'])).toBe(
			false
		);
		expect(isOwnedEditablePackage(owned(true), ['fplugin.json', 'plugin.py'])).toBe(false);
		const elsewhere = { ...owned(true), icon: 'art/icon.svg' };
		expect(isOwnedEditablePackage(elsewhere, ['fplugin.json', 'plugin.py', 'art/icon.svg'])).toBe(
			false
		);
	});

	it('refuses to build a zip whose manifest and icon disagree', () => {
		expect(() => buildPluginZip(owned(true), 'x')).toThrow(/icon/);
		expect(() => buildPluginZip(owned(false), 'x', ICON)).toThrow(/icon/);
	});
});

describe('PluginRegistry and owned-plugin actions with icons', () => {
	function makeDb() {
		return {
			loadAllPlugins: vi.fn().mockResolvedValue([]),
			saveInstalledPlugin: vi.fn().mockResolvedValue(undefined),
			updatePluginRecord: vi.fn().mockResolvedValue(undefined),
			deletePlugin: vi.fn().mockResolvedValue(undefined),
			deletePluginFiles: vi.fn().mockResolvedValue(undefined),
		};
	}

	async function makeRegistry(db = makeDb()) {
		const registry = new PluginRegistry(db as unknown as FoldnanoIndexedDb);
		registry.setBusyCheck(() => ({ busy: false }));
		await registry.ready;
		return { registry, db };
	}

	const coordinator = { resolveScriptRequirements: vi.fn().mockResolvedValue([]) };

	it('stores the icon on the record at install', async () => {
		const { registry, db } = await makeRegistry();
		const manifest = buildOwnedManifest({
			id: 'local.abc12345',
			name: 'Mine',
			requirements: [],
			hasIcon: true,
		});
		const zip = buildPluginZip(manifest, 'def run(ctx): pass', ICON);
		const plugin = await registry.registerNew(manifest, pluginFilesRecord(manifest, zip), {
			authoring: { source: 'scriptLab' },
		});
		expect(plugin.iconSvg).toBe(ICON);
		expect(db.saveInstalledPlugin.mock.calls[0][0]).toMatchObject({ iconSvg: ICON });
	});

	it('loads the stored icon only when the manifest still names one', async () => {
		const db = makeDb();
		const base = buildOwnedManifest({ id: 'local.a', name: 'A', requirements: [] });
		db.loadAllPlugins.mockResolvedValueOnce([
			{ id: 'local.a', manifest: { ...base, icon: 'icon.svg' }, iconSvg: ICON },
			{ id: 'local.b', manifest: { ...base, id: 'local.b' }, iconSvg: ICON },
		]);
		const { registry } = await makeRegistry(db);
		expect(registry.get('local.a')?.iconSvg).toBe(ICON);
		expect(registry.get('local.b')?.iconSvg).toBeNull();
	});

	it('keeps the icon across a code save, and changes it without dropping the draft', async () => {
		const { foldnanoIndexedDb } = await import('$lib/services/storage/indexeddb/FoldnanoIndexedDb');
		const { registry } = await makeRegistry();
		const manifest = buildOwnedManifest({
			id: 'local.abc12345',
			name: 'Mine',
			requirements: [],
			hasIcon: true,
		});
		const zip = buildPluginZip(manifest, 'def run(ctx): pass', ICON);
		await registry.registerNew(manifest, pluginFilesRecord(manifest, zip), {
			authoring: { source: 'scriptLab' },
		});
		const deps = { registry, coordinator };

		const saved = await saveOwnedPluginVersion(deps, 'local.abc12345', 'def run(ctx): 1');
		expect(saved.iconSvg).toBe(ICON);
		expect(saved.manifest).toMatchObject({ version: '1.0.1', icon: 'icon.svg' });

		saved.draftCode = 'draft';
		vi.mocked(foldnanoIndexedDb.loadPluginFiles).mockResolvedValueOnce(
			pluginFilesRecord(saved.manifest, buildPluginZip(saved.manifest, 'def run(ctx): 1', ICON))
		);
		const other = PLUGIN_ICON_PRESETS[1].svg;
		const changed = await changeOwnedPluginIcon(deps, 'local.abc12345', other);
		expect(changed).toMatchObject({ iconSvg: other, draftCode: 'draft' });
		expect(changed.manifest.version).toBe('1.0.2');

		const removed = await saveOwnedPluginVersion(deps, 'local.abc12345', 'x = 1', null);
		expect(removed.iconSvg).toBeNull();
		expect(removed.manifest.icon).toBeUndefined();
	});
});
