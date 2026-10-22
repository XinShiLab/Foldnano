import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { toAgentMarkdown } from '$lib/docs/doc-markdown';
import { hasAlphaAccess } from '$lib/server/alphaAccess';
import { findDocPage } from '$lib/server/docsContent';

export const GET: RequestHandler = ({ cookies, params, url }) => {
	if (!hasAlphaAccess(cookies)) {
		throw error(401, 'Beta access required');
	}
	const page = findDocPage(params.category, params.slug);
	if (!page) throw error(404, `Documentation page not found: ${params.category}/${params.slug}`);
	return new Response(toAgentMarkdown(page.raw, url.origin, page), {
		headers: {
			'Content-Type': 'text/markdown; charset=utf-8',
			'Cache-Control': 'public, max-age=3600',
		},
	});
};
