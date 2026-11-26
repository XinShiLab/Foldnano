import type FoldnanoDocument from '../model/document.svelte';
import type { PartType } from '../model/document.svelte';
import { Part } from '../model/Part';
import { remapPartIds } from '../model/Part/remapPartIds';
import {
	IDENTITY_TRANSFORM,
	cloneTransform,
	type Occurrence,
	type OccurrenceTransform,
} from '../model/Assembly';
import { partRef } from './historyChanges';
import type { HistoryStack } from './history.svelte';

// Adding, removing and duplicating Parts changes the Part list, so they take a whole-document
// snapshot; occurrence edits are small targeted patches (docs/commands-and-history.md).

/** Adds a new empty Part, placed once at the origin. */
export function addPartCmd(history: HistoryStack, doc: FoldnanoDocument, kind: PartType): Part {
	return history.snapshotTx('Add Part', () => doc.addNewPart(kind));
}

/** Removes a Part definition and every occurrence of it. */
export function deletePartCmd(history: HistoryStack, doc: FoldnanoDocument, partId: string): void {
	const part = doc.parts.find((p) => p.id === partId);
	if (!part) return;
	history.snapshotTx(`Delete ${part.name}`, () => doc.removePart(partId));
}

/**
 * Copies a Part into a new, independent definition (fresh ids throughout), placed once where the
 * original's first occurrence is. Edits to one no longer show in the other; for a copy that
 * follows the original, add an occurrence instead.
 */
export function duplicatePartCmd(
	history: HistoryStack,
	doc: FoldnanoDocument,
	partId: string
): Part | null {
	const source = doc.parts.find((p) => p.id === partId);
	if (!source) return null;
	return history.snapshotTx(`Duplicate ${source.name}`, () => {
		const copy = Part.fromJSON({
			...remapPartIds(source.snapshot()),
			name: uniquePartName(doc, `${source.name} copy`),
			source: undefined,
		});
		doc.addPart(copy);
		const placedAt = doc.assembly.occurrencesOf(source.id)[0]?.transform;
		const occurrence = doc.assembly.occurrencesOf(copy.id)[0];
		if (placedAt && occurrence) occurrence.transform = cloneTransform(placedAt);
		return copy;
	});
}

export function renamePartCmd(history: HistoryStack, part: Part, name: string): void {
	const trimmed = name.trim();
	if (!trimmed || trimmed === part.name) return;
	history.tx('Rename Part', (rec) => {
		rec.field(partRef(part), 'name', part.name, trimmed);
		part.name = trimmed;
	});
}

/** Places the Part once more. Every occurrence shows the same definition, so edits show in all. */
export function addOccurrenceCmd(
	history: HistoryStack,
	doc: FoldnanoDocument,
	partId: string,
	transform: OccurrenceTransform = IDENTITY_TRANSFORM
): Occurrence | null {
	const part = doc.parts.find((p) => p.id === partId);
	if (!part) return null;
	return history.tx(`Add ${part.name} instance`, (rec) => {
		const occurrence = doc.assembly.add(part.id, doc.assembly.nextOccurrenceName(part.name), {
			transform,
		});
		rec.occurrence(occurrence.id, null, doc.assembly.stateOf(occurrence.id));
		return occurrence;
	});
}

/**
 * Removes one placement. Refuses (returns false) for a Part's last one: every Part stays placed
 * at least once, so removing it means deleting the Part (`deletePartCmd`). A broken occurrence
 * (its Part is missing) can always go.
 */
export function deleteOccurrenceCmd(
	history: HistoryStack,
	doc: FoldnanoDocument,
	occurrenceId: string
): boolean {
	const before = doc.assembly.stateOf(occurrenceId);
	if (!before) return false;
	if (isLastPlacement(doc, before.json.partId)) return false;
	history.tx(`Delete ${before.json.name}`, (rec) => {
		doc.assembly.remove(occurrenceId);
		rec.occurrence(occurrenceId, before, null);
	});
	return true;
}

/**
 * Points an occurrence at another Part, keeping its name, placement and visibility. Meant for a
 * broken occurrence whose Part is missing; refuses (returns false) when it is its Part's last
 * placement, since that would leave the Part unplaced.
 */
export function relinkOccurrenceCmd(
	history: HistoryStack,
	doc: FoldnanoDocument,
	occurrenceId: string,
	partId: string
): boolean {
	const before = doc.assembly.stateOf(occurrenceId);
	const part = doc.parts.find((p) => p.id === partId);
	if (!before || !part || before.json.partId === partId) return false;
	if (isLastPlacement(doc, before.json.partId)) return false;
	history.tx(`Link ${before.json.name} to ${part.name}`, (rec) => {
		doc.assembly.put({ ...before.json, partId }, before.index);
		rec.occurrence(occurrenceId, before, doc.assembly.stateOf(occurrenceId));
	});
	return true;
}

/** True when `partId` is a Part in the document placed only once. */
function isLastPlacement(doc: FoldnanoDocument, partId: string): boolean {
	return doc.parts.some((p) => p.id === partId) && doc.assembly.occurrencesOf(partId).length <= 1;
}

function updateOccurrence(
	history: HistoryStack,
	doc: FoldnanoDocument,
	occurrenceId: string,
	label: string,
	update: (occurrence: Occurrence) => void
): void {
	const occurrence = doc.assembly.getById(occurrenceId);
	if (!occurrence) return;
	history.tx(label, (rec) => {
		const before = doc.assembly.stateOf(occurrenceId);
		update(occurrence);
		rec.occurrence(occurrenceId, before, doc.assembly.stateOf(occurrenceId));
	});
}

export function setOccurrenceTransformCmd(
	history: HistoryStack,
	doc: FoldnanoDocument,
	occurrenceId: string,
	transform: OccurrenceTransform,
	label = 'Move instance'
): void {
	updateOccurrence(history, doc, occurrenceId, label, (occurrence) => {
		occurrence.transform = cloneTransform(transform);
	});
}

/** Records a move already applied live (gizmo drag): ends at `end`; undo returns to `start`. */
export function transformOccurrenceCmd(
	history: HistoryStack,
	doc: FoldnanoDocument,
	occurrenceId: string,
	start: OccurrenceTransform,
	end: OccurrenceTransform
): void {
	const occurrence = doc.assembly.getById(occurrenceId);
	if (!occurrence) return;
	// Rewind the live drag so the transaction itself makes the change and its rollback and
	// verification see the true pre-drag pose (as transformPlaneCmd does).
	occurrence.transform = cloneTransform(start);
	setOccurrenceTransformCmd(history, doc, occurrenceId, end);
}

export function renameOccurrenceCmd(
	history: HistoryStack,
	doc: FoldnanoDocument,
	occurrenceId: string,
	name: string
): void {
	const trimmed = name.trim();
	if (!trimmed) return;
	updateOccurrence(history, doc, occurrenceId, 'Rename instance', (occurrence) => {
		occurrence.name = trimmed;
	});
}

export function setOccurrenceVisibleCmd(
	history: HistoryStack,
	doc: FoldnanoDocument,
	occurrenceId: string,
	visible: boolean
): void {
	updateOccurrence(
		history,
		doc,
		occurrenceId,
		visible ? 'Show instance' : 'Hide instance',
		(occurrence) => {
			occurrence.visible = visible;
		}
	);
}

export function uniquePartName(doc: FoldnanoDocument, base: string): string {
	const taken = new Set(doc.parts.map((p) => p.name));
	if (!taken.has(base)) return base;
	let n = 2;
	while (taken.has(`${base} ${n}`)) n++;
	return `${base} ${n}`;
}
