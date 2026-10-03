import type { Cookies } from '@sveltejs/kit';

import { hasAlphaAccess } from './alphaAccess';

export function alphaAccessLoad({ cookies }: { cookies: Cookies }) {
	return { alphaAccessGranted: hasAlphaAccess(cookies) };
}
