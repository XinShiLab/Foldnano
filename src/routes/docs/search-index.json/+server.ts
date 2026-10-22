import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { splitDocSections } from '$lib/docs/doc-markdown';
import { hasAlphaAccess } from '$lib/server/alphaAccess';
import { listDocPages } from '$lib/server/docsContent';

const SECTIONS = listDocPages().flatMap((page) => splitDocSections(page.raw, page));

export const GET: RequestHandler = ({ cookies }) => {
	if (!hasAlphaAccess(cookies)) {
		throw error(401, 'Beta access required');
	}
	return json(SECTIONS, { headers: { 'Cache-Control': 'public, max-age=3600' } });
};
