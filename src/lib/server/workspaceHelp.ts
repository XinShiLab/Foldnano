import type { Cookies } from '@sveltejs/kit';

const WORKSPACE_HELP_COOKIE_NAME = 'foldnano_workspace_help';
const WORKSPACE_HELP_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
// Bump when the help content changes enough that returning users should see it open once more.
const WORKSPACE_HELP_VERSION = 'v1';

export function hasSeenWorkspaceHelp(cookies: Cookies): boolean {
	return cookies.get(WORKSPACE_HELP_COOKIE_NAME) === WORKSPACE_HELP_VERSION;
}

export function setWorkspaceHelpCookie(cookies: Cookies, secure: boolean): void {
	cookies.set(WORKSPACE_HELP_COOKIE_NAME, WORKSPACE_HELP_VERSION, {
		path: '/',
		httpOnly: true,
		secure,
		sameSite: 'lax',
		maxAge: WORKSPACE_HELP_COOKIE_MAX_AGE_SECONDS,
	});
}
