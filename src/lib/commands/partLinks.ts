import type FoldnanoDocument from '../model/document.svelte';
import { Part } from '../model/Part';
import type { PartSource } from '../model/Part/Part.svelte';
import { linkedPartJson } from '../model/partLinks';
import { uniquePartName } from './assembly';
import { partRef } from './historyChanges';
import type { HistoryStack } from './history.svelte';

type PartJSON = ReturnType<Part['toJSON']>;

// Linked Parts are read-only; these commands are the only edits the history guard lets through
// for them (docs/linked-parts.md).

/** Adds a read-only copy of a source design's Part, placed once at the origin. */
export function insertLinkedPartCmd(
	history: HistoryStack,
	doc: FoldnanoDocument,
	sourcePart: PartJSON,
	source: PartSource,
	name: string
): Part {
	const partName = uniquePartName(doc, name);
	return history.snapshotTx(`Insert ${partName}`, () =>
		doc.addPart(Part.fromJSON(linkedPartJson(sourcePart, source, partName)))
	);
}

/** Replaces a linked Part's cached copy with the source's current Part; its id, name and
 * placements stay. */
export function updateLinkedPartCmd(
	history: HistoryStack,
	doc: FoldnanoDocument,
	partId: string,
	sourcePart: PartJSON,
	source: PartSource
): void {
	const part = doc.parts.find((p) => p.id === partId);
	if (!part?.source) return;
	const json = linkedPartJson(sourcePart, source, part.name, part.id);
	history.withLinkedPartEdits(() =>
		history.partSnapshotTx(`Update ${part.name}`, part, () =>
			doc.replacePartFromJSON(part.id, json)
		)
	);
}

/** Turns a linked Part into a plain, editable Part that no longer follows its source. */
export function breakPartLinkCmd(history: HistoryStack, part: Part): void {
	if (!part.source) return;
	history.tx(`Break link of ${part.name}`, (rec) => {
		rec.field(partRef(part), 'source', part.source, null);
		part.source = null;
	});
}
