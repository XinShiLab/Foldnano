import { toAgentMarkdown, type DocPageRef } from '$lib/docs/doc-markdown';
import type { DocCategory } from '$lib/docs/doc-search';

const rawModules = import.meta.glob('/src/content/**/*.md', {
	eager: true,
	query: '?raw',
	import: 'default',
}) as Record<string, string>;

const metadataModules = import.meta.glob('/src/content/**/*.md', { eager: true }) as Record<
	string,
	{ metadata: Record<string, unknown> }
>;

const CATEGORY_ORDER: readonly DocCategory[] = ['guide', 'plugin-development', 'contributors'];

export interface DocPage extends DocPageRef {
	description: string;
	order: number;
	/** Source markdown, including front matter and the mdsvex script block. */
	raw: string;
}

function toPage(path: string): DocPage {
	const meta = metadataModules[path].metadata;
	const [category, file] = path.replace('/src/content/', '').split('/');
	return {
		category: category as DocCategory,
		slug: (meta.slug as string | undefined) ?? file.replace('.md', '').replace(/^\d+-/, ''),
		title: meta.title as string,
		description: meta.description as string,
		order: (meta.order as number | undefined) ?? 99,
		raw: rawModules[path],
	};
}

const ALL_PAGES: readonly DocPage[] = Object.keys(rawModules)
	.map(toPage)
	.sort(
		(a, b) =>
			CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || a.order - b.order
	);

/** Every doc page in site order (category, then `order`), optionally limited to one category. */
export function listDocPages(category?: DocCategory): readonly DocPage[] {
	return category ? ALL_PAGES.filter((p) => p.category === category) : ALL_PAGES;
}

export function findDocPage(category: string, slug: string): DocPage | undefined {
	return ALL_PAGES.find((p) => p.category === category && p.slug === slug);
}

export const TEXT_RESPONSE_HEADERS = {
	'Content-Type': 'text/plain; charset=utf-8',
	'Cache-Control': 'public, max-age=3600',
} as const;

/** One plain-text file holding several pages as agent markdown, for the `llms*.txt` routes. */
export function renderDocBundle(title: string, pages: readonly DocPage[], origin: string): string {
	const rule = `\n\n${'─'.repeat(60)}\n\n`;
	return `# ${title}${rule}${pages.map((p) => toAgentMarkdown(p.raw, origin, p)).join(rule)}`;
}
