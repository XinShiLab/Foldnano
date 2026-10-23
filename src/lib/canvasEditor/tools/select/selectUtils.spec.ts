import { addLatticeVh } from '$lib/model/test/testHelpers';
import { describe, expect, it } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import type { Category, HitResult, LeafTarget } from '$lib/canvasEditor/core/modes';
import { filterEndsByStrandType, filterHitsByUserFilter } from './selectUtils';

function filterOf(...items: (LeafTarget | Category)[]): Set<LeafTarget | Category> {
	return new Set<LeafTarget | Category>([...items, 'EMPTY', 'VH', 'VH_GRID', 'CONTROL']);
}

describe('filterHitsByUserFilter', () => {
	const hits: HitResult[] = [
		{ kind: 'VH_GRID', id: 'g', category: 'VH' },
		{ kind: 'SEGMENT', id: 'scafSeg', category: 'SCAF' },
		{ kind: 'END', id: 'stapEnd', category: 'STAP' },
		{ kind: 'XOVER', id: 'stapXover', category: 'STAP' },
	];

	it('drops scaffold hits when SCAF is off, even if their kind is on', () => {
		const kept = filterHitsByUserFilter(hits, filterOf('STAP', 'END', 'XOVER', 'SEGMENT'));
		expect(kept.map((h) => h.id)).toEqual(['g', 'stapEnd', 'stapXover']);
	});

	it('drops staple hits when STAP is off', () => {
		const kept = filterHitsByUserFilter(hits, filterOf('SCAF', 'END', 'XOVER', 'SEGMENT'));
		expect(kept.map((h) => h.id)).toEqual(['g', 'scafSeg']);
	});

	it('still requires the kind toggle for an allowed strand type', () => {
		const kept = filterHitsByUserFilter(hits, filterOf('SCAF', 'STAP', 'END'));
		expect(kept.map((h) => h.id)).toEqual(['g', 'stapEnd']);
	});
});

describe('filterEndsByStrandType', () => {
	function partWithScaffoldAndStaple() {
		const doc = new FoldnanoDocument();
		const part = doc.addNewPart('HONEYCOMB');
		const vhs = [addLatticeVh(part, 0, 0), addLatticeVh(part, 0, 1)];
		const scaffold = part.createOligo(vhs[0], 5, 20);
		scaffold.isScaffold = true;
		const staple = part.createOligo(vhs[1], 5, 20);
		return { scaffold, staple };
	}

	it('keeps only ends of the enabled strand type', () => {
		const { scaffold, staple } = partWithScaffoldAndStaple();
		const ends = [...scaffold.allEnds, ...staple.allEnds];

		expect(filterEndsByStrandType(ends, filterOf('SCAF'))).toEqual([...scaffold.allEnds]);
		expect(filterEndsByStrandType(ends, filterOf('STAP'))).toEqual([...staple.allEnds]);
		expect(filterEndsByStrandType(ends, filterOf())).toEqual([]);
	});
});
