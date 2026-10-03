import type { Cookies } from '@sveltejs/kit';

const PRIVACY_NOTICE_COOKIE_NAME = 'foldnano_privacy_notice';
const PRIVACY_NOTICE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
// Bump when the notice text changes materially so every visitor sees the new version once.
export const PRIVACY_NOTICE_VERSION = 'v1';

export function hasDismissedPrivacyNotice(cookies: Cookies): boolean {
	return cookies.get(PRIVACY_NOTICE_COOKIE_NAME) === PRIVACY_NOTICE_VERSION;
}

export function setPrivacyNoticeCookie(cookies: Cookies, secure: boolean): void {
	cookies.set(PRIVACY_NOTICE_COOKIE_NAME, PRIVACY_NOTICE_VERSION, {
		path: '/',
		httpOnly: true,
		secure,
		sameSite: 'lax',
		maxAge: PRIVACY_NOTICE_COOKIE_MAX_AGE_SECONDS,
	});
}
