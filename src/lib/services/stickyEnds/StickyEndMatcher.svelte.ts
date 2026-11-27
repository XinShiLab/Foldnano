import type FoldnanoDocument from '$lib/model/document.svelte';
import type { StickyRecordHome } from '$lib/commands/historyChanges';
import {
	findStickyMatches,
	sidePositions,
	singleStrandedRuns,
	type StickyBase,
	type StickyMatch,
} from '$lib/model/stickyEnds/stickyEnds';
import {
	recordCovers,
	resolveRecord,
	stickyPairStatus,
	type ResolvedSide,
	type StickyList,
	type StickyPairStatus,
	type StickyRecord,
} from '$lib/model/stickyEnds/stickyPairs';

/** Distinct from each other and from the default oligo blues; a match keeps its colour. */
export const STICKY_COLORS = [
	'#f97316',
	'#a855f7',
	'#06b6d4',
	'#ec4899',
	'#84cc16',
	'#eab308',
	'#ef4444',
	'#14b8a6',
	'#6366f1',
	'#f43f5e',
] as const;

export interface ColoredStickyMatch extends StickyMatch {
	color: string;
	/** `paired` / `ignored` when a saved record covers it (its id in `recordId`). */
	state: 'new' | 'paired' | 'ignored';
	recordId?: string;
}

/** A saved pair or ignored match, resolved against the current design. */
export interface SavedStickyRecord {
	home: StickyRecordHome;
	list: StickyList;
	record: StickyRecord;
	sides: [ResolvedSide | null, ResolvedSide | null];
	/** Pairs only; an ignored match has no status. */
	status: StickyPairStatus | null;
	/** The detected match it covers now, if any (its colour ties the panel row to the views). */
	match: ColoredStickyMatch | null;
	/** False for a linked Part's own records: those change in the source design. */
	editable: boolean;
}

/** A matched base in one Part, with the colour of each match it is in. */
export interface StickyBaseMark extends StickyBase {
	colors: string[];
}

export interface StickyMatcherSettings {
	/** Only computes while something shows the matches (the highlight or the panel). */
	enabled: boolean;
	minLength: number;
}

const baseKey = (b: StickyBase) => `${b.vhId}:${b.strandIdx}:${b.bpIndex}:${b.loopIndex}`;

/**
 * The open design's sticky-end matches, recomputed from its sequences whenever they change and
 * something is showing them, and the saved pairs and ignored matches resolved against them
 * (docs/sticky-ends.md).
 */
export class StickyEndMatcher {
	readonly #getDoc: () => FoldnanoDocument;
	readonly #settings: () => StickyMatcherSettings;
	// Colour per match key, kept across recomputes so an edit elsewhere doesn't recolour a match.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- written inside `matches`; must not be tracked
	readonly #colorByKey = new Map<string, number>();

	/** The match the pointer is over (panel row or a marked run); views draw its partner line. */
	hoveredKey: string | null = $state(null);

	constructor(getDoc: () => FoldnanoDocument, settings: () => StickyMatcherSettings) {
		this.#getDoc = getDoc;
		this.#settings = settings;
	}

	/** Every saved pair and ignored match of the document, resolved; empty while hidden. */
	readonly #records: Omit<SavedStickyRecord, 'match'>[] = $derived.by(() => {
		if (!this.#settings().enabled) return [];
		const doc = this.#getDoc();
		const homes: { home: StickyRecordHome; part: (typeof doc.parts)[number] | null }[] = [
			...doc.parts.map((part) => ({ home: { kind: 'part' as const, partId: part.id }, part })),
			{ home: { kind: 'assembly' }, part: null },
		];
		return homes.flatMap(({ home, part }) => {
			const records = part ? part.stickyRecords : doc.assembly.stickyRecords;
			return (['pairs', 'ignored'] as const).flatMap((list) =>
				records.list(list).map((record) => {
					const sides = resolveRecord(doc.parts, part, record);
					return {
						home,
						list,
						record,
						sides,
						status: list === 'pairs' ? stickyPairStatus(sides) : null,
						editable: !part?.source,
					};
				})
			);
		});
	});

	/** Every detected match, each tagged with the saved record covering it. */
	readonly matches: ColoredStickyMatch[] = $derived.by(() => {
		const { enabled, minLength } = this.#settings();
		if (!enabled) return [];
		const runs = this.#getDoc().parts.flatMap((part) => singleStrandedRuns(part));
		const records = this.#records;
		return this.#color(findStickyMatches(runs, minLength)).map((match) => {
			// A pair wins over an ignore of the same stretches.
			const covering =
				records.find((r) => r.list === 'pairs' && recordCovers(r.sides, match)) ??
				records.find((r) => r.list === 'ignored' && recordCovers(r.sides, match));
			if (!covering) return match;
			const state = covering.list === 'pairs' ? ('paired' as const) : ('ignored' as const);
			return { ...match, state, recordId: covering.record.id };
		});
	});

	/** The matches the views draw: all but the ignored ones. */
	readonly shown: ColoredStickyMatch[] = $derived(
		this.matches.filter((match) => match.state !== 'ignored')
	);

	/** Saved pairs and ignored matches, with the match each covers now. */
	readonly saved: SavedStickyRecord[] = $derived(
		this.#records.map((r) => ({
			...r,
			match: this.matches.find((m) => m.recordId === r.record.id) ?? null,
		}))
	);

	/** Matched bases of one Part (ignored matches left out), merged where a base is in several. */
	marksFor(partId: string): StickyBaseMark[] {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local lookup
		const marks = new Map<string, StickyBaseMark>();
		for (const match of this.shown) {
			for (const side of match.self ? [match.a] : [match.a, match.b]) {
				if (side.run.partId !== partId) continue;
				for (const base of sidePositions(side)) {
					const key = baseKey(base);
					const mark = marks.get(key);
					if (!mark) marks.set(key, { ...base, colors: [match.color] });
					else if (!mark.colors.includes(match.color)) mark.colors.push(match.color);
				}
			}
		}
		return [...marks.values()];
	}

	#color(matches: StickyMatch[]): ColoredStickyMatch[] {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local lookup
		const keys = new Set(matches.map((m) => m.key));
		for (const key of [...this.#colorByKey.keys()]) {
			if (!keys.has(key)) this.#colorByKey.delete(key);
		}
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local lookup
		const used = new Set(this.#colorByKey.values());
		return matches.map((match) => {
			let index = this.#colorByKey.get(match.key);
			if (index === undefined) {
				// The first free colour; once all are taken they repeat.
				const free = STICKY_COLORS.findIndex((_, i) => !used.has(i));
				index = free >= 0 ? free : this.#colorByKey.size % STICKY_COLORS.length;
				used.add(index);
				this.#colorByKey.set(match.key, index);
			}
			return { ...match, color: STICKY_COLORS[index], state: 'new' as const };
		});
	}
}
