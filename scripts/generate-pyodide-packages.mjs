/**
 * Regenerates src/lib/plugin/pyodideDistPackages.json — the package-name list
 * of the pinned Pyodide distribution, used by env classification (classifyEnv).
 *
 * The pin is read from src/lib/plugin/worker/pyodideConfig.ts so the worker,
 * the classifier, and this script cannot drift apart.
 *
 * Run manually after a Pyodide upgrade (npm package + pin):  pnpm gen:pyodide-packages
 * The output JSON is committed to git (it is an input to classification).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = join(root, 'src/lib/plugin/worker/pyodideConfig.ts');
const outPath = join(root, 'src/lib/plugin/pyodideDistPackages.json');

const configSource = readFileSync(configPath, 'utf8');
const versionMatch = configSource.match(/PYODIDE_VERSION\s*=\s*'(\d+\.\d+\.\d+)'/);
if (!versionMatch) {
	console.error(`Could not find PYODIDE_VERSION in ${configPath}`);
	process.exit(1);
}
const pyodideVersion = versionMatch[1];

// The self-hosted core ships this lock file, so read it from the pinned npm package.
const pyodidePackage = JSON.parse(
	readFileSync(join(root, 'node_modules/pyodide/package.json'), 'utf8')
);
if (pyodidePackage.version !== pyodideVersion) {
	console.error(
		`PYODIDE_VERSION ${pyodideVersion} does not match the installed pyodide ${pyodidePackage.version}`
	);
	process.exit(1);
}
const lock = JSON.parse(readFileSync(join(root, 'node_modules/pyodide/pyodide-lock.json'), 'utf8'));

const packages = [...new Set(Object.values(lock.packages).map((p) => p.name))].sort();

writeFileSync(outPath, JSON.stringify({ pyodideVersion, packages }, null, '\t') + '\n');
console.log(`Wrote ${packages.length} package names for pyodide-${pyodideVersion} to ${outPath}`);
