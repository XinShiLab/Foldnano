import { expect } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import { StorageManager } from '$lib/services/storage/StorageManager';
import { HistoryStack } from '../history.svelte';
import { canonicalSnapshot, firstDifference } from '../historyVerification';

/** A history stack with autosave off: round-trip tests make many edits and never persist. */
export function createTestHistory(doc: FoldnanoDocument): HistoryStack {
	const history = new HistoryStack(doc, new StorageManager('memory'));
	history.setAutoSaveConfig({ enabled: false });
	return history;
}

function expectDocument(doc: FoldnanoDocument, expected: unknown, step: string): void {
	const difference = firstDifference(canonicalSnapshot(doc.snapshot()), expected);
	expect(difference, `${step} should restore the document`).toBeNull();
}

/** Runs `edit`, which must record exactly one history entry, then undoes and redoes it on the
 * live document twice, checking the document after every step. (`HistoryStack` itself checks
 * derived state after each edit, undo and redo whenever tests run; see `findDerivedStateMismatch`.) */
export function expectUndoRoundTrip<R>(
	doc: FoldnanoDocument,
	history: HistoryStack,
	edit: () => R
): R {
	const before = canonicalSnapshot(doc.snapshot());
	const entriesBefore = history.numberOfUndos;
	const result = edit();
	expect(history.numberOfUndos, 'the edit should record exactly one history entry').toBe(
		entriesBefore + 1
	);
	const after = canonicalSnapshot(doc.snapshot());
	expect(firstDifference(after, before), 'the edit should change the document').not.toBeNull();
	for (const cycle of [1, 2]) {
		history.undoOnce();
		expectDocument(doc, before, `undo #${cycle}`);
		history.redoOnce();
		expectDocument(doc, after, `redo #${cycle}`);
	}
	return result;
}
