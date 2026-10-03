import { describe, expect, it } from 'vitest';
import { connectSourcesFromCsp, isConnectAllowed } from './connectSources';
import { buildSandboxCsp } from './sandboxHost';
import { connectSourcesFor } from '../networkPolicy';
import { pyodideUrls } from './pyodideConfig';

const allowed = (sources: string[], url: string) => isConnectAllowed(sources, new URL(url));

describe('connectSourcesFromCsp', () => {
	it('reads the connect-src list', () => {
		expect(connectSourcesFromCsp("default-src 'none'; connect-src https://a.org https:")).toEqual([
			'https://a.org',
			'https:',
		]);
	});

	it('returns null without a connect-src directive', () => {
		expect(connectSourcesFromCsp("default-src 'none'")).toBeNull();
	});
});

describe('isConnectAllowed', () => {
	it('matches exact hosts on the default port only', () => {
		expect(allowed(['https://api.example.org'], 'https://api.example.org/v1/x')).toBe(true);
		expect(allowed(['https://api.example.org'], 'https://api.example.org:8443/')).toBe(false);
		expect(allowed(['https://api.example.org'], 'http://api.example.org/')).toBe(false);
		expect(allowed(['https://api.example.org'], 'https://example.org/')).toBe(false);
	});

	it('matches *. subdomains but not the bare domain', () => {
		expect(allowed(['https://*.example.org'], 'https://a.b.example.org/')).toBe(true);
		expect(allowed(['https://*.example.org'], 'https://example.org/')).toBe(false);
	});

	it('matches explicit ports and loopback http', () => {
		expect(allowed(['http://localhost:8000'], 'http://localhost:8000/data')).toBe(true);
		expect(allowed(['http://localhost:8000'], 'http://localhost:8001/data')).toBe(false);
	});

	it('matches path prefixes (the Pyodide core and package paths)', () => {
		const pkg = 'https://cdn.jsdelivr.net/pyodide/v0.29.5/full/';
		expect(allowed([pkg], `${pkg}numpy-2.2.5.whl`)).toBe(true);
		expect(allowed([pkg], 'https://cdn.jsdelivr.net/npm/evil.js')).toBe(false);
	});

	it('matches scheme-only sources ("*" in the manifest)', () => {
		expect(allowed(['https:'], 'https://anything.example/')).toBe(true);
		expect(allowed(['https:'], 'http://anything.example/')).toBe(false);
	});

	it('agrees with the CSP the sandbox is actually given', () => {
		const csp = buildSandboxCsp(
			connectSourcesFor({ network: ['api.example.org'], requirements: ['humanize'] })
		);
		const sources = connectSourcesFromCsp(csp)!;
		const { indexUrl } = pyodideUrls(location.href);
		expect(allowed(sources, `${indexUrl}pyodide.asm.wasm`)).toBe(true);
		expect(allowed(sources, 'https://api.example.org/x')).toBe(true);
		expect(allowed(sources, 'https://files.pythonhosted.org/packages/x.whl')).toBe(true);
		expect(allowed(sources, `${location.origin}/api/github/user`)).toBe(false);
		expect(allowed(sources, 'https://example.org/')).toBe(false);
	});
});
