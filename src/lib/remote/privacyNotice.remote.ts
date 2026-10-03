import { form, getRequestEvent } from '$app/server';

import { setPrivacyNoticeCookie } from '$lib/server/privacyNotice';

export const dismissPrivacyNotice = form(() => {
	const { cookies, url } = getRequestEvent();
	setPrivacyNoticeCookie(cookies, url.protocol === 'https:');
	return { success: true };
});
