import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isHttpError, type Cookies } from '@sveltejs/kit';

vi.mock('$env/dynamic/private', () => ({
	env: { GITHUB_APP_CLIENT_ID: 'client-id', GITHUB_APP_CLIENT_SECRET: 'client-secret' },
}));

import {
	exchangeCodeForToken,
	githubFetchAsUser,
	safeReturnPath,
	setTokenCookies,
} from '../server-utils';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function json(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), { status });
}

function fakeCookies(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial));
	const options = new Map<string, object>();
	const cookies = {
		get: (name: string) => values.get(name),
		set: (name: string, value: string, opts: object) => {
			values.set(name, value);
			options.set(name, opts);
		},
		delete: (name: string) => values.delete(name),
	} as unknown as Cookies;
	return { cookies, values, options };
}

const isTokenRequest = (call: unknown[]) =>
	String(call[0]).startsWith('https://github.com/login/oauth/access_token');

async function httpStatusOf(promise: Promise<unknown>): Promise<number | null> {
	try {
		await promise;
		return null;
	} catch (e) {
		if (isHttpError(e)) return e.status;
		throw e;
	}
}

beforeEach(() => mockFetch.mockReset());

describe('token cookies', () => {
	it('keeps the refresh token from the code exchange, with GitHub lifetimes', async () => {
		mockFetch.mockResolvedValue(
			json({
				access_token: 'at',
				expires_in: 28800,
				refresh_token: 'rt',
				refresh_token_expires_in: 15897600,
			})
		);
		const { cookies, values, options } = fakeCookies();

		setTokenCookies(cookies, await exchangeCodeForToken('code'));

		expect(values.get('gh_token')).toBe('at');
		expect(values.get('gh_refresh')).toBe('rt');
		expect(options.get('gh_token')).toMatchObject({ httpOnly: true, maxAge: 28800, path: '/' });
		expect(options.get('gh_refresh')).toMatchObject({ httpOnly: true, path: '/api' });
	});

	it('stores no refresh cookie for tokens that do not expire', () => {
		const { cookies, values } = fakeCookies();

		setTokenCookies(cookies, { accessToken: 'at' });

		expect(values.has('gh_refresh')).toBe(false);
	});
});

describe('githubFetchAsUser', () => {
	it('uses the stored token when GitHub accepts it', async () => {
		mockFetch.mockResolvedValue(json({ login: 'alice' }));
		const { cookies } = fakeCookies({ gh_token: 'at' });

		const response = await githubFetchAsUser(cookies, '/user');

		expect(response.status).toBe(200);
		expect(mockFetch).toHaveBeenCalledOnce();
		expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer at');
	});

	it('renews once and retries when GitHub rejects an expired token', async () => {
		mockFetch
			.mockResolvedValueOnce(json({ message: 'Bad credentials' }, 401))
			.mockResolvedValueOnce(json({ access_token: 'at2', refresh_token: 'rt2' }))
			.mockResolvedValueOnce(json({ login: 'alice' }));
		const { cookies, values } = fakeCookies({ gh_token: 'at', gh_refresh: 'rt' });

		const response = await githubFetchAsUser(cookies, '/user');

		expect(response.status).toBe(200);
		expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toMatchObject({
			grant_type: 'refresh_token',
			refresh_token: 'rt',
		});
		expect(mockFetch.mock.calls[2][1].headers.Authorization).toBe('Bearer at2');
		expect(values.get('gh_token')).toBe('at2');
		expect(values.get('gh_refresh')).toBe('rt2');
	});

	it('renews first when the access cookie has already expired', async () => {
		mockFetch
			.mockResolvedValueOnce(json({ access_token: 'at2', refresh_token: 'rt2' }))
			.mockResolvedValueOnce(json({ login: 'alice' }));
		const { cookies } = fakeCookies({ gh_refresh: 'rt' });

		await githubFetchAsUser(cookies, '/user');

		expect(isTokenRequest(mockFetch.mock.calls[0])).toBe(true);
		expect(mockFetch.mock.calls[1][1].headers.Authorization).toBe('Bearer at2');
	});

	it('answers 401 without a session', async () => {
		const { cookies } = fakeCookies();

		expect(await httpStatusOf(githubFetchAsUser(cookies, '/user'))).toBe(401);
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it('answers 401 when renewal fails, keeping cookies a parallel request may have rotated', async () => {
		mockFetch
			.mockResolvedValueOnce(json({ message: 'Bad credentials' }, 401))
			.mockResolvedValueOnce(json({ error: 'bad_refresh_token' }));
		const { cookies, values } = fakeCookies({ gh_token: 'at', gh_refresh: 'rt' });
		vi.spyOn(console, 'error').mockImplementation(() => {});

		expect(await httpStatusOf(githubFetchAsUser(cookies, '/user'))).toBe(401);
		expect(values.get('gh_refresh')).toBe('rt');
	});

	it('passes other errors through untouched', async () => {
		mockFetch.mockResolvedValue(json({ message: 'Not Found' }, 404));
		const { cookies } = fakeCookies({ gh_token: 'at', gh_refresh: 'rt' });

		const response = await githubFetchAsUser(cookies, '/repos/a/b');

		expect(response.status).toBe(404);
		expect(mockFetch).toHaveBeenCalledOnce();
	});
});

describe('safeReturnPath', () => {
	it.each(['/editor/abc', '/editor/abc?x=1', '/docs/guide#top'])('accepts %s', (path) => {
		expect(safeReturnPath(path)).toBe(path);
	});

	it.each([
		null,
		'',
		'editor',
		'https://evil.example/',
		'//evil.example/',
		'/\\evil.example/',
		'/\t/evil.example/',
		'/\n/evil.example/',
	])('rejects %j', (path) => {
		expect(safeReturnPath(path)).toBeNull();
	});
});
