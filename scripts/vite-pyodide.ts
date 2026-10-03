import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'vite';

const PACKAGE_DIR = path.resolve('node_modules/pyodide');
const { version } = JSON.parse(readFileSync(path.join(PACKAGE_DIR, 'package.json'), 'utf8')) as {
	version: string;
};

/** Must equal PYODIDE_CORE_PATH in src/lib/plugin/worker/pyodideConfig.ts (a spec checks it). */
export const PYODIDE_CORE_PATH = `/pyodide/v${version}/`;

/** The core files loadPyodide fetches; packages come from the CDN via the lock file. */
export const PYODIDE_CORE_FILES: Readonly<Record<string, string>> = {
	'pyodide.mjs': 'text/javascript',
	'pyodide.asm.js': 'text/javascript',
	'pyodide.asm.wasm': 'application/wasm',
	'python_stdlib.zip': 'application/zip',
	'pyodide-lock.json': 'application/json',
};

/**
 * Emits the Pyodide core from the pinned `pyodide` npm package into the client build at
 * `/pyodide/v<version>/`. vercel.json adds the CORS header the opaque-origin plugin sandbox
 * needs. Not served in dev: Chrome's local-network protection blocks the sandbox from fetching
 * localhost, so loopback pages load the same release from the CDN (pyodideUrls).
 * See docs/python-plugin-system.md § Sandbox.
 */
export function selfHostedPyodide(): Plugin {
	return {
		name: 'foldnano:self-hosted-pyodide',
		apply: 'build',
		async generateBundle() {
			if (this.environment.name !== 'client') return;
			for (const name of Object.keys(PYODIDE_CORE_FILES)) {
				this.emitFile({
					type: 'asset',
					fileName: `${PYODIDE_CORE_PATH.slice(1)}${name}`,
					source: await readFile(path.join(PACKAGE_DIR, name)),
				});
			}
		},
	};
}
