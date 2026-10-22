import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { hasAlphaAccess } from '$lib/server/alphaAccess';
import { listDocPages, renderDocBundle, TEXT_RESPONSE_HEADERS } from '$lib/server/docsContent';

export const GET: RequestHandler = ({ cookies, url }) => {
	if (!hasAlphaAccess(cookies)) {
		throw error(401, 'Beta access required');
	}
	const body = renderDocBundle('Foldnano Documentation – Full Content', listDocPages(), url.origin);
	return new Response(body, { headers: TEXT_RESPONSE_HEADERS });
};
