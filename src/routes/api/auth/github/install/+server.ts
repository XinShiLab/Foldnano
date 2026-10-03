import { redirect, error } from '@sveltejs/kit';
import { getAppInstallManageUrl } from '$lib/services/github/server-utils';
import type { RequestHandler } from './$types';

/**
 * Redirect the user to the GitHub App installation/management page so they
 * can grant (or expand) access to their repositories.  This is used from
 * the "Manage app access" link in the RepoSetupDialog for users who are
 * already authenticated but cannot see their private repos.
 */
export const GET: RequestHandler = async () => {
	const url = getAppInstallManageUrl();
	if (!url) {
		error(501, 'GITHUB_APP_NAME is not configured');
	}
	redirect(302, url);
};
