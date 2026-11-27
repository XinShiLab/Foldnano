import { describe, expect, it } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import { Occurrence } from '$lib/model/Assembly';
import type { Part } from '$lib/model/Part';
import { addLatticeVh } from '$lib/model/test/testHelpers';
import { findStickyMatches, singleStrandedRuns } from '$lib/model/stickyEnds/stickyEnds';
import { stickyEndGeometry, type StickyEndScene } from './stickyEndOverlay';

function strand(p: Part, sequence: string, col = 0) {
	const vh = addLatticeVh(p, col, 0);
	const oligo = p.createOligo(vh, 0, sequence.length - 1);
	[...oligo.segments][0].sequence = sequence;
}

const at = (x: number) => ({
	position: { x, y: 0, z: 0 },
	quaternion: [0, 0, 0, 1] as [number, number, number, number],
});

describe('stickyEndGeometry', () => {
	const doc = new FoldnanoDocument(undefined, 'Two');
	const arm = doc.addNewPart('HONEYCOMB');
	const base = doc.addNewPart('HONEYCOMB');
	strand(arm, 'GATTACAGGC');
	strand(base, 'GCCTGTAATC');
	const matches = findStickyMatches(
		[...singleStrandedRuns(arm), ...singleStrandedRuns(base)],
		7
	).map((m) => ({ ...m, color: '#f97316', state: 'new' as const }));

	const armAt = new Occurrence(arm.id, 'Arm', { transform: at(0) });
	const near = new Occurrence(base.id, 'Near', { transform: at(30) });
	const far = new Occurrence(base.id, 'Far', { transform: at(500) });
	const hidden = new Occurrence(base.id, 'Hidden', { transform: at(10), visible: false });
	const scene = (over: Partial<StickyEndScene> = {}): StickyEndScene => ({
		parts: doc.parts,
		occurrencesOf: (id) => [armAt, near, far, hidden].filter((o) => o.partId === id),
		linkMode: 'nearest',
		hoveredKey: null,
		...over,
	});

	it('sleeves every matched stretch on every visible instance', () => {
		const { pieces, anyHovered } = stickyEndGeometry(matches, scene());
		// 9 steps along 10 bases, on the arm's one instance and each of the base's two visible ones.
		expect(pieces).toHaveLength(27);
		expect(pieces.every((p) => p.color === '#f97316' && !p.hovered)).toBe(true);
		expect(anyHovered).toBe(false);
	});

	it('links every instance to its nearest partner instance, each line once', () => {
		// Arm at 0; base at 30 and 500: arm↔near, and far's nearest arm is the same arm.
		const { links } = stickyEndGeometry(matches, scene());
		const spans = links.map((l) => [l.from.x, l.to.x].sort((p, q) => p - q));
		expect(spans).toHaveLength(2);
		expect(spans.every(([lo]) => lo < 10)).toBe(true);
		expect(spans.map(([, hi]) => hi > 400)).toEqual(expect.arrayContaining([true, false]));

		// A1 near B1 and A2 near B2: one line each, no crossing lines.
		const armFar = new Occurrence(arm.id, 'Arm 2', { transform: at(505) });
		const all = [armAt, armFar, near, far];
		const pairs = stickyEndGeometry(
			matches,
			scene({ occurrencesOf: (id) => all.filter((o) => o.partId === id) })
		).links;
		expect(pairs).toHaveLength(2);
		expect(pairs.every((l) => Math.abs(l.to.x - l.from.x) < 100)).toBe(true);

		// 'all': every visible pair of an arm and a base instance.
		const every = stickyEndGeometry(
			matches,
			scene({ linkMode: 'all', occurrencesOf: (id) => all.filter((o) => o.partId === id) })
		).links;
		expect(every).toHaveLength(4);
	});

	it('links within each instance of a Part when that is closest, and a self match only across', () => {
		const one = new FoldnanoDocument(undefined, 'One');
		const part = one.addNewPart('HONEYCOMB');
		strand(part, 'GATTACAGGC', 0);
		strand(part, 'GCCTGTAATC', 2);
		strand(part, 'TTGGAATTCCTT', 4);
		const found = findStickyMatches(singleStrandedRuns(part), 7).map((m) => ({
			...m,
			color: '#a855f7',
			state: 'new' as const,
		}));
		const pair = found.filter((m) => !m.self);
		const self = found.filter((m) => m.self);
		expect(pair).toHaveLength(1);
		expect(self).toHaveLength(1);

		const first = new Occurrence(part.id, 'A', { transform: at(0) });
		const second = new Occurrence(part.id, 'B', { transform: at(40) });
		const inScene = (
			occurrences: Occurrence[],
			linkMode: StickyEndScene['linkMode'] = 'nearest'
		): StickyEndScene => ({
			parts: one.parts,
			occurrencesOf: () => occurrences,
			linkMode,
			hoveredKey: null,
		});
		const inside = stickyEndGeometry(pair, inScene([first, second])).links;
		expect(inside).toHaveLength(2);
		expect(inside.every((l) => Math.abs(l.to.x - l.from.x) < 20)).toBe(true);
		expect(stickyEndGeometry(self, inScene([first])).links).toHaveLength(0);
		const across = stickyEndGeometry(self, inScene([first, second])).links;
		expect(across).toHaveLength(1);
		expect(Math.abs(across[0].to.x - across[0].from.x)).toBeCloseTo(40);

		// 'all': an in-Part pair links within and across copies; a self match each pair of copies once.
		const third = new Occurrence(part.id, 'C', { transform: at(80) });
		expect(stickyEndGeometry(pair, inScene([first, second], 'all')).links).toHaveLength(4);
		expect(stickyEndGeometry(self, inScene([first, second, third], 'all')).links).toHaveLength(3);
		expect(stickyEndGeometry(self, inScene([first], 'all')).links).toHaveLength(0);
	});

	it('flags the hovered match', () => {
		const { links, pieces, anyHovered } = stickyEndGeometry(
			matches,
			scene({ hoveredKey: matches[0].key })
		);
		expect(anyHovered).toBe(true);
		expect(links[0].hovered).toBe(true);
		expect(pieces.every((p) => p.hovered)).toBe(true);
	});
});
