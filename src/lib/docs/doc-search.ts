import MiniSearch, { type SearchResult } from 'minisearch';

export type DocCategory = 'guide' | 'plugin-development' | 'contributors';

export const DOC_CATEGORY_LABELS: Record<DocCategory, string> = {
	guide: 'User Guide',
	'plugin-development': 'Plugin Development',
	contributors: 'Contributors',
};

export interface DocSearchSection {
	/** Unique id: the section's href. */
	id: string;
	/** `/docs/<category>/<slug>`, plus `#<anchor>` for sections below a heading. */
	href: string;
	category: DocCategory;
	pageTitle: string;
	/** Section heading; the page title for the intro before the first `##`. */
	heading: string;
	text: string;
}

export interface DocSearchHit {
	section: DocSearchSection;
	/** Document terms that matched, for highlighting. */
	terms: string[];
}

const RESULT_LIMIT = 20;
const CURRENT_CATEGORY_BOOST = 1.5;
const WORD = /[\p{L}\p{N}_]+/gu;

/** Words with `_` identifiers kept whole, so `get_slot_at` is one query term. */
function queryTokens(text: string): string[] {
	return text.match(WORD) ?? [];
}

/** Like {@link queryTokens}, plus each `_` identifier's parts, so `slot` also finds `get_slot_at`. */
function indexTokens(text: string): string[] {
	return queryTokens(text).flatMap((word) =>
		word.includes('_') ? [word, ...word.split('_').filter(Boolean)] : [word]
	);
}

export class DocSearch {
	private readonly _index = new MiniSearch<DocSearchSection>({
		fields: ['heading', 'pageTitle', 'text'],
		storeFields: ['category'],
		tokenize: indexTokens,
		searchOptions: {
			tokenize: queryTokens,
			boost: { heading: 4, pageTitle: 2 },
			prefix: (_term, i, terms) => i === terms.length - 1,
			fuzzy: (term) => (term.length > 4 ? 0.2 : false),
		},
	});
	private readonly _byId = new Map<string, DocSearchSection>();

	constructor(sections: readonly DocSearchSection[]) {
		this._index.addAll(sections);
		for (const s of sections) this._byId.set(s.id, s);
	}

	/** Ranks sections for `query`; requires every term, then falls back to any term. */
	search(query: string, currentCategory?: DocCategory): DocSearchHit[] {
		if (!query.trim()) return [];
		const boostDocument = (_id: unknown, _term: string, stored?: Record<string, unknown>) =>
			stored?.category === currentCategory ? CURRENT_CATEGORY_BOOST : 1;
		let results: SearchResult[] = this._index.search(query, { combineWith: 'AND', boostDocument });
		if (results.length === 0) {
			results = this._index.search(query, { combineWith: 'OR', boostDocument });
		}
		return results.slice(0, RESULT_LIMIT).map((r) => ({
			section: this._byId.get(r.id as string)!,
			terms: r.terms,
		}));
	}
}

export interface SnippetPart {
	text: string;
	match: boolean;
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A short excerpt of `text` around the first matched term, split into highlighted parts. */
export function highlightSnippet(
	text: string,
	terms: readonly string[],
	radius = 90
): SnippetPart[] {
	if (terms.length === 0) return [{ text: text.slice(0, radius * 2), match: false }];
	const alternatives = [...terms].sort((a, b) => b.length - a.length).map(escapeRegExp);
	// Highlight only at word starts so a short term doesn't light up the middle of other words.
	const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(${alternatives.join('|')})`, 'giu');
	const first = text.search(pattern);
	let start = first < 0 ? 0 : Math.max(0, first - radius / 3);
	let end = Math.min(text.length, start + radius * 2);
	if (start > 0) start = text.indexOf(' ', start) + 1 || start;
	if (end < text.length)
		end = text.lastIndexOf(' ', end) > start ? text.lastIndexOf(' ', end) : end;
	const excerpt = `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
	return excerpt
		.split(pattern)
		.filter((part) => part.length > 0)
		.map((part) => ({
			text: part,
			match: terms.some((t) => t.toLowerCase() === part.toLowerCase()),
		}));
}
