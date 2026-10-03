import type { Handle } from '@sveltejs/kit';
import { isCrossSiteScriptRequest } from '$lib/server/fetchMetadata';

export const handle: Handle = async ({ event, resolve }) => {
	// API routes act with the user's GitHub token; only the app itself may script them.
	if (event.url.pathname.startsWith('/api/') && isCrossSiteScriptRequest(event.request.headers)) {
		return Response.json({ message: 'Cross-site API requests are not allowed' }, { status: 403 });
	}
	return resolve(event);
};
