import { json, error } from '@sveltejs/kit';
import {
	encodePathSegments,
	githubFetchAsUser,
	repoApiPath,
} from '$lib/services/github/server-utils';
import type { RequestHandler } from './$types';

/** GET: get repo tree. Query params: owner, repo, sha (tree SHA or branch), recursive */
export const GET: RequestHandler = async ({ cookies, url }) => {
	const repoPath = repoApiPath(url.searchParams.get('owner'), url.searchParams.get('repo'));
	// A tree SHA or a branch name, which may contain slashes.
	const treeRef = encodePathSegments(url.searchParams.get('sha') ?? 'HEAD', 'sha');

	const recursive = url.searchParams.get('recursive') === '1' ? '?recursive=1' : '';
	const response = await githubFetchAsUser(cookies, `${repoPath}/git/trees/${treeRef}${recursive}`);

	if (!response.ok) {
		const body = await response.json().catch(() => ({}));
		error(response.status, body.message ?? 'GitHub API error');
	}

	return json(await response.json());
};
