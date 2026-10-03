import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { hasAlphaAccess } from '$lib/server/alphaAccess';

const modules = import.meta.glob('/src/content/**/*.md', { eager: true }) as Record<
	string,
	{ metadata: Record<string, unknown> }
>;

function pathToSlug(path: string, meta: Record<string, unknown>): string {
	const parts = path.replace('/src/content/', '').split('/');
	const category = parts[0];
	const slug =
		(meta.slug as string | undefined) ?? parts[1].replace('.md', '').replace(/^\d+-/, '');
	return `${category}/${slug}`;
}

export const GET: RequestHandler = ({ cookies }) => {
	if (!hasAlphaAccess(cookies)) {
		throw error(401, 'Beta access required');
	}

	type Entry = { order: number; line: string };
	const guide: Entry[] = [];
	const pluginDevelopment: Entry[] = [];
	const contributors: Entry[] = [];

	for (const [path, mod] of Object.entries(modules)) {
		const m = mod.metadata;
		const slug = pathToSlug(path, m);
		const line = `- [${m.title}](/docs/${slug}): ${m.description}`;
		const entry: Entry = { order: m.order as number, line };
		if (m.category === 'guide') guide.push(entry);
		else if (m.category === 'plugin-development') pluginDevelopment.push(entry);
		else if (m.category === 'contributors') contributors.push(entry);
	}

	const sort = (arr: Entry[]) => arr.sort((a, b) => a.order - b.order).map((e) => e.line);

	const body = [
		'# Foldnano Documentation',
		'',
		'> Foldnano is a browser-based DNA nanostructure editor for designing DNA origami and staple routing structures.',
		'',
		'## Guide',
		'',
		...sort(guide),
		'',
		'## Plugin Development',
		'',
		...sort(pluginDevelopment),
		'',
		'## Contributors',
		'',
		...sort(contributors),
		'',
		'## Full Content',
		'',
		'Full content available at: /llms-full.txt',
	].join('\n');

	return new Response(body, {
		headers: {
			'Content-Type': 'text/plain; charset=utf-8',
			'Cache-Control': 'public, max-age=3600',
		},
	});
};
