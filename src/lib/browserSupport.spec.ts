import { describe, expect, it } from 'vitest';
import { isChromiumBrowser } from './browserSupport';

const nav = (userAgentData?: unknown) => ({ userAgentData }) as unknown as Navigator;

describe('isChromiumBrowser', () => {
	it.each([
		['Chrome', [{ brand: 'Chromium' }, { brand: 'Google Chrome' }, { brand: 'Not.A/Brand' }]],
		['Edge', [{ brand: 'Microsoft Edge' }, { brand: 'Chromium' }]],
	])('recognises %s', (_name, brands) => {
		expect(isChromiumBrowser(nav({ brands }))).toBe(true);
	});

	it('treats browsers without userAgentData (Firefox, Safari, iOS) as not Chromium', () => {
		expect(isChromiumBrowser(nav(undefined))).toBe(false);
	});

	it('does not match brand lists without Chromium', () => {
		expect(isChromiumBrowser(nav({ brands: [{ brand: 'Other' }] }))).toBe(false);
	});
});
