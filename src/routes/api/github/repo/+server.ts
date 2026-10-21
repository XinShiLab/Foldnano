import { json, error } from '@sveltejs/kit';
import { githubFetchAsUser, repoApiPath } from '$lib/services/github/server-utils';
import type { RequestHandler } from './$types';

/** GET: one repository's metadata (e.g. its default branch). Query params: owner, repo */
export const GET: RequestHandler = async ({ cookies, url }) => {
	const repoPath = repoApiPath(url.searchParams.get('owner'), url.searchParams.get('repo'));
	const response = await githubFetchAsUser(cookies, repoPath);

	if (!response.ok) {
		const body = await response.json().catch(() => ({}));
		error(response.status, body.message ?? 'GitHub API error');
	}

	return json(await response.json());
};
