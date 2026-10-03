import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isHttpError, type Cookies } from '@sveltejs/kit';

vi.mock('$env/dynamic/private', () => ({ env: {} }));

import {
	assertCommitSha,
	encodePathSegments,
	positiveIntParam,
	repoApiPath,
} from '../server-utils';
import { GET as getContents } from '../../../../routes/api/github/contents/+server';
import { GET as getTree } from '../../../../routes/api/github/trees/+server';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function statusOf(fn: () => unknown): number | null {
	try {
		fn();
		return null;
	} catch (e) {
		if (isHttpError(e)) return e.status;
		throw e;
	}
}

async function asyncStatusOf(result: unknown): Promise<number | null> {
	try {
		await result;
		return null;
	} catch (e) {
		if (isHttpError(e)) return e.status;
		throw e;
	}
}

const cookies = { get: (name: string) => (name === 'gh_token' ? 'at' : undefined) } as Cookies;

// Route handlers only read cookies and url; `never` lets one fake event serve every route.
function event(url: string): never {
	return { cookies, url: new URL(url, 'http://localhost') } as never;
}

beforeEach(() => mockFetch.mockReset());

describe('proxy parameter validation', () => {
	it.each([
		['alice', 'designs'],
		['my-org', 'repo.name_2'],
	])('accepts owner %s and repo %s', (owner, repo) => {
		expect(repoApiPath(owner, repo)).toBe(`/repos/${owner}/${repo}`);
	});

	it.each([
		[null, 'designs', 400],
		['..', 'designs', 400],
		['alice', '..', 400],
		['alice/x', 'designs', 400],
		['alice', 'designs?x=1', 400],
		['alice', 'de%2e%2e', 400],
	])('rejects owner %j and repo %j', (owner, repo, status) => {
		expect(statusOf(() => repoApiPath(owner, repo))).toBe(status);
	});

	it('encodes path segments and keeps the slashes', () => {
		expect(encodePathSegments('designs/ünïcode file#1.fn.json')).toBe(
			'designs/%C3%BCn%C3%AFcode%20file%231.fn.json'
		);
	});

	it.each(['../../user/repos', 'a/../b', '/leading', 'a//b', './a', 'a/'])(
		'rejects path %j',
		(path) => {
			expect(statusOf(() => encodePathSegments(path))).toBe(400);
		}
	);

	it('accepts only full commit SHAs', () => {
		expect(assertCommitSha('a'.repeat(40))).toBe('a'.repeat(40));
		expect(statusOf(() => assertCommitSha('../refs'))).toBe(400);
		expect(statusOf(() => assertCommitSha(undefined))).toBe(400);
	});

	it('accepts only small positive integers for paging', () => {
		expect(positiveIntParam(null, '30', 'per_page')).toBe('30');
		expect(positiveIntParam('100', '30', 'per_page')).toBe('100');
		expect(statusOf(() => positiveIntParam('1&type=x', '30', 'per_page'))).toBe(400);
		expect(statusOf(() => positiveIntParam('0', '30', 'per_page'))).toBe(400);
	});
});

describe('contents route', () => {
	it('refuses a path that climbs out of contents/, without calling GitHub', async () => {
		const status = await asyncStatusOf(
			getContents(event('/api/github/contents?owner=a&repo=b&path=../../user/repos'))
		);

		expect(status).toBe(400);
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it('still reads nested files with unicode names', async () => {
		mockFetch.mockResolvedValue(
			new Response(JSON.stringify({ encoding: 'base64', content: 'e30=', sha: 'a'.repeat(40) }))
		);

		await getContents(
			event('/api/github/contents?owner=a&repo=b&path=designs%2F%C3%BC.fn.json&ref=main')
		);

		expect(mockFetch.mock.calls[0][0]).toBe(
			'https://api.github.com/repos/a/b/contents/designs/%C3%BC.fn.json?ref=main'
		);
	});
});

describe('trees route', () => {
	it('keeps branch names with slashes working', async () => {
		mockFetch.mockResolvedValue(new Response(JSON.stringify({ tree: [] })));

		await getTree(event('/api/github/trees?owner=a&repo=b&sha=feature/x&recursive=1'));

		expect(mockFetch.mock.calls[0][0]).toBe(
			'https://api.github.com/repos/a/b/git/trees/feature/x?recursive=1'
		);
	});
});
