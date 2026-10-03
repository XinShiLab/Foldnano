/**
 * Server-side utilities for GitHub auth.
 * Only import this file from +server.ts routes (uses private env).
 */
import { env } from '$env/dynamic/private';
import { error, type Cookies } from '@sveltejs/kit';

const COOKIE_NAME = 'gh_token';
// Only the proxy and auth routes under /api need the refresh token.
const REFRESH_COOKIE_NAME = 'gh_refresh';
const REFRESH_COOKIE_PATH = '/api';
const DEFAULT_TOKEN_MAX_AGE_S = 60 * 60 * 8;
const DEFAULT_REFRESH_MAX_AGE_S = 60 * 60 * 24 * 180;
const GITHUB_OAUTH_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
export const GITHUB_API_BASE = 'https://api.github.com';

export function getOAuthAuthorizeUrl(state: string): string {
	const clientId = env.GITHUB_APP_CLIENT_ID ?? '';
	// Always use the standard OAuth authorize URL. This issues a code for both
	// new users (first auth) and returning users (token refresh). Installation
	// is a separate step handled by getAppInstallManageUrl(). Using
	// installations/new here breaks re-auth: when the app is already installed,
	// GitHub skips the install UI and redirects back without a code.
	const params = new URLSearchParams({ client_id: clientId, state });
	return `${GITHUB_OAUTH_URL}?${params.toString()}`;
}

/** URL for a user to install or manage which repos the GitHub App can access. */
export function getAppInstallManageUrl(): string {
	const appName = env.GITHUB_APP_NAME;
	return appName ? `https://github.com/apps/${appName}/installations/new` : '';
}

/** What GitHub returns from its token endpoint; refresh fields exist only for expiring tokens. */
export interface GitHubTokenSet {
	accessToken: string;
	expiresIn?: number;
	refreshToken?: string;
	refreshTokenExpiresIn?: number;
}

async function requestToken(params: Record<string, string>): Promise<GitHubTokenSet> {
	const clientId = env.GITHUB_APP_CLIENT_ID;
	const clientSecret = env.GITHUB_APP_CLIENT_SECRET;

	if (!clientId || !clientSecret) {
		throw new Error(
			`[GitHubAuth] Missing env vars: GITHUB_APP_CLIENT_ID=${clientId ? 'set' : 'MISSING'}, GITHUB_APP_CLIENT_SECRET=${clientSecret ? 'set' : 'MISSING'}`
		);
	}

	const response = await fetch(GITHUB_TOKEN_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json',
		},
		body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, ...params }),
	});

	const data = await response.json();

	if (!response.ok) {
		console.error('[GitHubAuth] Token request HTTP error:', response.status, data);
		throw new Error(`GitHub token request failed: ${response.status}`);
	}

	if (data.error) {
		console.error('[GitHubAuth] OAuth error:', data.error, data.error_description);
		throw new Error(`GitHub OAuth error: ${data.error_description || data.error}`);
	}

	return {
		accessToken: data.access_token,
		expiresIn: data.expires_in,
		refreshToken: data.refresh_token,
		refreshTokenExpiresIn: data.refresh_token_expires_in,
	};
}

export function exchangeCodeForToken(code: string): Promise<GitHubTokenSet> {
	return requestToken({ code });
}

export function refreshAccessToken(refreshToken: string): Promise<GitHubTokenSet> {
	return requestToken({ grant_type: 'refresh_token', refresh_token: refreshToken });
}

export function setTokenCookies(cookies: Cookies, tokens: GitHubTokenSet): void {
	cookies.set(COOKIE_NAME, tokens.accessToken, {
		path: '/',
		httpOnly: true,
		secure: true,
		sameSite: 'lax',
		maxAge: tokens.expiresIn ?? DEFAULT_TOKEN_MAX_AGE_S,
	});
	// Tokens without expiry come with no refresh token; nothing to renew then.
	if (tokens.refreshToken) {
		cookies.set(REFRESH_COOKIE_NAME, tokens.refreshToken, {
			path: REFRESH_COOKIE_PATH,
			httpOnly: true,
			secure: true,
			sameSite: 'lax',
			maxAge: tokens.refreshTokenExpiresIn ?? DEFAULT_REFRESH_MAX_AGE_S,
		});
	}
}

export function clearTokenCookies(cookies: Cookies): void {
	cookies.delete(COOKIE_NAME, { path: '/' });
	cookies.delete(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
}

export function getTokenFromCookies(cookies: Cookies): string | undefined {
	return cookies.get(COOKIE_NAME);
}

export async function githubApiFetch(
	token: string,
	path: string,
	init?: RequestInit
): Promise<Response> {
	const url = path.startsWith('http') ? path : `${GITHUB_API_BASE}${path}`;
	return fetch(url, {
		...init,
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2022-11-28',
			...init?.headers,
		},
	});
}

/** Renews the access token from the refresh cookie; null when there is none or it failed. */
async function renewAccessToken(cookies: Cookies): Promise<string | null> {
	const refreshToken = cookies.get(REFRESH_COOKIE_NAME);
	if (!refreshToken) return null;
	try {
		const tokens = await refreshAccessToken(refreshToken);
		setTokenCookies(cookies, tokens);
		return tokens.accessToken;
	} catch (e) {
		// Cookies are left alone: a parallel request may already have rotated the refresh token.
		console.error('[GitHubAuth] Token refresh failed:', e);
		return null;
	}
}

/**
 * Calls the GitHub API as the signed-in user. An expired or missing access token is renewed
 * once from the refresh cookie and the request retried; without a usable session this throws
 * a 401 the client treats as "session expired".
 */
export async function githubFetchAsUser(
	cookies: Cookies,
	path: string,
	init?: RequestInit
): Promise<Response> {
	let token = getTokenFromCookies(cookies) ?? (await renewAccessToken(cookies));
	if (!token) error(401, 'Not authenticated');

	let response = await githubApiFetch(token, path, init);
	if (response.status === 401) {
		token = await renewAccessToken(cookies);
		if (!token) error(401, 'GitHub session expired');
		response = await githubApiFetch(token, path, init);
		if (response.status === 401) error(401, 'GitHub session expired');
	}
	return response;
}

/**
 * Where to send the user after sign-in: a same-site path only, so the parameter can't be used
 * to redirect to another site.
 */
export function safeReturnPath(raw: string | null | undefined): string | null {
	// Control characters and backslashes can turn "/x" into "//host" once a browser cleans it up.
	// eslint-disable-next-line no-control-regex
	if (!raw || !raw.startsWith('/') || /[\u0000-\u001f\\]/.test(raw)) return null;
	const base = 'https://return.invalid';
	const url = new URL(raw, base);
	if (url.origin !== base) return null;
	return `${url.pathname}${url.search}${url.hash}`;
}

// Query parameters end up inside GitHub API URLs; unchecked, "../" could reach other endpoints
// with the user's token. Every proxy route builds its URL through these helpers.
const GITHUB_NAME = /^[\w.-]+$/;
const COMMIT_SHA = /^[0-9a-f]{40}$/i;

/** `/repos/{owner}/{repo}` for valid GitHub owner and repository names, else a 400. */
export function repoApiPath(owner: string | null, repo: string | null): string {
	if (!owner || !repo) error(400, 'Missing owner or repo');
	const valid = (name: string) => GITHUB_NAME.test(name) && name !== '.' && name !== '..';
	if (!valid(owner) || !valid(repo)) error(400, 'Invalid owner or repo');
	return `/repos/${owner}/${repo}`;
}

/**
 * A slash-separated file path or ref name, encoded segment by segment. Rejects empty, `.` and
 * `..` segments, so the result can't climb out of the endpoint it is appended to.
 */
export function encodePathSegments(value: string, what = 'path'): string {
	const segments = value.split('/');
	if (segments.some((s) => s === '' || s === '.' || s === '..')) error(400, `Invalid ${what}`);
	return segments.map(encodeURIComponent).join('/');
}

export function assertCommitSha(sha: unknown): string {
	if (typeof sha !== 'string' || !COMMIT_SHA.test(sha)) error(400, 'Invalid sha');
	return sha;
}

/** A positive integer query value (page sizes, page numbers), else a 400. */
export function positiveIntParam(value: string | null, fallback: string, what: string): string {
	const v = value ?? fallback;
	if (!/^[1-9]\d{0,3}$/.test(v)) error(400, `Invalid ${what}`);
	return v;
}
