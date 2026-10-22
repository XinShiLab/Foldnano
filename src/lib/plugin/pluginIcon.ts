/**
 * Plugin icons: an SVG bundled in the plugin zip and named by the manifest's `icon` field.
 * Checked once at install and stored as text on the plugin record, so drawing never unzips.
 * See docs/python-plugin-system.md § Plugin icons.
 */

import { strFromU8, unzipSync } from 'fflate';
import type { PluginManifest } from './types';
import type { IndexedDbPluginFilesRecord } from '$lib/services/storage/indexedDbTypes';

export const MAX_PLUGIN_ICON_BYTES = 32 * 1024;

/** The file name owned plugins (Script Lab) use for their icon. */
export const OWNED_PLUGIN_ICON_FILE = 'icon.svg';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Elements that can run code, embed documents or load other files. */
const FORBIDDEN_ELEMENTS = new Set([
	'script',
	'foreignobject',
	'iframe',
	'object',
	'embed',
	'image',
	'feimage',
	'a',
	'audio',
	'video',
	'animate',
	'set',
	'animatemotion',
	'animatetransform',
]);

/** `url(...)` that isn't a same-document fragment, e.g. url(https://…) or url(data:…). */
const EXTERNAL_URL_RE = /url\(\s*['"]?(?!#)/i;

/**
 * Throws a readable error unless `text` is a self-contained SVG: an `<svg>` root with a viewBox,
 * no scripts, event handlers, external references or embedded documents. Returns the trimmed text.
 * Icons are drawn as CSS masks, which can't run scripts anyway; this keeps the stored and
 * re-exported file clean too.
 */
export function validatePluginIconSvg(text: string): string {
	const svg = text.trim();
	if (new TextEncoder().encode(svg).byteLength > MAX_PLUGIN_ICON_BYTES) {
		throw new Error(`The icon is larger than ${MAX_PLUGIN_ICON_BYTES / 1024} KB.`);
	}
	if (/<!DOCTYPE|<!ENTITY/i.test(svg)) {
		throw new Error('The icon must not contain a DOCTYPE or entity declarations.');
	}
	const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
	const root = doc.documentElement;
	if (doc.getElementsByTagName('parsererror').length > 0 || root.localName !== 'svg') {
		throw new Error('The icon is not a valid SVG file.');
	}
	if (root.namespaceURI !== SVG_NS) {
		throw new Error(`The icon's <svg> element needs xmlns="${SVG_NS}".`);
	}
	if (!root.hasAttribute('viewBox')) {
		throw new Error('The icon needs a viewBox attribute so it can be scaled.');
	}
	for (const el of [root, ...Array.from(root.getElementsByTagName('*'))]) {
		const name = el.localName.toLowerCase();
		if (FORBIDDEN_ELEMENTS.has(name)) {
			throw new Error(`The icon must not contain <${el.localName}> elements.`);
		}
		if (
			name === 'style' &&
			(/@import/i.test(el.textContent ?? '') || EXTERNAL_URL_RE.test(el.textContent ?? ''))
		) {
			throw new Error('The icon must not load other files from its styles.');
		}
		for (const attr of Array.from(el.attributes)) {
			const attrName = attr.localName.toLowerCase();
			if (attrName.startsWith('on')) {
				throw new Error(`The icon must not contain event handlers ("${attr.name}").`);
			}
			if (attrName === 'href' && !attr.value.trim().startsWith('#')) {
				throw new Error('The icon must not link to other files.');
			}
			if (EXTERNAL_URL_RE.test(attr.value)) {
				throw new Error('The icon must not load other files.');
			}
		}
	}
	return svg;
}

/**
 * The validated icon named by `manifest.icon`, read from the stored zip; null when the manifest
 * has none. Throws when the icon is missing from the zip or isn't an acceptable SVG.
 */
export function readPluginIcon(
	manifest: PluginManifest,
	files: IndexedDbPluginFilesRecord | null
): string | null {
	if (!manifest.icon) return null;
	if (!files?.entrypointZipData) {
		throw new Error(`"icon" needs a plugin zip that contains ${manifest.icon}.`);
	}
	return readPluginIconFromZip(manifest.icon, files.entrypointZipData);
}

/** As `readPluginIcon`, for raw zip bytes; unpacks only the icon entry. */
export function readPluginIconFromZip(path: string, zip: Uint8Array): string {
	const entries = unzipSync(zip, { filter: (file) => file.name === path });
	return bundledIconSvg(path, entries[path]);
}

/** Validated SVG text of the zip entry `path`; throws a message naming the file. */
export function bundledIconSvg(path: string, bytes: Uint8Array | undefined): string {
	if (!bytes) throw new Error(`Icon "${path}" named in fplugin.json is not in the zip.`);
	if (bytes.byteLength > MAX_PLUGIN_ICON_BYTES)
		throw new Error(`Icon "${path}" is larger than ${MAX_PLUGIN_ICON_BYTES / 1024} KB.`);
	try {
		return validatePluginIconSvg(strFromU8(bytes));
	} catch (e) {
		throw new Error(`Icon "${path}": ${e instanceof Error ? e.message : String(e)}`);
	}
}

export function pluginIconDataUrl(svg: string): string {
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
