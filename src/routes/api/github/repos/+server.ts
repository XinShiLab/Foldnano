import { json, error } from '@sveltejs/kit';
import { githubFetchAsUser, positiveIntParam } from '$lib/services/github/server-utils';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies, url }) => {
	const type = url.searchParams.get('type') ?? 'all';
	const sort = url.searchParams.get('sort') ?? 'updated';
	const perPage = positiveIntParam(url.searchParams.get('per_page'), '30', 'per_page');
	const page = positiveIntParam(url.searchParams.get('page'), '1', 'page');

	const params = new URLSearchParams({ type, sort, per_page: perPage, page });
	const response = await githubFetchAsUser(cookies, `/user/repos?${params}`);

	if (!response.ok) {
		const body = await response.json().catch(() => ({}));
		error(response.status, body.message ?? 'GitHub API error');
	}

	return json(await response.json());
};
