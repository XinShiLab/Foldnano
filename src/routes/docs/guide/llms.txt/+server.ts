import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { hasAlphaAccess } from '$lib/server/alphaAccess';

const rawModules = import.meta.glob('/src/content/guide/**/*.md', {
	eager: true,
	query: '?raw',
	import: 'default',
}) as Record<string, string>;

const metadataModules = import.meta.glob('/src/content/guide/**/*.md', { eager: true }) as Record<
	string,
	{ metadata: Record<string, unknown> }
>;

export const GET: RequestHandler = ({ cookies }) => {
	if (!hasAlphaAccess(cookies)) {
		throw error(401, 'Beta access required');
	}

	const sorted = Object.entries(rawModules).sort(([a], [b]) => {
		const aOrder = metadataModules[a]?.metadata.order as number | undefined;
		const bOrder = metadataModules[b]?.metadata.order as number | undefined;
		return (aOrder ?? 99) - (bOrder ?? 99);
	});

	return new Response(['# Foldnano User Guide\n', ...sorted.map(([, raw]) => raw)].join('\n\n'), {
		headers: {
			'Content-Type': 'text/plain; charset=utf-8',
			'Cache-Control': 'public, max-age=3600',
		},
	});
};
