import { describe, expect, it } from 'vitest';

import { DocSearch, highlightSnippet, type DocSearchSection } from './doc-search';

function section(
	href: string,
	heading: string,
	text: string,
	category: DocSearchSection['category'] = 'guide'
): DocSearchSection {
	return { id: href, href, category, pageTitle: 'Page', heading, text };
}

const SECTIONS = [
	section('/docs/guide/a#export', 'oxDNA Export', 'Writes topology and configuration files.'),
	section(
		'/docs/guide/a#slots',
		'Slots',
		'Call get_slot_at to read one base.',
		'plugin-development'
	),
	section('/docs/guide/b#crossovers', 'Crossovers', 'Drag between ends to add a crossover.'),
];

describe('DocSearch', () => {
	const search = new DocSearch(SECTIONS);

	it('ranks heading matches and completes the last word as a prefix', () => {
		expect(search.search('oxdna exp')[0].section.heading).toBe('oxDNA Export');
	});

	it('finds snake_case identifiers whole and by their parts', () => {
		expect(search.search('get_slot_at').map((h) => h.section.heading)).toEqual(['Slots']);
		expect(search.search('slot').map((h) => h.section.heading)).toContain('Slots');
	});

	it('falls back to any-term matching when no section has every term', () => {
		expect(search.search('crossover zebra')[0].section.heading).toBe('Crossovers');
	});

	it('returns nothing for a blank query', () => {
		expect(search.search('   ')).toEqual([]);
	});
});

describe('highlightSnippet', () => {
	it('marks matches only at word starts', () => {
		const parts = highlightSnippet('at the state', ['at']);
		expect(parts.filter((p) => p.match).map((p) => p.text)).toEqual(['at']);
	});

	it('trims long text to a window around the first match', () => {
		const text = `${'lorem '.repeat(60)}needle ${'ipsum '.repeat(60)}`;
		const joined = highlightSnippet(text, ['needle'], 40)
			.map((p) => p.text)
			.join('');
		expect(joined.startsWith('…')).toBe(true);
		expect(joined.endsWith('…')).toBe(true);
		expect(joined).toContain('needle');
		expect(joined.length).toBeLessThan(100);
	});
});
