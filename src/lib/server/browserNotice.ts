import type { Cookies } from '@sveltejs/kit';

const BROWSER_NOTICE_COOKIE_NAME = 'foldnano_browser_notice';
const BROWSER_NOTICE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
// Bump when the notice changes enough that people who dismissed it should see it once more.
const BROWSER_NOTICE_VERSION = 'v1';

export function hasDismissedBrowserNotice(cookies: Cookies): boolean {
	return cookies.get(BROWSER_NOTICE_COOKIE_NAME) === BROWSER_NOTICE_VERSION;
}

export function setBrowserNoticeCookie(cookies: Cookies, secure: boolean): void {
	cookies.set(BROWSER_NOTICE_COOKIE_NAME, BROWSER_NOTICE_VERSION, {
		path: '/',
		httpOnly: true,
		secure,
		sameSite: 'lax',
		maxAge: BROWSER_NOTICE_COOKIE_MAX_AGE_SECONDS,
	});
}
