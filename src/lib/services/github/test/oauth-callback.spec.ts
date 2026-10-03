import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isHttpError, isRedirect, type Cookies } from '@sveltejs/kit';

vi.mock('$env/dynamic/private', () => ({
	env: { GITHUB_APP_CLIENT_ID: 'client-id', GITHUB_APP_CLIENT_SECRET: 'client-secret' },
}));

import { GET as callback } from '../../../../routes/api/auth/github/callback/+server';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function fakeCookies(initial: Record<string, string>) {
	const values = new Map(Object.entries(initial));
	const cookies = {
		get: (name: string) => values.get(name),
		set: (name: string, value: string) => values.set(name, value),
		delete: (name: string) => values.delete(name),
	} as unknown as Cookies;
	return { cookies, values };
}

async function outcome(query: string, cookieValues: Record<string, string>) {
	const { cookies, values } = fakeCookies(cookieValues);
	const event = {
		cookies,
		url: new URL(`/api/auth/github/callback?${query}`, 'http://localhost'),
	} as unknown as Parameters<typeof callback>[0];
	try {
		await callback(event);
		return { kind: 'returned', values } as const;
	} catch (e) {
		if (isRedirect(e)) return { kind: 'redirect', location: e.location, values } as const;
		if (isHttpError(e)) return { kind: 'error', status: e.status, values } as const;
		throw e;
	}
}

beforeEach(() => mockFetch.mockReset());

describe('OAuth callback state check', () => {
	it('discards a code that arrives without our state and restarts sign-in', async () => {
		const result = await outcome('code=attacker-code', {});

		expect(result).toMatchObject({ kind: 'redirect', location: '/api/auth/github' });
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it('explains instead of looping when our state came back but the cookie is gone', async () => {
		const result = await outcome('code=c&state=s1', {});

		expect(result).toMatchObject({ kind: 'error', status: 400 });
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it('rejects a state that does not match the cookie', async () => {
		const result = await outcome('code=c&state=other', { gh_oauth_state: 's1' });

		expect(result).toMatchObject({ kind: 'error', status: 403 });
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it('signs in and returns to the saved page when the state matches', async () => {
		mockFetch.mockResolvedValue(new Response(JSON.stringify({ access_token: 'at' })));

		const result = await outcome('code=c&state=s1', {
			gh_oauth_state: 's1',
			gh_oauth_return: '/editor/doc-1',
		});

		expect(result).toMatchObject({ kind: 'redirect', location: '/editor/doc-1' });
		expect(result.values.get('gh_token')).toBe('at');
		expect(result.values.has('gh_oauth_state')).toBe(false);
		expect(result.values.has('gh_oauth_return')).toBe(false);
	});
});
