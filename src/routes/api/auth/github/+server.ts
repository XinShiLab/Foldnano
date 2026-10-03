import { redirect } from '@sveltejs/kit';
import { getOAuthAuthorizeUrl, safeReturnPath } from '$lib/services/github/server-utils';
import type { RequestHandler } from './$types';

const SHORT_LIVED_COOKIE = {
	path: '/',
	httpOnly: true,
	secure: true,
	sameSite: 'lax',
	maxAge: 60 * 10, // 10 minutes
} as const;

export const GET: RequestHandler = async ({ cookies, url }) => {
	const state = crypto.randomUUID();
	cookies.set('gh_oauth_state', state, SHORT_LIVED_COOKIE);

	// "Sign in again" after an expired session returns the user to the design they were on.
	const returnTo = safeReturnPath(url.searchParams.get('returnTo'));
	if (returnTo) cookies.set('gh_oauth_return', returnTo, SHORT_LIVED_COOKIE);
	else cookies.delete('gh_oauth_return', { path: '/' });

	const authorizeUrl = getOAuthAuthorizeUrl(state);
	redirect(302, authorizeUrl);
};
