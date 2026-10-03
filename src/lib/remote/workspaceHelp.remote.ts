import { command, getRequestEvent } from '$app/server';

import { setWorkspaceHelpCookie } from '$lib/server/workspaceHelp';

export const markWorkspaceHelpSeen = command(() => {
	const { cookies, url } = getRequestEvent();
	setWorkspaceHelpCookie(cookies, url.protocol === 'https:');
});
