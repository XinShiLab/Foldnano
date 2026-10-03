import { command, getRequestEvent } from '$app/server';

import { setBrowserNoticeCookie } from '$lib/server/browserNotice';

export const dismissBrowserNotice = command(() => {
	const { cookies, url } = getRequestEvent();
	setBrowserNoticeCookie(cookies, url.protocol === 'https:');
});
