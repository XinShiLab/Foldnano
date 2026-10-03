/**
 * Plugin network permissions: the manifest's `network` field and the CSP
 * `connect-src` sources it grants inside the plugin sandbox.
 *
 * Entries are host names (optionally `*.`-prefixed or with a port), or the
 * single entry `"*"` for any HTTPS host. Entries go straight into a CSP and an
 * HTML attribute, so validation is strict: no schemes, paths, quotes or spaces.
 * See docs/python-plugin-system.md § Sandbox.
 */

import { pypiRequirements } from './envClassification';

/** Manifest `network` entry granting any HTTPS host. */
export const ANY_HOST = '*';

/** Hosts micropip contacts when installing PyPI requirements. */
export const PYPI_CONNECT_SOURCES: readonly string[] = [
	'https://pypi.org',
	'https://files.pythonhosted.org',
];

const LABEL = '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?';
const HOST_RE = new RegExp(`^(?:\\*\\.)?${LABEL}(?:\\.${LABEL})*(?::\\d{1,5})?$`);
/** Hosts reached over plain http (browsers treat loopback as potentially trustworthy). */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1']);

function hostName(entry: string): string {
	return entry.replace(/:\d+$/, '');
}

/** Why a `network` entry is invalid, or null when it is valid. */
export function networkEntryError(entry: unknown): string | null {
	if (typeof entry !== 'string') return 'must be a string';
	if (entry === ANY_HOST) return null;
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(entry) || entry.includes('/'))
		return 'must be a host name only, without a scheme or path (e.g. "api.example.org")';
	if (entry !== entry.toLowerCase()) return 'must be lowercase';
	if (!HOST_RE.test(entry)) return 'is not a valid host name';
	const port = /:(\d+)$/.exec(entry)?.[1];
	if (port !== undefined && Number(port) > 65535) return 'has an invalid port';
	const host = hostName(entry);
	if (!host.includes('.') && !LOOPBACK_HOSTS.has(host))
		return 'must be a fully qualified host name (e.g. "api.example.org")';
	return null;
}

/** Validates a manifest `network` value; throws with a user-facing message. */
export function validateNetwork(network: unknown): void {
	if (!Array.isArray(network)) throw new Error('"network" must be an array of host names');
	for (const entry of network as unknown[]) {
		const problem = networkEntryError(entry);
		if (problem) throw new Error(`"network" entry ${JSON.stringify(entry)} ${problem}`);
	}
	if (network.includes(ANY_HOST) && network.length > 1)
		throw new Error(`"network": "${ANY_HOST}" already allows every host; list it alone`);
}

/** CSP sources for a validated `network` declaration (empty = no network). */
export function declaredConnectSources(network: readonly string[] | undefined): string[] {
	if (!network || network.length === 0) return [];
	if (network.includes(ANY_HOST)) return ['https:'];
	return [...new Set(network)].map((entry) =>
		LOOPBACK_HOSTS.has(hostName(entry)) ? `http://${entry}` : `https://${entry}`
	);
}

/**
 * Full `connect-src` allowlist for a plugin's sandbox (the Pyodide origin is
 * added by buildSandboxCsp): declared hosts, plus PyPI when a requirement
 * resolves there.
 */
export function connectSourcesFor(manifest: {
	network?: string[];
	requirements?: string[];
}): string[] {
	const sources = declaredConnectSources(manifest.network);
	if (pypiRequirements(manifest).length > 0) sources.push(...PYPI_CONNECT_SOURCES);
	return sources;
}
