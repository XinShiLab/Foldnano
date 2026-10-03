/**
 * Log lines for packages loaded from a code-editor script's imports
 * (RUN_PLUGIN `loadImports`). See docs/script-lab.md § Packages.
 */

/** One `[env] loaded` line per package Pyodide loaded for this run. */
export function loadedPackageLogs(
	packages: ReadonlyArray<{ name: string; version: string }>
): string[] {
	return packages.map((pkg) => `[env] loaded ${pkg.name} ${pkg.version}`);
}

/**
 * Hint for an import that failed after loading: the module is not in the Pyodide
 * distribution, so only a packaged plugin with `requirements` can install it.
 */
export function missingModuleHint(error: string): string | null {
	const name = /No module named '([^'.]+)/.exec(error)?.[1];
	if (!name) return null;
	return (
		`[env] "${name}" is not a Pyodide package, so scripts can't import it. ` +
		`Package the script as a plugin zip and list "${name}" under "requirements".`
	);
}
