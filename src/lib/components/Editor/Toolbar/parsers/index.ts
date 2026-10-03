import type { Part } from '$lib/model/Part';
import type FoldnanoDocument from '../../../../model/document.svelte';
import type { PluginManifest } from '$lib/plugin/types';
import { cadnanoParser } from './cadnanojsonParser';
import { foldnanojsonParser } from './foldnanojsonParser';
import { fpluginParser } from './fpluginParser';
import { strFromU8 } from 'fflate';
import { unzipCapped } from '$lib/plugin/sizeLimits';
import { validateManifest } from '$lib/plugin/manifestValidation';

/**
 * Sentinel class for a local plugin zip. Carries the parsed manifest for
 * preview and the original File for installation via prepareLocalZipInstall().
 */
export class LocalPluginZipFile {
	constructor(
		public manifest: PluginManifest,
		public file: File
	) {}
}

// Shared meta passed to parsers
export interface FileMeta {
	name: string;
	extension: string;
	secondaryExtension?: string;
	size: number;
	type: string;
}

export interface DesignFileParser {
	id: string;
	priority?: number; // higher runs earlier
	canParse(raw: Record<string, unknown>, meta: FileMeta): boolean;
	parse(raw: Record<string, unknown>, meta: FileMeta): Part | FoldnanoDocument;
}

// Registry (order + priority controls selection)
const parsers: DesignFileParser[] = [
	fpluginParser,
	cadnanoParser,
	foldnanojsonParser,
	// Future: add other parsers here (e.g. oxdnaParser, legacyCadnanoParser, etc.)
];

// Dispatch pre-parsed JSON through the registered parsers
export function parseDesignRaw(
	raw: Record<string, unknown>,
	meta: FileMeta
): Part | FoldnanoDocument {
	const candidates = parsers
		.filter((p) => {
			try {
				return p.canParse(raw, meta);
			} catch {
				return false;
			}
		})
		.sort((a, b) => (b.priority || 0) - (a.priority || 0));

	console.log(
		`Found ${candidates.length} candidate parsers for "${meta.name}":`,
		candidates.map((c) => c.id)
	);
	if (!candidates.length) {
		throw new Error(
			`No suitable parser found for "${meta.name}". ` +
				`Add a new DesignFileParser for this format.`
		);
	}

	return candidates[0].parse(raw, meta);
}

// Core dispatcher for File objects
export async function parseDesignFile(
	file: File
): Promise<Part | FoldnanoDocument | LocalPluginZipFile> {
	if (!(file instanceof File)) {
		throw new TypeError('parseDesignFile: expected a File');
	}

	const ext = file.name.split('.').pop()?.toLowerCase() || '';
	const meta: FileMeta = {
		name: file.name,
		extension: ext,
		secondaryExtension: file.name.split('.').slice(-2, -1)[0] || '',
		size: file.size,
		type: file.type,
	};
	console.log('Parsing design file:', meta);

	// Zip files are binary — handle before the JSON parse path.
	if (ext === 'zip') {
		const bytes = new Uint8Array(await file.arrayBuffer());
		let entries: Record<string, Uint8Array>;
		try {
			entries = unzipCapped(bytes);
		} catch (e) {
			throw new Error(
				`Failed to read zip "${file.name}": ${e instanceof Error ? e.message : String(e)}`
			);
		}
		const manifestBytes = entries['fplugin.json'];
		if (!manifestBytes) {
			throw new Error(`No fplugin.json found at the root of "${file.name}".`);
		}
		let raw: Record<string, unknown>;
		try {
			raw = JSON.parse(strFromU8(manifestBytes));
		} catch {
			throw new Error(`fplugin.json in "${file.name}" is not valid JSON.`);
		}
		const manifest = validateManifest(raw, { allowNoEntrypoint: true });
		return new LocalPluginZipFile(manifest, file);
	}

	const text = await file.text();
	let raw: Record<string, unknown>;

	try {
		raw = JSON.parse(text);
	} catch (jsonErr) {
		throw new SyntaxError(`Unable to parse JSON in "${file.name}": ${(jsonErr as Error).message}`);
	}

	return parseDesignRaw(raw, meta);
}

// Utility to register at runtime if needed
export function registerDesignFileParser(parser: DesignFileParser) {
	parsers.push(parser);
}

/** Returns any non-fatal warnings emitted by the most recent parseDesignRaw/parseDesignFile call. */
export function getParseWarnings(): string[] {
	return parsers
		.filter((p): p is DesignFileParser & { getLastWarnings(): string[] } => 'getLastWarnings' in p)
		.flatMap((p) => p.getLastWarnings());
}
