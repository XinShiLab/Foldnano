import { describe, expect, it } from 'vitest';
import {
	connectSourcesFor,
	declaredConnectSources,
	networkEntryError,
	PYPI_CONNECT_SOURCES,
	validateNetwork,
} from './networkPolicy';

describe('networkEntryError', () => {
	it.each(['api.example.org', '*.example.org', 'example.org:8443', 'localhost:8000', '127.0.0.1'])(
		'accepts %s',
		(entry) => {
			expect(networkEntryError(entry)).toBeNull();
		}
	);

	it('accepts "*" for any host', () => {
		expect(networkEntryError('*')).toBeNull();
	});

	it.each([
		['https://api.example.org', /without a scheme/],
		['api.example.org/v1', /without a scheme or path/],
		['API.example.org', /lowercase/],
		['intranet', /fully qualified/],
		['example.org:70000', /invalid port/],
		['*', null],
	])('explains why %s is rejected', (entry, expected) => {
		const problem = networkEntryError(entry);
		if (expected === null) expect(problem).toBeNull();
		else expect(problem).toMatch(expected);
	});

	it.each([
		"example.org 'unsafe-eval'",
		'example.org; script-src *',
		'example.org"><script>',
		'exa mple.org',
		'',
		'*.*.org',
	])('rejects %j, which could inject into the CSP or HTML', (entry) => {
		expect(networkEntryError(entry)).not.toBeNull();
	});

	it('rejects non-strings', () => {
		expect(networkEntryError(42)).toMatch(/string/);
	});
});

describe('validateNetwork', () => {
	it('accepts an empty list (no network)', () => {
		expect(() => validateNetwork([])).not.toThrow();
	});

	it('rejects a non-array', () => {
		expect(() => validateNetwork('api.example.org')).toThrow(/array/);
	});

	it('names the offending entry', () => {
		expect(() => validateNetwork(['api.example.org', 'https://evil.org'])).toThrow(
			/"https:\/\/evil\.org"/
		);
	});

	it('requires "*" to stand alone', () => {
		expect(() => validateNetwork(['*', 'api.example.org'])).toThrow(/alone/);
	});
});

describe('declaredConnectSources', () => {
	it('grants nothing when network is omitted or empty', () => {
		expect(declaredConnectSources(undefined)).toEqual([]);
		expect(declaredConnectSources([])).toEqual([]);
	});

	it('maps hosts to https sources and loopback to http', () => {
		expect(
			declaredConnectSources(['api.example.org', 'localhost:8000', 'api.example.org'])
		).toEqual(['https://api.example.org', 'http://localhost:8000']);
	});

	it('maps "*" to any HTTPS host', () => {
		expect(declaredConnectSources(['*'])).toEqual(['https:']);
	});
});

describe('connectSourcesFor', () => {
	it('adds PyPI only when a requirement resolves there', () => {
		expect(connectSourcesFor({ requirements: ['numpy'] })).toEqual([]);
		expect(connectSourcesFor({ requirements: ['humanize'] })).toEqual([...PYPI_CONNECT_SOURCES]);
		expect(connectSourcesFor({ requirements: ['numpy==1.26.4'] })).toEqual([
			...PYPI_CONNECT_SOURCES,
		]);
	});

	it('combines declared hosts with PyPI', () => {
		expect(connectSourcesFor({ network: ['api.example.org'], requirements: ['humanize'] })).toEqual(
			['https://api.example.org', ...PYPI_CONNECT_SOURCES]
		);
	});
});
