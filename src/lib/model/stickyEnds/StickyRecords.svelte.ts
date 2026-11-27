import { isStickyRecord, type StickyList, type StickyRecord } from './stickyPairs';

export interface StickyRecordsJSON {
	stickyPairs?: StickyRecord[];
	ignoredMatches?: StickyRecord[];
}

/** One saved record and its list position, for history patches. */
export interface StickyRecordState {
	record: StickyRecord;
	index: number;
}

const copy = (record: StickyRecord): StickyRecord => JSON.parse(JSON.stringify(record));

/**
 * Saved sticky-end pairs and ignored matches of one home: a Part (both ends in it) or the
 * assembly (ends in two Parts, anchors carry `partId`). Change it through the sticky-end
 * commands; see docs/sticky-ends.md § Saved pairs.
 */
export class StickyRecords {
	pairs: StickyRecord[] = $state.raw([]);
	ignored: StickyRecord[] = $state.raw([]);

	constructor(readonly withPartId: boolean) {}

	list(list: StickyList): StickyRecord[] {
		return list === 'pairs' ? this.pairs : this.ignored;
	}

	stateOf(list: StickyList, id: string): StickyRecordState | null {
		const index = this.list(list).findIndex((record) => record.id === id);
		return index < 0 ? null : { record: copy(this.list(list)[index]), index };
	}

	/** Sets the record with `record.id` to `record`, at list position `index`. */
	put(list: StickyList, record: StickyRecord, index: number): void {
		const next = this.list(list).filter((r) => r.id !== record.id);
		next.splice(Math.min(index, next.length), 0, copy(record));
		this.#set(list, next);
	}

	remove(list: StickyList, id: string): void {
		this.#set(
			list,
			this.list(list).filter((record) => record.id !== id)
		);
	}

	/** Drops every record with a side in `partId` (assembly records, when a Part is deleted). */
	removeAllOf(partId: string): void {
		for (const list of ['pairs', 'ignored'] as const) {
			this.#set(
				list,
				this.list(list).filter((r) => r.a.partId !== partId && r.b.partId !== partId)
			);
		}
	}

	#set(list: StickyList, records: StickyRecord[]): void {
		if (list === 'pairs') this.pairs = records;
		else this.ignored = records;
	}

	/** Both lists, each left out when empty so files without pairs serialise as before. */
	toJSON(): StickyRecordsJSON {
		return {
			stickyPairs: this.pairs.length ? this.pairs.map(copy) : undefined,
			ignoredMatches: this.ignored.length ? this.ignored.map(copy) : undefined,
		};
	}

	/** Replaces both lists with saved ones; a malformed record (a hand-edited file) is dropped. */
	load(json: StickyRecordsJSON | undefined): void {
		const read = (value: unknown) =>
			Array.isArray(value) ? value.filter((r) => isStickyRecord(r, this.withPartId)).map(copy) : [];
		this.pairs = read(json?.stickyPairs);
		this.ignored = read(json?.ignoredMatches);
	}
}
