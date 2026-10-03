/**
 * Pinned Pyodide release — the single source of truth for the runtime version.
 *
 * This pin is also the standard plugin environment's identity: upgrading it IS
 * the env version bump. It must match the exact `pyodide` devDependency, whose
 * core files the app serves itself (scripts/vite-pyodide.ts); a spec guards the
 * match. After changing it, rerun `pnpm gen:pyodide-packages` to refresh the
 * vendored dist-package list used by env classification.
 */
export const PYODIDE_VERSION = '0.29.5';

/** Python version of the pinned Pyodide (its lock file's `info.python`). */
export const PYODIDE_PYTHON_VERSION = '3.13.2';

/** Same-origin path of the self-hosted core (pyodide.mjs, asm, stdlib, lock file). */
export const PYODIDE_CORE_PATH = `/pyodide/v${PYODIDE_VERSION}/`;

/**
 * Distribution packages (numpy, …) still come from the CDN; Pyodide checks each
 * against the sha256 in the self-hosted lock file.
 */
export const PYODIDE_PACKAGE_BASE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

/** The same pinned release on the CDN (core and packages). */
const CDN_INDEX_URL = PYODIDE_PACKAGE_BASE_URL;

/** Development override: load everything from another full Pyodide distribution. */
const INDEX_URL_OVERRIDE = import.meta.env.VITE_PYODIDE_INDEX_URL as string | undefined;

export interface PyodideUrls {
	/** Absolute URL of the directory holding the core files. */
	indexUrl: string;
	/** Absolute URL that lock-file package file names resolve against. */
	packageBaseUrl: string;
}

function isLoopbackHost(hostname: string): boolean {
	return (
		hostname === 'localhost' ||
		hostname.endsWith('.localhost') ||
		hostname === '127.0.0.1' ||
		hostname === '[::1]'
	);
}

/**
 * Absolute Pyodide URLs for the page at `pageUrl`. Resolved on the main thread:
 * the sandboxed worker has an opaque origin and can't resolve the app's paths.
 * `selfHosted` is false on Vercel preview builds (see vite.config.ts).
 */
export function pyodideUrls(pageUrl: string, selfHosted = __PYODIDE_SELF_HOSTED__): PyodideUrls {
	if (INDEX_URL_OVERRIDE) {
		const url = new URL(INDEX_URL_OVERRIDE, pageUrl).href;
		return { indexUrl: url, packageBaseUrl: url };
	}
	// Chrome's local-network protection blocks the opaque-origin sandbox from fetching loopback
	// hosts, so dev and `pnpm preview` can't use the self-hosted core.
	if (!selfHosted || isLoopbackHost(new URL(pageUrl).hostname)) {
		return { indexUrl: CDN_INDEX_URL, packageBaseUrl: CDN_INDEX_URL };
	}
	return {
		indexUrl: new URL(PYODIDE_CORE_PATH, pageUrl).href,
		packageBaseUrl: PYODIDE_PACKAGE_BASE_URL,
	};
}
