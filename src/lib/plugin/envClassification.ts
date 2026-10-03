/**
 * Environment classification for the two-tier plugin worker model.
 *
 * Plugins whose dependencies are fully determined by the pinned Pyodide
 * distribution (plus first-party standard extras) share one persistent
 * "standard" worker; everything else routes to a single "custom" worker slot
 * with single-active eviction semantics. See
 * docs/python-plugin-system.md § Environment tiers.
 *
 * Classification only routes plugins — it never refuses them. The hard-reject
 * gate (SUPPORTED_REQUIREMENTS_ALLOWLIST in manifestValidation.ts) is separate
 * and stays permissive.
 */

import distPackages from './pyodideDistPackages.json';

export type PluginEnvTier = 'standard' | 'custom';

/**
 * First-party pinned wheels that are members of the standard environment.
 * Authors write the bare name in `requirements`; the host resolves the pinned
 * URL at activation time. Version bumps are a one-line registry edit.
 */
export const STANDARD_ENV_EXTRAS: Record<string, { url: string; version: string }> = {
	cadnano2_5_mini: {
		url: '/plugins/cadnano_mini/v0.1.0/cadnano2_5_mini-0.1.0-py3-none-any.whl',
		version: '0.1.0',
	},
};

/** Pyodide version the vendored dist list was generated from (drift-checked in tests). */
export const DIST_LIST_PYODIDE_VERSION: string = distPackages.pyodideVersion;

/** A syntactically bare package name — no version specifier, extras, or URL parts. */
const BARE_NAME_RE = /^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?$/;

/** PEP 503 name normalization: case-insensitive, runs of [-_.] collapse to '-'. */
function normalizePackageName(name: string): string {
	return name.toLowerCase().replace(/[-_.]+/g, '-');
}

const DIST_PACKAGE_SET = new Set(distPackages.packages.map(normalizePackageName));

/**
 * Requirements micropip resolves from PyPI instead of the pinned Pyodide
 * distribution: off-dist names and anything with a version specifier, extras
 * or URL parts. Standard extras and wheels never touch PyPI.
 */
export function pypiRequirements(manifest: { requirements?: string[] }): string[] {
	return (manifest.requirements ?? []).filter(
		(req) =>
			!STANDARD_ENV_EXTRAS[req] &&
			!req.endsWith('.whl') &&
			!(BARE_NAME_RE.test(req) && DIST_PACKAGE_SET.has(normalizePackageName(req)))
	);
}

/** A plugin's requirements grouped by where they come from, for disclosure. */
export interface RequirementSources {
	/** Pinned Pyodide distribution packages, loaded from the Pyodide CDN. */
	distribution: string[];
	/** Resolved from PyPI by micropip: third-party code the app doesn't pin or review. */
	pypi: string[];
	/** Wheels shipped inside the plugin zip. */
	bundled: string[];
	/** First-party wheels served by Foldnano (standard extras and same-origin paths). */
	firstParty: string[];
}

export function requirementSources(manifest: { requirements?: string[] }): RequirementSources {
	const sources: RequirementSources = { distribution: [], pypi: [], bundled: [], firstParty: [] };
	const pypi = new Set(pypiRequirements(manifest));
	for (const req of manifest.requirements ?? []) {
		if (STANDARD_ENV_EXTRAS[req]) sources.firstParty.push(req);
		else if (req.endsWith('.whl'))
			(/[/\\:]/.test(req) ? sources.firstParty : sources.bundled).push(req);
		else if (pypi.has(req)) sources.pypi.push(req);
		else sources.distribution.push(req);
	}
	return sources;
}

/**
 * Classify a plugin's dependency tier. Static and decidable from the manifest
 * alone, so the UI can badge plugins at install time.
 *
 * `standard` iff the plugin declares no network access and every
 * `requirements` entry is either a standard-extra name or a bare (unversioned)
 * name in the pinned Pyodide distribution. Network access, any wheel, any
 * version specifier (even one matching the dist version), or any off-dist
 * name classifies as `custom`: the shared standard worker stays network-free.
 */
export function classifyEnv(manifest: {
	requirements?: string[];
	network?: string[];
}): PluginEnvTier {
	if ((manifest.network?.length ?? 0) > 0) return 'custom';
	const reqs = manifest.requirements ?? [];
	if (reqs.some((req) => !STANDARD_ENV_EXTRAS[req] && req.endsWith('.whl'))) return 'custom';
	return pypiRequirements(manifest).length > 0 ? 'custom' : 'standard';
}
