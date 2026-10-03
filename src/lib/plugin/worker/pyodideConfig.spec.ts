import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	PYODIDE_CORE_FILES,
	PYODIDE_CORE_PATH as SERVED_CORE_PATH,
} from '../../../../scripts/vite-pyodide';
import {
	PYODIDE_CORE_PATH,
	PYODIDE_PACKAGE_BASE_URL,
	PYODIDE_PYTHON_VERSION,
	PYODIDE_VERSION,
	pyodideUrls,
} from './pyodideConfig';

// The worker loads the core the Vite plugin serves from the pinned npm package; a mismatch
// would 404 at activation or pair the runtime with the wrong lock file.

const PACKAGE_DIR = path.resolve('node_modules/pyodide');
const readJson = (file: string): unknown =>
	JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, file), 'utf-8'));

describe('Pyodide pin', () => {
	it('matches the installed pyodide package', () => {
		expect((readJson('package.json') as { version: string }).version).toBe(PYODIDE_VERSION);
	});

	it('names the Python version of the pinned lock file', () => {
		const lock = readJson('pyodide-lock.json') as { info: { python: string } };
		expect(lock.info.python).toBe(PYODIDE_PYTHON_VERSION);
	});

	it('loads the core from the path the Vite plugin serves', () => {
		expect(SERVED_CORE_PATH).toBe(PYODIDE_CORE_PATH);
		for (const file of Object.keys(PYODIDE_CORE_FILES)) {
			expect(fs.existsSync(path.join(PACKAGE_DIR, file)), file).toBe(true);
		}
	});

	it('takes packages from the same Pyodide release', () => {
		expect(PYODIDE_PACKAGE_BASE_URL).toContain(`/v${PYODIDE_VERSION}/full/`);
	});
});

describe('pyodideUrls', () => {
	it('self-hosts the core on a deployed site and takes packages from the CDN', () => {
		expect(pyodideUrls('https://foldnano.example/editor?doc=1', true)).toEqual({
			indexUrl: `https://foldnano.example${PYODIDE_CORE_PATH}`,
			packageBaseUrl: PYODIDE_PACKAGE_BASE_URL,
		});
	});

	it('loads the pinned release from the CDN on Vercel preview builds', () => {
		expect(pyodideUrls('https://app-git-branch.vercel.app/editor', false)).toEqual({
			indexUrl: PYODIDE_PACKAGE_BASE_URL,
			packageBaseUrl: PYODIDE_PACKAGE_BASE_URL,
		});
	});

	it.each(['http://localhost:5173/editor', 'http://127.0.0.1:4173/', 'http://app.localhost/'])(
		'loads the pinned release from the CDN on loopback page %s',
		(page) => {
			expect(pyodideUrls(page)).toEqual({
				indexUrl: PYODIDE_PACKAGE_BASE_URL,
				packageBaseUrl: PYODIDE_PACKAGE_BASE_URL,
			});
		}
	);
});
