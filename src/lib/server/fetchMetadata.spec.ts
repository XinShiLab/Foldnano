import { describe, expect, it } from 'vitest';
import { isCrossSiteScriptRequest } from './fetchMetadata';

const headers = (site?: string, mode?: string): Headers => {
	const h = new Headers();
	if (site) h.set('sec-fetch-site', site);
	if (mode) h.set('sec-fetch-mode', mode);
	return h;
};

describe('isCrossSiteScriptRequest', () => {
	it('allows same-origin fetches from the app', () => {
		expect(isCrossSiteScriptRequest(headers('same-origin', 'cors'))).toBe(false);
	});

	it('allows user-initiated navigations (address bar, bookmarks)', () => {
		expect(isCrossSiteScriptRequest(headers('none', 'navigate'))).toBe(false);
	});

	it('allows the cross-site OAuth callback navigation from github.com', () => {
		expect(isCrossSiteScriptRequest(headers('cross-site', 'navigate'))).toBe(false);
	});

	it('allows clients that send no Fetch Metadata', () => {
		expect(isCrossSiteScriptRequest(headers())).toBe(false);
	});

	it('rejects cross-site script requests, e.g. from the plugin sandbox', () => {
		expect(isCrossSiteScriptRequest(headers('cross-site', 'cors'))).toBe(true);
		expect(isCrossSiteScriptRequest(headers('cross-site', 'no-cors'))).toBe(true);
	});

	it('rejects same-site (other subdomain) script requests', () => {
		expect(isCrossSiteScriptRequest(headers('same-site', 'cors'))).toBe(true);
	});
});
