import { createHash, timingSafeEqual } from 'node:crypto';

import { env } from '$env/dynamic/private';
import type { Cookies } from '@sveltejs/kit';

const ALPHA_ACCESS_COOKIE_NAME = 'foldnano_alpha_access';
const ALPHA_ACCESS_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
export const ALPHA_ACCESS_COOKIE_PATH = '/';

export function normalizeAlphaAccessCode(code: string): string {
	return code.trim();
}

export function getConfiguredAlphaAccessCodes(): string[] {
	const codes = env.ALPHA_ACCESS_CODE;
	if (!codes) return [];
	return codes
		.split(',')
		.map(normalizeAlphaAccessCode)
		.filter((code) => code.length > 0);
}

export function buildAlphaAccessCookieValue(accessCode: string): string {
	const digest = createHash('sha256').update(normalizeAlphaAccessCode(accessCode)).digest('hex');
	return `v1.${digest}`;
}

export function alphaAccessCodeMatches(inputCode: string, configuredCodes: string[]): boolean {
	const normalizedInput = normalizeAlphaAccessCode(inputCode);
	if (normalizedInput.length === 0) return false;
	return configuredCodes.some((configuredCode) => normalizedInput === configuredCode);
}

export function alphaAccessCookieIsValid(
	cookieValue: string | undefined,
	configuredCodes: string[]
): boolean {
	if (!cookieValue) return false;
	const actualBuffer = Buffer.from(cookieValue);
	return configuredCodes.some((configuredCode) => {
		const expectedBuffer = Buffer.from(buildAlphaAccessCookieValue(configuredCode));
		if (actualBuffer.length !== expectedBuffer.length) return false;
		return timingSafeEqual(actualBuffer, expectedBuffer);
	});
}

export function hasAlphaAccess(cookies: Cookies): boolean {
	return alphaAccessCookieIsValid(
		cookies.get(ALPHA_ACCESS_COOKIE_NAME),
		getConfiguredAlphaAccessCodes()
	);
}

export function setAlphaAccessCookie(cookies: Cookies, accessCode: string, secure: boolean): void {
	cookies.set(ALPHA_ACCESS_COOKIE_NAME, buildAlphaAccessCookieValue(accessCode), {
		path: ALPHA_ACCESS_COOKIE_PATH,
		httpOnly: true,
		secure,
		sameSite: 'lax',
		maxAge: ALPHA_ACCESS_COOKIE_MAX_AGE_SECONDS,
	});
}
