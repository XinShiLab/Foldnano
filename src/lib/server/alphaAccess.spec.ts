import { describe, expect, it } from 'vitest';

import {
	ALPHA_ACCESS_COOKIE_PATH,
	alphaAccessCodeMatches,
	alphaAccessCookieIsValid,
	alphaAccessGranted,
	buildAlphaAccessCookieValue,
	normalizeAlphaAccessCode,
} from './alphaAccess';

describe('alphaAccess', () => {
	it('normalizes access codes by trimming only', () => {
		expect(normalizeAlphaAccessCode('  Alpha Code  ')).toBe('Alpha Code');
	});

	it('accepts a valid code after trimming user input', () => {
		expect(alphaAccessCodeMatches('  secret-code  ', ['secret-code'])).toBe(true);
	});

	it('rejects wrong, empty, and missing configured codes', () => {
		expect(alphaAccessCodeMatches('wrong-code', ['secret-code'])).toBe(false);
		expect(alphaAccessCodeMatches('   ', ['secret-code'])).toBe(false);
		expect(alphaAccessCodeMatches('secret-code', [])).toBe(false);
	});

	it('grants access to everyone when no code is configured', () => {
		expect(alphaAccessGranted(undefined, [])).toBe(true);
		expect(alphaAccessGranted('v1.stale', [])).toBe(true);
	});

	it('requires a valid cookie when a code is configured', () => {
		expect(alphaAccessGranted(undefined, ['secret-code'])).toBe(false);
		expect(alphaAccessGranted('v1.stale', ['secret-code'])).toBe(false);
		expect(alphaAccessGranted(buildAlphaAccessCookieValue('secret-code'), ['secret-code'])).toBe(
			true
		);
	});

	it('accepts any code from a list of multiple configured codes', () => {
		const codes = ['code-a', 'code-b', 'code-c'];
		expect(alphaAccessCodeMatches('code-a', codes)).toBe(true);
		expect(alphaAccessCodeMatches('code-b', codes)).toBe(true);
		expect(alphaAccessCodeMatches('code-c', codes)).toBe(true);
		expect(alphaAccessCodeMatches('code-d', codes)).toBe(false);
	});

	it('stores a derived cookie value instead of the raw code', () => {
		const cookieValue = buildAlphaAccessCookieValue('secret-code');

		expect(cookieValue).not.toContain('secret-code');
		expect(alphaAccessCookieIsValid(cookieValue, ['secret-code'])).toBe(true);
	});

	it('invalidates cookies when the configured code changes', () => {
		const cookieValue = buildAlphaAccessCookieValue('old-code');

		expect(alphaAccessCookieIsValid(cookieValue, ['new-code'])).toBe(false);
	});

	it('validates a cookie built from any code in a multi-code list', () => {
		const cookieValue = buildAlphaAccessCookieValue('code-b');

		expect(alphaAccessCookieIsValid(cookieValue, ['code-a', 'code-b', 'code-c'])).toBe(true);
	});

	it('invalidates a cookie once its code is removed from the configured list', () => {
		const cookieValue = buildAlphaAccessCookieValue('code-b');

		expect(alphaAccessCookieIsValid(cookieValue, ['code-a', 'code-c'])).toBe(false);
	});

	it('scopes the access cookie to all protected app routes', () => {
		expect(ALPHA_ACCESS_COOKIE_PATH).toBe('/');
	});
});
