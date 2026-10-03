import { json } from '@sveltejs/kit';
import { githubFetchAsUser } from '$lib/services/github/server-utils';
import type { RequestHandler } from './$types';
import type { AuthStatus } from '$lib/services/github/types';

export const GET: RequestHandler = async ({ cookies }) => {
	try {
		// Renews an expired token too, so a returning user stays signed in.
		const response = await githubFetchAsUser(cookies, '/user');
		if (!response.ok) {
			return json({ authenticated: false } satisfies AuthStatus);
		}

		const user = await response.json();
		return json({
			authenticated: true,
			user: {
				login: user.login,
				avatar_url: user.avatar_url,
				name: user.name,
				html_url: user.html_url,
			},
		} satisfies AuthStatus);
	} catch {
		return json({ authenticated: false } satisfies AuthStatus);
	}
};
