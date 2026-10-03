import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { hasAlphaAccess } from '$lib/server/alphaAccess';

const rawModules = import.meta.glob('/src/content/**/*.md', {
	eager: true,
	query: '?raw',
	import: 'default',
}) as Record<string, string>;

const metadataModules = import.meta.glob('/src/content/**/*.md', { eager: true }) as Record<
	string,
	{ metadata: Record<string, unknown> }
>;

const CATEGORY_ORDER = new Map([
	['guide', 1],
	['plugin-development', 2],
	['contributors', 3],
]);

export const GET: RequestHandler = ({ cookies }) => {
	if (!hasAlphaAccess(cookies)) {
		throw error(401, 'Beta access required');
	}

	const sorted = Object.entries(rawModules).sort(([a], [b]) => {
		const aMeta = metadataModules[a]?.metadata;
		const bMeta = metadataModules[b]?.metadata;
		const aCategory = CATEGORY_ORDER.get(aMeta?.category as string) ?? 99;
		const bCategory = CATEGORY_ORDER.get(bMeta?.category as string) ?? 99;
		if (aCategory !== bCategory) return aCategory - bCategory;
		return (
			((aMeta?.order as number | undefined) ?? 99) - ((bMeta?.order as number | undefined) ?? 99)
		);
	});

	const parts = ['# Foldnano Documentation – Full Content\n'];
	for (const [path, raw] of sorted) {
		parts.push(`\n${'─'.repeat(60)}\n`);
		parts.push(`<!-- source: ${path} -->\n\n`);
		parts.push(raw);
	}

	return new Response(parts.join(''), {
		headers: {
			'Content-Type': 'text/plain; charset=utf-8',
			'Cache-Control': 'public, max-age=3600',
		},
	});
};
