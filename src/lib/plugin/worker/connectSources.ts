/**
 * Reads the sandbox CSP's `connect-src` and matches URLs against it, so the worker can explain
 * blocked requests in browsers that don't report CSP violations to workers (Safari/WebKit).
 * Only diagnostics: the browser enforces the policy. Covers the source forms buildSandboxCsp
 * emits (scheme-only, host with optional `*.` and port, path prefixes); see
 * docs/python-plugin-system.md § Sandbox.
 */

/** The `connect-src` sources of a CSP, or null when it has no such directive. */
export function connectSourcesFromCsp(csp: string): string[] | null {
	for (const directive of csp.split(';')) {
		const [name, ...sources] = directive.trim().split(/\s+/);
		if (name === 'connect-src') return sources;
	}
	return null;
}

const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'https:': '443' };

function matchesSource(source: string, url: URL): boolean {
	if (source === "'none'") return false;
	if (/^[a-z][a-z0-9+.-]*:$/i.test(source)) return url.protocol === source.toLowerCase();

	const match = /^([a-z][a-z0-9+.-]*):\/\/(\*\.)?([^/:]+)(?::(\d+|\*))?(\/.*)?$/i.exec(source);
	if (!match) return false;
	const [, scheme, wildcard, host, port, path] = match;
	if (url.protocol !== `${scheme.toLowerCase()}:`) return false;

	const hostname = url.hostname.toLowerCase();
	const sourceHost = host.toLowerCase();
	if (wildcard ? !hostname.endsWith(`.${sourceHost}`) : hostname !== sourceHost) return false;

	const urlPort = url.port || DEFAULT_PORTS[url.protocol];
	if (port !== '*' && (port ?? DEFAULT_PORTS[url.protocol]) !== urlPort) return false;

	if (!path) return true;
	return path.endsWith('/') ? url.pathname.startsWith(path) : url.pathname === path;
}

/** True when `url` is allowed by one of the `connect-src` sources. */
export function isConnectAllowed(sources: readonly string[], url: URL): boolean {
	return sources.some((source) => matchesSource(source, url));
}
