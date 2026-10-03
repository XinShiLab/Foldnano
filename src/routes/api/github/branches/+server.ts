import { json, error } from '@sveltejs/kit';
import {
	assertCommitSha,
	githubFetchAsUser,
	positiveIntParam,
	repoApiPath,
} from '$lib/services/github/server-utils';
import type { RequestHandler } from './$types';

/** GET: list branches. Query params: owner, repo */
export const GET: RequestHandler = async ({ cookies, url }) => {
	const repoPath = repoApiPath(url.searchParams.get('owner'), url.searchParams.get('repo'));
	const perPage = positiveIntParam(url.searchParams.get('per_page'), '30', 'per_page');
	const response = await githubFetchAsUser(cookies, `${repoPath}/branches?per_page=${perPage}`);

	if (!response.ok) {
		const body = await response.json().catch(() => ({}));
		error(response.status, body.message ?? 'GitHub API error');
	}

	return json(await response.json());
};

/** POST: create a branch. Body: { owner, repo, branch, sha } */
export const POST: RequestHandler = async ({ cookies, request }) => {
	const { owner, repo, branch, sha } = await request.json();
	if (!branch || typeof branch !== 'string') error(400, 'Missing branch');
	const repoPath = repoApiPath(owner, repo);
	assertCommitSha(sha);

	const response = await githubFetchAsUser(cookies, `${repoPath}/git/refs`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
	});

	if (!response.ok) {
		const body = await response.json().catch(() => ({}));
		error(response.status, body.message ?? 'GitHub API error');
	}

	return json(await response.json());
};
