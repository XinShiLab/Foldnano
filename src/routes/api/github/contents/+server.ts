import { json, error } from '@sveltejs/kit';
import {
	assertCommitSha,
	encodePathSegments,
	githubFetchAsUser,
	repoApiPath,
} from '$lib/services/github/server-utils';
import type { RequestHandler } from './$types';

/** GET: fetch file content. Query params: owner, repo, path, ref (optional) */
export const GET: RequestHandler = async ({ cookies, url }) => {
	const repoPath = repoApiPath(url.searchParams.get('owner'), url.searchParams.get('repo'));
	const path = url.searchParams.get('path') ?? '';
	const ref = url.searchParams.get('ref');

	const params = ref ? `?ref=${encodeURIComponent(ref)}` : '';
	const filePath = path ? encodePathSegments(path) : '';
	const apiPath = `${repoPath}/contents/${filePath}${params}`;
	const response = await githubFetchAsUser(cookies, apiPath);

	if (!response.ok) {
		const body = await response.json().catch(() => ({}));
		error(response.status, body.message ?? 'GitHub API error');
	}

	const data = await response.json();

	// The Contents API returns content: "" with encoding: "none" for files > 1 MB.
	// Fall back to the Git Blobs API, which handles files up to 100 MB.
	if (data.encoding !== 'base64' || !data.content?.trim()) {
		const blobPath = `${repoPath}/git/blobs/${assertCommitSha(data.sha)}`;
		const blobResponse = await githubFetchAsUser(cookies, blobPath);
		if (!blobResponse.ok) {
			const errBody = await blobResponse.json().catch(() => ({}));
			error(blobResponse.status, errBody.message ?? 'GitHub Blobs API error');
		}
		const blob = await blobResponse.json();
		return json({ ...data, content: blob.content, encoding: blob.encoding });
	}

	return json(data);
};

/** DELETE: delete a file. Body: { message, sha, branch? } */
export const DELETE: RequestHandler = async ({ cookies, url, request }) => {
	const repoPath = repoApiPath(url.searchParams.get('owner'), url.searchParams.get('repo'));
	const path = url.searchParams.get('path');
	if (!path) error(400, 'Missing path');

	const body = await request.json();
	const apiPath = `${repoPath}/contents/${encodePathSegments(path)}`;
	const response = await githubFetchAsUser(cookies, apiPath, {
		method: 'DELETE',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});

	if (!response.ok) {
		const errBody = await response.json().catch(() => ({}));
		error(response.status, errBody.message ?? 'GitHub API error');
	}

	return json(await response.json());
};

/** PUT: create or update a file. Body: { message, content (base64), sha?, branch? } */
export const PUT: RequestHandler = async ({ cookies, url, request }) => {
	const repoPath = repoApiPath(url.searchParams.get('owner'), url.searchParams.get('repo'));
	const path = url.searchParams.get('path');
	if (!path) error(400, 'Missing path');

	const body = await request.json();
	const apiPath = `${repoPath}/contents/${encodePathSegments(path)}`;
	const response = await githubFetchAsUser(cookies, apiPath, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});

	if (!response.ok) {
		const errBody = await response.json().catch(() => ({}));
		error(response.status, errBody.message ?? 'GitHub API error');
	}

	return json(await response.json());
};
