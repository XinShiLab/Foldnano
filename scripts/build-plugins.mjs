// Builds the bundled plugin zips consumed by the plugin Hub and demos.
//
// Every file/URL-delivered plugin is a single zip containing an authoritative
// fplugin.json + plugin.py + supporting files. Source of truth:
//   - manifests:    src/lib/plugin/core_plugins/<name>.fplugin.json
//   - plugin files: static/plugins/<dir>/
// The manifest's entrypointUrl must be "/plugins/<dir>/<dir>.zip"; this script
// zips the matching source dir and injects the manifest as fplugin.json so the
// inner (authoritative) copy is always identical to the Hub pointer.
//
// Dirs under static/plugins/ that carry their own fplugin.json (e.g.
// local_demo, the Import-zip sample) are zipped standalone.
//
// Run: pnpm build:plugins  (also chained into dev/build)

import { zipSync } from 'fflate';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CORE_PLUGINS_DIR = join(root, 'src/lib/plugin/core_plugins');
const STATIC_PLUGINS_DIR = join(root, 'static/plugins');

const EXCLUDE = /(^|\/)(__pycache__|\.DS_Store)|\.zip$|\.pyc$/;

/** Recursively collect dir contents as { zipRelativePath: bytes }. */
function collectFiles(dir, base = dir) {
	const out = {};
	for (const entry of readdirSync(dir)) {
		const abs = join(dir, entry);
		const rel = relative(base, abs).split('\\').join('/');
		if (EXCLUDE.test(rel) || EXCLUDE.test(entry)) continue;
		if (statSync(abs).isDirectory()) {
			Object.assign(out, collectFiles(abs, base));
		} else {
			out[rel] = readFileSync(abs);
		}
	}
	return out;
}

function buildZip(dirName, files, label) {
	const outPath = join(STATIC_PLUGINS_DIR, dirName, `${dirName}.zip`);
	writeFileSync(outPath, zipSync(files, { level: 9 }));
	console.log(
		`built plugins/${dirName}/${dirName}.zip (${label}, ${Object.keys(files).length} files)`
	);
}

const builtDirs = new Set();
let failures = 0;

// Core plugins: manifest from core_plugins/, files from static/plugins/<dir>/.
for (const manifestFile of readdirSync(CORE_PLUGINS_DIR).filter((f) =>
	f.endsWith('.fplugin.json')
)) {
	const manifestPath = join(CORE_PLUGINS_DIR, manifestFile);
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
	const url = manifest.entrypointUrl ?? '';
	const match = url.match(/^\/plugins\/([^/]+)\/\1\.zip$/);
	if (!match) {
		// Runtime-code manifests (inline placeholder entrypoint) have no zip.
		if (manifest.entrypoint && manifest.sidePanel?.codeEditor?.execution === 'entrypoint') continue;
		console.error(
			`ERROR ${manifestFile}: entrypointUrl must be "/plugins/<dir>/<dir>.zip" (got "${url}")`
		);
		failures++;
		continue;
	}
	const dirName = match[1];
	let files;
	try {
		files = collectFiles(join(STATIC_PLUGINS_DIR, dirName));
	} catch (e) {
		console.error(`ERROR ${manifestFile}: cannot read static/plugins/${dirName}: ${e.message}`);
		failures++;
		continue;
	}
	if (files['fplugin.json']) {
		console.error(
			`ERROR ${manifestFile}: static/plugins/${dirName} has its own fplugin.json — ` +
				'core plugin manifests live in core_plugins/ only.'
		);
		failures++;
		continue;
	}
	if (!files['plugin.py']) {
		console.error(`ERROR ${manifestFile}: no plugin.py in static/plugins/${dirName}`);
		failures++;
		continue;
	}
	files['fplugin.json'] = readFileSync(manifestPath);
	buildZip(dirName, files, manifest.id);
	builtDirs.add(dirName);
}

// Standalone sample plugins: dirs that ship their own fplugin.json (local_demo).
for (const dirName of readdirSync(STATIC_PLUGINS_DIR)) {
	const dir = join(STATIC_PLUGINS_DIR, dirName);
	if (builtDirs.has(dirName) || !statSync(dir).isDirectory()) continue;
	let files;
	try {
		files = collectFiles(dir);
	} catch {
		continue;
	}
	if (!files['fplugin.json']) continue;
	if (!files['plugin.py']) {
		console.error(`ERROR static/plugins/${dirName}: fplugin.json present but no plugin.py`);
		failures++;
		continue;
	}
	buildZip(dirName, files, 'standalone');
}

if (failures > 0) {
	console.error(`build-plugins: ${failures} error(s)`);
	process.exit(1);
}
