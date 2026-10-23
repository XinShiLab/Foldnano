/**
 * Plugin dev mode: turns a linked folder on disk into the same zip an install would store, so a
 * linked plugin runs through the unchanged install/run pipeline. See docs/python-plugin-system.md
 * § Plugin dev mode.
 */

import { strFromU8, zipSync } from 'fflate';
import { readFileBytes, walkDirectory } from '$lib/services/fileAccess/fileAccess';
import { processPluginZip } from './PluginInstaller';
import { classifyEnv, requirementSources } from './envClassification';
import { MAX_PLUGIN_ZIP_BYTES, formatMb } from './sizeLimits';
import type { PluginManifest } from './types';
import type { IndexedDbPluginFilesRecord } from '$lib/services/storage/indexedDbTypes';

/** Folders that never belong in a plugin (environments, caches, build output of other tools). */
const IGNORED_DIRS = new Set(['__pycache__', 'node_modules', 'venv', 'env', 'site-packages']);
const IGNORED_FILE = /\.(pyc|pyo|zip)$/;
/** Editor config a starter plugin writes next to its stubs; never part of the plugin. */
const IGNORED_FILE_NAMES = new Set(['pyrightconfig.json']);

/** Dot-files and dot-folders (.git, .venv, .foldnano-stubs, .vscode …) and the names above. */
export function isIgnoredLinkedPath(path: string, kind: 'file' | 'directory'): boolean {
	const name = path.slice(path.lastIndexOf('/') + 1);
	if (name.startsWith('.')) return true;
	if (kind === 'directory') return IGNORED_DIRS.has(name);
	return IGNORED_FILE.test(name) || IGNORED_FILE_NAMES.has(name);
}

/** Files of a linked folder, capped like a plugin zip (its total must fit one). */
export const MAX_LINKED_FOLDER_FILES = 2000;

export interface LinkedFolderRead {
	manifest: PluginManifest;
	/** Same shape install stores: the zip plus bundled wheels. */
	files: IndexedDbPluginFilesRecord;
	zip: Uint8Array;
	fileNames: string[];
	/** Changes exactly when the plugin's environment must be rebuilt. */
	envFingerprint: string;
}

export async function readLinkedPluginFolder(
	dir: FileSystemDirectoryHandle
): Promise<LinkedFolderRead> {
	const walked = await walkDirectory(dir, {
		ignore: isIgnoredLinkedPath,
		maxFiles: MAX_LINKED_FOLDER_FILES,
		maxBytes: MAX_PLUGIN_ZIP_BYTES,
	});
	const entries: Record<string, Uint8Array> = {};
	for (const file of walked) entries[file.path] = await readFileBytes(file.handle);
	if (!entries['fplugin.json']) {
		throw new Error(`No fplugin.json found at the top of the folder "${dir.name}".`);
	}
	const zip = zipSync(entries);
	const processed = processPluginZip(zip);
	if (!processed.files?.entrypointZipData) {
		throw new Error(
			'A linked plugin must ship plugin.py; runtime-code manifests cannot be linked.'
		);
	}
	return {
		manifest: processed.manifest,
		files: processed.files,
		zip,
		fileNames: Object.keys(entries),
		envFingerprint: envFingerprint(processed.manifest, processed.files.wheels),
	};
}

/** FNV-1a over the bytes; enough to notice a rebuilt wheel, not a security check. */
function hashBytes(bytes: Uint8Array): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < bytes.length; i++) {
		hash ^= bytes[i];
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16);
}

export function envFingerprint(
	manifest: Pick<PluginManifest, 'requirements' | 'network'>,
	wheels: ReadonlyArray<{ url: string; data: Uint8Array }>
): string {
	return JSON.stringify({
		requirements: manifest.requirements ?? [],
		network: manifest.network ?? [],
		wheels: wheels.map((w) => [w.url, w.data.byteLength, hashBytes(w.data)]),
	});
}

export interface PluginCheckIssue {
	level: 'error' | 'warning' | 'info';
	message: string;
}

/**
 * Everything "Check plugin" reports for a folder: what would stop it installing or running, and
 * what's worth knowing before packaging it. Independent checks all run; the manifest itself is
 * validated like an install, which stops at its first problem.
 */
export async function checkLinkedPluginFolder(
	dir: FileSystemDirectoryHandle
): Promise<PluginCheckIssue[]> {
	const issues: PluginCheckIssue[] = [];
	const error = (message: string) => issues.push({ level: 'error', message });
	const ignoredTop = new Set<string>();
	let walked;
	try {
		walked = await walkDirectory(dir, {
			ignore: (path, kind) => {
				const ignored = isIgnoredLinkedPath(path, kind);
				if (ignored && !path.includes('/'))
					ignoredTop.add(kind === 'directory' ? `${path}/` : path);
				return ignored;
			},
			maxFiles: MAX_LINKED_FOLDER_FILES,
			maxBytes: MAX_PLUGIN_ZIP_BYTES,
		});
	} catch (e) {
		error(e instanceof Error ? e.message : String(e));
		return issues;
	}
	const byPath = new Map(walked.map((f) => [f.path, f]));
	const totalBytes = walked.reduce((n, f) => n + f.size, 0);

	const pluginPy = byPath.get('plugin.py');
	if (!pluginPy) error('No plugin.py at the top of the folder.');
	else if (!/^def run\s*\(/m.test(strFromU8(await readFileBytes(pluginPy.handle)))) {
		error('plugin.py has no top-level `def run(ctx)` function.');
	}

	const manifestFile = byPath.get('fplugin.json');
	if (!manifestFile) {
		error('No fplugin.json at the top of the folder.');
	} else {
		try {
			JSON.parse(strFromU8(await readFileBytes(manifestFile.handle)));
		} catch (e) {
			error(`fplugin.json is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	if (manifestFile && pluginPy && issues.length === 0) {
		try {
			const read = await readLinkedPluginFolder(dir);
			issues.push(...manifestNotes(read.manifest, read.fileNames));
		} catch (e) {
			error(e instanceof Error ? e.message : String(e));
		}
	}

	if (totalBytes > MAX_PLUGIN_ZIP_BYTES * 0.8) {
		issues.push({
			level: 'warning',
			message: `The plugin's files add up to ${formatMb(totalBytes)}, close to the ${formatMb(MAX_PLUGIN_ZIP_BYTES)} limit.`,
		});
	}
	if (ignoredTop.size > 0) {
		issues.push({
			level: 'info',
			message: `Not part of the plugin (ignored): ${[...ignoredTop].sort().join(', ')}`,
		});
	}
	return issues;
}

function manifestNotes(manifest: PluginManifest, fileNames: string[]): PluginCheckIssue[] {
	const notes: PluginCheckIssue[] = [];
	const sources = requirementSources(manifest);
	if (sources.pypi.length > 0) {
		notes.push({
			level: 'warning',
			message:
				`Downloaded from PyPI on Activate (not in the Pyodide distribution): ${sources.pypi.join(', ')}. ` +
				'Pure-Python packages work; packages with compiled code usually fail to install.',
		});
	}
	const tier = classifyEnv(manifest);
	if (tier === 'custom') {
		const reasons = [
			...((manifest.network?.length ?? 0) > 0 ? ['it declares network access'] : []),
			...(sources.pypi.length > 0 ? ['it needs PyPI packages'] : []),
			...(sources.bundled.length > 0 ? ['it bundles wheels'] : []),
		];
		notes.push({
			level: 'info',
			message: `Installed, it runs in the custom environment (one at a time) because ${reasons.join(' and ') || 'of its requirements'}.`,
		});
	} else {
		notes.push({
			level: 'info',
			message: 'Installed, it runs in the shared standard environment.',
		});
	}
	const unused = fileNames.filter(
		(name) => name.endsWith('.whl') && !manifest.requirements?.includes(name)
	);
	if (unused.length > 0) {
		notes.push({
			level: 'warning',
			message: `Wheels not listed in "requirements" (shipped but never installed): ${unused.join(', ')}`,
		});
	}
	if (!manifest.description) {
		notes.push({
			level: 'info',
			message: 'No "description"; the plugin list shows only the name.',
		});
	}
	if (notes.every((note) => note.level === 'info')) {
		notes.unshift({
			level: 'info',
			message: `fplugin.json is valid (${manifest.format}, ${manifest.applyStrategy}, ${fileNames.length} files).`,
		});
	}
	return notes;
}
