import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	listRepos,
	getFileContent,
	putFileContent,
	getRepoTree,
	listBranches,
	createBranch,
	listCommits,
	GitHubSessionExpiredError,
	GitHubNetworkError,
} from '../api';
import { githubAuth } from '../auth.svelte';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

function errorResponse(message: string, status: number) {
	return new Response(JSON.stringify({ message }), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

beforeEach(() => {
	mockFetch.mockReset();
});

describe('GitHub API client', () => {
	describe('listRepos', () => {
		it('calls /api/github/repos and returns repos', async () => {
			const repos = [{ id: 1, name: 'test-repo' }];
			mockFetch.mockResolvedValue(jsonResponse(repos));

			const result = await listRepos();
			expect(result).toEqual(repos);
			expect(mockFetch).toHaveBeenCalledWith('/api/github/repos', undefined);
		});

		it('passes query params for sort and pagination', async () => {
			mockFetch.mockResolvedValue(jsonResponse([]));

			await listRepos({ sort: 'created', perPage: 10, page: 2 });
			const url = mockFetch.mock.calls[0][0] as string;
			expect(url).toContain('sort=created');
			expect(url).toContain('per_page=10');
			expect(url).toContain('page=2');
		});
	});

	describe('getFileContent', () => {
		it('calls /api/github/contents with owner, repo, path', async () => {
			const file = { name: 'design.fn.json', sha: 'abc123', content: 'base64data' };
			mockFetch.mockResolvedValue(jsonResponse(file));

			const result = await getFileContent('alice', 'my-designs', 'designs/test.fn.json');
			expect(result).toEqual(file);
			const url = mockFetch.mock.calls[0][0] as string;
			expect(url).toContain('owner=alice');
			expect(url).toContain('repo=my-designs');
			expect(url).toContain('path=designs');
		});

		it('includes ref when provided', async () => {
			mockFetch.mockResolvedValue(jsonResponse({}));
			await getFileContent('alice', 'repo', 'file.json', 'feature-branch');
			const url = mockFetch.mock.calls[0][0] as string;
			expect(url).toContain('ref=feature-branch');
		});
	});

	describe('putFileContent', () => {
		it('sends PUT with file body', async () => {
			const response = { content: { sha: 'new_sha' }, commit: { sha: 'commit_sha' } };
			mockFetch.mockResolvedValue(jsonResponse(response));

			const result = await putFileContent('alice', 'repo', 'file.json', {
				message: 'update file',
				content: btoa('hello'),
				sha: 'old_sha',
			});
			expect(result).toEqual(response);
			const [url, init] = mockFetch.mock.calls[0];
			expect(url).toContain('owner=alice');
			expect(init.method).toBe('PUT');
			expect(JSON.parse(init.body)).toHaveProperty('message', 'update file');
		});
	});

	describe('getRepoTree', () => {
		it('calls /api/github/trees with owner and repo', async () => {
			const tree = { sha: 'tree_sha', tree: [] };
			mockFetch.mockResolvedValue(jsonResponse(tree));

			const result = await getRepoTree('alice', 'repo');
			expect(result).toEqual(tree);
			const url = mockFetch.mock.calls[0][0] as string;
			expect(url).toContain('owner=alice');
			expect(url).toContain('repo=repo');
		});

		it('passes recursive=1 when requested', async () => {
			mockFetch.mockResolvedValue(jsonResponse({ sha: '', tree: [] }));
			await getRepoTree('alice', 'repo', 'HEAD', true);
			const url = mockFetch.mock.calls[0][0] as string;
			expect(url).toContain('recursive=1');
		});
	});

	describe('listBranches', () => {
		it('calls /api/github/branches', async () => {
			const branches = [{ name: 'main', commit: { sha: 'abc' } }];
			mockFetch.mockResolvedValue(jsonResponse(branches));

			const result = await listBranches('alice', 'repo');
			expect(result).toEqual(branches);
		});
	});

	describe('createBranch', () => {
		it('sends POST to /api/github/branches', async () => {
			mockFetch.mockResolvedValue(jsonResponse({ ref: 'refs/heads/new-branch' }));

			await createBranch('alice', 'repo', 'new-branch', 'sha123');
			const [, init] = mockFetch.mock.calls[0];
			expect(init.method).toBe('POST');
			const body = JSON.parse(init.body);
			expect(body).toEqual({
				owner: 'alice',
				repo: 'repo',
				branch: 'new-branch',
				sha: 'sha123',
			});
		});
	});

	describe('listCommits', () => {
		it('calls /api/github/commits with options', async () => {
			const commits = [{ sha: 'abc', commit: { message: 'init' } }];
			mockFetch.mockResolvedValue(jsonResponse(commits));

			const result = await listCommits('alice', 'repo', { sha: 'main', perPage: 5 });
			expect(result).toEqual(commits);
			const url = mockFetch.mock.calls[0][0] as string;
			expect(url).toContain('sha=main');
			expect(url).toContain('per_page=5');
		});
	});

	describe('error handling', () => {
		it('throws GitHubApiError on non-OK response', async () => {
			mockFetch.mockResolvedValue(errorResponse('Not Found', 404));

			await expect(listRepos()).rejects.toThrow('Not Found');
		});

		it('includes status code in error', async () => {
			mockFetch.mockResolvedValue(errorResponse('Forbidden', 403));

			try {
				await listRepos();
				expect.fail('should have thrown');
			} catch (e: unknown) {
				expect((e as { status: number }).status).toBe(403);
			}
		});

		it('handles 401 unauthorized', async () => {
			mockFetch.mockResolvedValue(errorResponse('Not authenticated', 401));

			await expect(listRepos()).rejects.toThrow('Your GitHub session has expired');
		});
	});
});

describe('expired GitHub session', () => {
	beforeEach(() => {
		githubAuth.authenticated = true;
		githubAuth.sessionExpired = false;
	});

	it('flags the session as expired and throws a friendly error', async () => {
		mockFetch
			.mockResolvedValueOnce(errorResponse('Not authenticated', 401))
			.mockResolvedValueOnce(jsonResponse({ authenticated: false }));

		await expect(listRepos()).rejects.toBeInstanceOf(GitHubSessionExpiredError);

		expect(githubAuth.sessionExpired).toBe(true);
		expect(githubAuth.authenticated).toBe(false);
	});

	it('retries once when another request already renewed the session', async () => {
		mockFetch
			.mockResolvedValueOnce(errorResponse('Not authenticated', 401))
			.mockResolvedValueOnce(jsonResponse({ authenticated: true, user: { login: 'alice' } }))
			.mockResolvedValueOnce(jsonResponse([{ id: 1 }]));

		await expect(listRepos()).resolves.toEqual([{ id: 1 }]);

		expect(githubAuth.sessionExpired).toBe(false);
	});

	it('does not claim an expired session for someone who never signed in', async () => {
		githubAuth.authenticated = false;
		mockFetch
			.mockResolvedValueOnce(errorResponse('Not authenticated', 401))
			.mockResolvedValueOnce(jsonResponse({ authenticated: false }));

		await expect(listRepos()).rejects.toBeInstanceOf(GitHubSessionExpiredError);

		expect(githubAuth.sessionExpired).toBe(false);
	});
});

describe('unreachable GitHub', () => {
	it('turns "Failed to fetch" into a plain network error', async () => {
		mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

		const error = await listRepos().catch((e) => e);

		expect(error).toBeInstanceOf(GitHubNetworkError);
		expect(error.message).toBe(
			"Couldn't reach GitHub. Check your internet connection and try again."
		);
	});
});
