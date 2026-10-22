import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { docHref } from '$lib/docs/doc-markdown';
import { DOC_CATEGORY_LABELS, type DocCategory } from '$lib/docs/doc-search';
import { hasAlphaAccess } from '$lib/server/alphaAccess';
import { listDocPages, TEXT_RESPONSE_HEADERS } from '$lib/server/docsContent';

const CATEGORY_NOTES: Record<DocCategory, string> = {
	guide: 'Using the Foldnano editor',
	'plugin-development': 'Writing Python plugins and Script Lab scripts',
	contributors: 'Working on the Foldnano codebase',
};

// Links are absolute because agents often resolve site-relative links against the wrong base.
export const GET: RequestHandler = ({ cookies, url }) => {
	if (!hasAlphaAccess(cookies)) {
		throw error(401, 'Beta access required');
	}
	const origin = url.origin;
	const categories = Object.keys(DOC_CATEGORY_LABELS) as DocCategory[];

	const body = [
		'# Foldnano Documentation',
		'',
		'> Foldnano is a browser-based DNA nanostructure editor for designing DNA origami and staple routing structures.',
		'',
		'Each link below is the page as plain markdown. Human-readable pages live at the same URL without `.md`.',
		'',
		...categories.flatMap((category) => [
			`## ${DOC_CATEGORY_LABELS[category]}`,
			'',
			...listDocPages(category).map(
				(p) => `- [${p.title}](${origin}${docHref(p)}.md): ${p.description}`
			),
			'',
		]),
		'## Full Content',
		'',
		`- [All documentation in one file](${origin}/llms-full.txt)`,
		...categories.map(
			(category) =>
				`- [${DOC_CATEGORY_LABELS[category]} in one file](${origin}/docs/${category}/llms.txt): ${CATEGORY_NOTES[category]}`
		),
		'',
	].join('\n');

	return new Response(body, { headers: TEXT_RESPONSE_HEADERS });
};
