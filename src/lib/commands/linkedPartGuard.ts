import type FoldnanoDocument from '../model/document.svelte';
import type { Part } from '../model/Part';
import { InvalidOperationError } from '../errors';
import type { AtomicChange, HistoryEntry } from './historyChanges';

type PartJSON = ReturnType<Part['toJSON']>;

/** Fields a linked Part may still change: its local name, and the link itself (break link). */
const LOCAL_PART_FIELDS = new Set(['name', 'source']);

const contentOf = (json: PartJSON) => JSON.stringify({ ...json, name: '', source: undefined });

/** True when `before` was a linked Part and `after` changed more than its local fields. */
function linkedContentChanged(before: PartJSON, after: PartJSON | undefined): boolean {
	return !!before.source && !!after && contentOf(before) !== contentOf(after);
}

function partIdOf(change: AtomicChange): string | null {
	switch (change.kind) {
		case 'field':
			if (change.ref.kind === 'doc') return null;
			if (change.ref.kind === 'part' && LOCAL_PART_FIELDS.has(change.field)) return null;
			return change.ref.partId;
		case 'slotSeq':
			return change.ref.partId;
		case 'partMemento':
			return change.memento.partId;
		case 'planeTransform':
		case 'planeAdd':
		case 'planeRemove':
		case 'regionAdd':
		case 'regionRemove':
		case 'regionReferenceGeometry':
		case 'overlayPlacementSet':
		case 'overlayPlacementRemove':
			return change.partId;
		case 'stickyRecordSet':
		case 'stickyRecordRemove':
			return change.home.kind === 'part' ? change.home.partId : null;
		default:
			return null;
	}
}

/**
 * Name of a linked Part that `entry` (already applied to `doc`) edits, or null. A linked Part is
 * a cached copy of another design (`Part.source`): changing it here would be lost on the next
 * update, so every history path refuses it. Deleting or duplicating one is fine.
 */
export function linkedPartEditedBy(doc: FoldnanoDocument, entry: HistoryEntry): string | null {
	// Snapshot entries hold one change each way, so their `before` is the undo change of that kind.
	const undoOf = <K extends AtomicChange['kind']>(kind: K) =>
		entry.undo.find((c): c is Extract<AtomicChange, { kind: K }> => c.kind === kind);
	for (const change of entry.redo) {
		const partId = partIdOf(change);
		if (partId) {
			const part = doc.parts.find((p) => p.id === partId);
			if (part?.source) return part.name;
			continue;
		}
		if (change.kind === 'partSnapshot') {
			const before = undoOf('partSnapshot');
			if (before && linkedContentChanged(before.snapshot, change.snapshot)) {
				return before.snapshot.name;
			}
		}
		if (change.kind === 'documentSnapshot') {
			const before = undoOf('documentSnapshot');
			if (!before) continue;
			for (const part of before.snapshot.parts) {
				const after = change.snapshot.parts.find((p) => p.id === part.id);
				if (linkedContentChanged(part, after)) return part.name;
			}
		}
	}
	return null;
}

export function linkedPartRefusal(name: string): InvalidOperationError {
	return new InvalidOperationError(
		`"${name}" is linked to another design and can't be edited here. Open the source to change it, or break the link to edit a copy.`
	);
}
