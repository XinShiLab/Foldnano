import { redirect, error } from '@sveltejs/kit';
import {
	exchangeCodeForToken,
	safeReturnPath,
	setTokenCookies,
	type GitHubTokenSet,
} from '$lib/services/github/server-utils';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const storedState = cookies.get('gh_oauth_state');

	if (!code) {
		// This happens when the user lands here via the GitHub App management page
		// (installations/new with an already-installed app): GitHub redirects back
		// with setup_action=update but no code. Send them through proper OAuth.
		cookies.delete('gh_oauth_state', { path: '/' });
		redirect(302, '/api/auth/github');
	}

	// A code is only exchanged when it comes back with the state we issued; anything else could
	// sign the user into someone else's account (login CSRF).
	if (!storedState) {
		if (state) {
			// Our own sign-in, but the state cookie is gone (blocked or expired). Redirecting would
			// loop, so explain instead.
			error(
				400,
				'Sign-in could not be verified. Allow cookies for this site and try signing in again.'
			);
		}
		// Arrived without our state, e.g. from installing the app on GitHub: discard this code and
		// run the normal sign-in, which sets and checks the state.
		redirect(302, '/api/auth/github');
	}
	if (state !== storedState) {
		error(403, 'Invalid OAuth state');
	}

	// Clean up the state cookie
	cookies.delete('gh_oauth_state', { path: '/' });

	let tokens: GitHubTokenSet;
	try {
		tokens = await exchangeCodeForToken(code);
	} catch (e) {
		console.error('[GitHubAuth] Token exchange failed:', e);
		error(500, 'Failed to authenticate with GitHub');
	}

	setTokenCookies(cookies, tokens);
	const returnTo = safeReturnPath(cookies.get('gh_oauth_return')) ?? '/editor';
	cookies.delete('gh_oauth_return', { path: '/' });
	redirect(302, returnTo);
};
