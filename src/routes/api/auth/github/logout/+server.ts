import { json } from '@sveltejs/kit';
import { clearTokenCookies } from '$lib/services/github/server-utils';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies }) => {
	clearTokenCookies(cookies);
	return json({ success: true });
};
