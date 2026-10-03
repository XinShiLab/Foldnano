/**
 * True for a request to our API issued by script from another site — including the
 * opaque-origin plugin sandbox. Top-level navigations stay allowed: the OAuth callback
 * arrives cross-site from github.com. Clients without Fetch Metadata headers pass; the
 * SameSite=Lax session cookie still applies to them.
 */
export function isCrossSiteScriptRequest(headers: Headers): boolean {
	const site = headers.get('sec-fetch-site');
	if (site === null || site === 'same-origin' || site === 'none') return false;
	return headers.get('sec-fetch-mode') !== 'navigate';
}
