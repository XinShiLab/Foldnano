import { redirect, type Handle } from '@sveltejs/kit';
import { llmsTextRedirectPath } from '$lib/server/docsRedirects';
import { isCrossSiteScriptRequest } from '$lib/server/fetchMetadata';

export const handle: Handle = async ({ event, resolve }) => {
	// API routes act with the user's GitHub token; only the app itself may script them.
	if (event.url.pathname.startsWith('/api/') && isCrossSiteScriptRequest(event.request.headers)) {
		return Response.json({ message: 'Cross-site API requests are not allowed' }, { status: 403 });
	}
	const llmsTarget = llmsTextRedirectPath(event.url.pathname);
	if (llmsTarget) redirect(301, `${event.url.origin}${llmsTarget}${event.url.search}`);
	return resolve(event);
};
