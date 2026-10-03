/**
 * Typed client-side wrapper for the GitHub proxy API routes.
 * All calls go through SvelteKit server routes — the token stays in httpOnly cookies.
 */
import type {
	GitHubRepo,
	GitHubBranch,
	GitHubTree,
	GitHubFileContent,
	GitHubCommit,
	GitHubPutFileRequest,
	GitHubPutFileResponse,
} from './types';

import { getAuthStatus, githubAuth, markGitHubSessionExpired } from './auth.svelte';

export class GitHubApiError extends Error {
	constructor(
		message: string,
		public status: number
	) {
		super(message);
		this.name = 'GitHubApiError';
	}
}

export class GitHubSessionExpiredError extends GitHubApiError {
	constructor() {
		super(
			'Your GitHub session has expired. Sign in again to continue; your work is saved in this browser.',
			401
		);
		this.name = 'GitHubSessionExpiredError';
	}
}

/** A commit was refused because the file changed on GitHub since the tracked SHA. */
export class GitHubConflictError extends Error {
	constructor() {
		super(
			'This file changed on GitHub since your last sync. Review the changes before committing.'
		);
		this.name = 'GitHubConflictError';
	}
}

/** GitHub's answer to a write against a stale or missing file SHA: 409, or 422 about `sha`. */
export function isShaConflict(e: unknown): boolean {
	return (
		e instanceof GitHubApiError &&
		(e.status === 409 || (e.status === 422 && /sha/i.test(e.message)))
	);
}

/** The request never reached the server (offline, DNS, blocked). */
export class GitHubNetworkError extends GitHubApiError {
	constructor() {
		super("Couldn't reach GitHub. Check your internet connection and try again.", 0);
		this.name = 'GitHubNetworkError';
	}
}

async function send(path: string, init?: RequestInit): Promise<Response> {
	try {
		return await fetch(path, init);
	} catch {
		// fetch only rejects when no response arrived; the browser's "Failed to fetch" says little.
		throw new GitHubNetworkError();
	}
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
	let response = await send(path, init);
	if (response.status === 401) {
		// Read before the status check below, which updates it.
		const wasSignedIn = githubAuth.authenticated;
		// A parallel request may have just renewed the session; retry once if the server agrees.
		const status = await getAuthStatus();
		if (status.authenticated) response = await send(path, init);
		if (response.status === 401) {
			markGitHubSessionExpired(wasSignedIn);
			throw new GitHubSessionExpiredError();
		}
	}
	if (!response.ok) {
		const body = await response.json().catch(() => ({ message: response.statusText }));
		throw new GitHubApiError(body.message ?? response.statusText, response.status);
	}
	return response.json();
}

function qs(params: Record<string, string | undefined>): string {
	const filtered = Object.entries(params).filter(
		(entry): entry is [string, string] => entry[1] !== undefined
	);
	if (filtered.length === 0) return '';
	return '?' + new URLSearchParams(filtered).toString();
}

// --- Repos ---

export async function listRepos(opts?: {
	type?: string;
	sort?: string;
	perPage?: number;
	page?: number;
}): Promise<GitHubRepo[]> {
	return apiFetch(
		`/api/github/repos${qs({
			type: opts?.type,
			sort: opts?.sort,
			per_page: opts?.perPage?.toString(),
			page: opts?.page?.toString(),
		})}`
	);
}

// --- Contents ---

export async function getFileContent(
	owner: string,
	repo: string,
	path: string,
	ref?: string
): Promise<GitHubFileContent> {
	return apiFetch(`/api/github/contents${qs({ owner, repo, path, ref })}`);
}

export async function putFileContent(
	owner: string,
	repo: string,
	path: string,
	body: GitHubPutFileRequest
): Promise<GitHubPutFileResponse> {
	return apiFetch(`/api/github/contents${qs({ owner, repo, path })}`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
}

export async function deleteFileContent(
	owner: string,
	repo: string,
	path: string,
	body: { message: string; sha: string; branch?: string }
): Promise<unknown> {
	return apiFetch(`/api/github/contents${qs({ owner, repo, path })}`, {
		method: 'DELETE',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
}

// --- Trees ---

export async function getRepoTree(
	owner: string,
	repo: string,
	sha?: string,
	recursive?: boolean
): Promise<GitHubTree> {
	return apiFetch(
		`/api/github/trees${qs({
			owner,
			repo,
			sha,
			recursive: recursive ? '1' : undefined,
		})}`
	);
}

// --- Branches ---

export async function listBranches(
	owner: string,
	repo: string,
	perPage?: number
): Promise<GitHubBranch[]> {
	return apiFetch(`/api/github/branches${qs({ owner, repo, per_page: perPage?.toString() })}`);
}

export async function createBranch(
	owner: string,
	repo: string,
	branch: string,
	sha: string
): Promise<unknown> {
	return apiFetch('/api/github/branches', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ owner, repo, branch, sha }),
	});
}

// --- Commits ---

export async function listCommits(
	owner: string,
	repo: string,
	opts?: { sha?: string; path?: string; perPage?: number; page?: number }
): Promise<GitHubCommit[]> {
	return apiFetch(
		`/api/github/commits${qs({
			owner,
			repo,
			sha: opts?.sha,
			path: opts?.path,
			per_page: opts?.perPage?.toString(),
			page: opts?.page?.toString(),
		})}`
	);
}
