import { v4 as uuidv4 } from 'uuid';
import type FoldnanoDocument from '$lib/model/document.svelte';
import type { StickyMatch } from '$lib/model/stickyEnds/stickyEnds';
import {
	anchorOfSide,
	type StickyList,
	type StickyRecord,
} from '$lib/model/stickyEnds/stickyPairs';
import type { HistoryStack } from './history.svelte';
import { stickyRecordsAt, type StickyRecordHome } from './historyChanges';

/** A record with both ends in one Part lives on that Part (it travels with it when linked); one
 * joining two Parts lives in the assembly. */
export function stickyHomeOf(match: StickyMatch): StickyRecordHome {
	return match.a.run.partId === match.b.run.partId
		? { kind: 'part', partId: match.a.run.partId }
		: { kind: 'assembly' };
}

/** Why a match can't be paired or ignored here, or null when it can. */
export function stickyMatchBlocker(doc: FoldnanoDocument, match: StickyMatch): string | null {
	const home = stickyHomeOf(match);
	if (home.kind === 'part' && doc.parts.find((p) => p.id === home.partId)?.source) {
		return 'This Part is linked from another design: pair its own ends there, then update it.';
	}
	for (const side of [match.a, match.b]) {
		const oligo = doc.parts.find((p) => p.id === side.run.partId)?.getOligoById(side.run.oligoId);
		if (oligo?.isCircular) return 'A circular strand has no ends to anchor a pair to.';
	}
	return null;
}

/**
 * Saves a detected match as a pair (`list` 'pairs') or as one to ignore ('ignored'), in its home.
 * Returns the record, or null when it can't be anchored (see `stickyMatchBlocker`).
 */
export function saveStickyMatchCmd(
	history: HistoryStack,
	doc: FoldnanoDocument,
	match: StickyMatch,
	list: StickyList
): StickyRecord | null {
	if (stickyMatchBlocker(doc, match)) return null;
	const home = stickyHomeOf(match);
	const partOf = (partId: string) => doc.parts.find((p) => p.id === partId);
	const crossPart = home.kind === 'assembly';
	const partA = partOf(match.a.run.partId);
	const partB = partOf(match.b.run.partId);
	const a = partA && anchorOfSide(partA, match.a, crossPart);
	const b = partB && anchorOfSide(partB, match.b, crossPart);
	if (!a || !b) return null;
	const record: StickyRecord = { id: uuidv4(), a, b, length: match.length };
	const records = stickyRecordsAt(doc, home);
	const label = list === 'pairs' ? 'Pair sticky ends' : 'Ignore sticky-end match';
	history.tx(label, (rec) => {
		records.put(list, record, records.list(list).length);
		rec.stickyRecord(home, list, record.id, null, records.stateOf(list, record.id));
	});
	return record;
}

/** Unpairs a saved pair, or stops ignoring a match. */
export function removeStickyRecordCmd(
	history: HistoryStack,
	doc: FoldnanoDocument,
	home: StickyRecordHome,
	list: StickyList,
	id: string
): void {
	const records = stickyRecordsAt(doc, home);
	const before = records.stateOf(list, id);
	if (!before) return;
	history.tx(list === 'pairs' ? 'Unpair sticky ends' : 'Stop ignoring sticky-end match', (rec) => {
		records.remove(list, id);
		rec.stickyRecord(home, list, id, before, null);
	});
}
