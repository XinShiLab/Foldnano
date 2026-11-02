import { describe, expect, it } from 'vitest';
import { countTags, filterByTags, hasTag } from './pluginTags';

interface Listing {
	id: string;
	tags?: string[];
}

const demo: Listing = { id: 'demo', tags: ['Demo'] };
const cadnano: Listing = { id: 'cadnano', tags: ['caDNAno'] };
const both: Listing = { id: 'both', tags: ['cadnano', 'demo'] };
const untagged: Listing = { id: 'untagged' };
const all = [demo, cadnano, both, untagged];

const ids = (list: Listing[]) => list.map((m) => m.id);

describe('pluginTags', () => {
	it('matches tags ignoring case', () => {
		expect(hasTag(both, 'Demo')).toBe(true);
		expect(hasTag(untagged, 'Demo')).toBe(false);
	});

	it('counts tags ignoring case, keeping the first spelling', () => {
		expect(countTags(all)).toEqual([
			{ key: 'cadnano', label: 'caDNAno', count: 2 },
			{ key: 'demo', label: 'Demo', count: 2 },
		]);
	});

	it('keeps everything with no selection and demos shown', () => {
		expect(ids(filterByTags(all, { selected: new Set(), showDemos: true }))).toEqual(ids(all));
	});

	it('keeps plugins matching any selected tag', () => {
		const selected = new Set(['cadnano']);
		expect(ids(filterByTags(all, { selected, showDemos: true }))).toEqual(['cadnano', 'both']);
	});

	it('hides demos even when they match a selected tag', () => {
		const selected = new Set(['cadnano']);
		expect(ids(filterByTags(all, { selected, showDemos: false }))).toEqual(['cadnano']);
		expect(ids(filterByTags(all, { selected: new Set(), showDemos: false }))).toEqual([
			'cadnano',
			'untagged',
		]);
	});
});
