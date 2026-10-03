import { json, error } from '@sveltejs/kit';
import {
	githubFetchAsUser,
	positiveIntParam,
	repoApiPath,
} from '$lib/services/github/server-utils';
import type { RequestHandler } from './$types';

/** GET: list commits. Query params: owner, repo, sha (branch), path, per_page, page */
export const GET: RequestHandler = async ({ cookies, url }) => {
	const repoPath = repoApiPath(url.searchParams.get('owner'), url.searchParams.get('repo'));

	const params = new URLSearchParams();
	const sha = url.searchParams.get('sha');
	const path = url.searchParams.get('path');
	const perPage = url.searchParams.get('per_page');
	const page = url.searchParams.get('page');
	if (sha) params.set('sha', sha);
	if (path) params.set('path', path);
	if (perPage) params.set('per_page', positiveIntParam(perPage, '30', 'per_page'));
	if (page) params.set('page', positiveIntParam(page, '1', 'page'));

	const response = await githubFetchAsUser(cookies, `${repoPath}/commits?${params}`);

	if (!response.ok) {
		const body = await response.json().catch(() => ({}));
		error(response.status, body.message ?? 'GitHub API error');
	}

	return json(await response.json());
};
