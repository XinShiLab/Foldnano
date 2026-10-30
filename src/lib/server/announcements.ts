import type { Cookies } from '@sveltejs/kit';

const ANNOUNCEMENT_COOKIE_NAME = 'foldnano_announcement';
const WHATS_NEW_COOKIE_NAME = 'foldnano_whats_new';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

// Both cookies hold a watermark (newest id/key seen), not a version: newer entries supersede it.
function setWatermarkCookie(cookies: Cookies, name: string, value: string, secure: boolean): void {
	cookies.set(name, value, {
		path: '/',
		httpOnly: true,
		secure,
		sameSite: 'lax',
		maxAge: COOKIE_MAX_AGE_SECONDS,
	});
}

export function seenAnnouncementId(cookies: Cookies): string | null {
	return cookies.get(ANNOUNCEMENT_COOKIE_NAME) ?? null;
}

export function setSeenAnnouncementCookie(cookies: Cookies, id: string, secure: boolean): void {
	setWatermarkCookie(cookies, ANNOUNCEMENT_COOKIE_NAME, id, secure);
}

export function seenWhatsNewKey(cookies: Cookies): string | null {
	return cookies.get(WHATS_NEW_COOKIE_NAME) ?? null;
}

export function setSeenWhatsNewCookie(cookies: Cookies, key: string, secure: boolean): void {
	setWatermarkCookie(cookies, WHATS_NEW_COOKIE_NAME, key, secure);
}
