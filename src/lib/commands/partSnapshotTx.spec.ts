import { describe, expect, it } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import { Part } from '$lib/model/Part';
import { addLatticeVh } from '$lib/model/test/testHelpers';
import { StorageManager } from '$lib/services/storage/StorageManager';
import { HistoryStack } from './history.svelte';
import { addFreeformVirtualHelixCmd } from './virtualHelix';
import { createRepeatGroupCmd } from './repeatGroups';

function twoPartDoc() {
	const doc = new FoldnanoDocument(undefined, 'Two parts');
	const partA = Part.forType('HONEYCOMB', 'A');
	addLatticeVh(partA, 0, 0);
	const partB = Part.forType('FREEFORM', 'B');
	doc.parts.push(partA, partB);
	const history = new HistoryStack(doc, new StorageManager('memory'));
	history.setAutoSaveConfig({ enabled: false });
	return { doc, partA, partB, history };
}

const json = (part: Part) => JSON.stringify(part.toJSON());

describe('HistoryStack.partSnapshotTx', () => {
	it('undoes and redoes one Part without replacing the other Part objects', () => {
		const { doc, partA, partB, history } = twoPartDoc();
		const aBefore = json(partA);
		const bBefore = json(partB);

		addFreeformVirtualHelixCmd({ part: partB, x: 0, y: 0 }, history);
		const bAfter = json(doc.parts[1]);
		expect(bAfter).not.toBe(bBefore);
		expect(history.numberOfUndos).toBe(1);

		history.undoOnce();
		expect(doc.parts[0]).toBe(partA);
		expect(json(doc.parts[0])).toBe(aBefore);
		expect(json(doc.parts[1])).toBe(bBefore);

		history.redoOnce();
		expect(doc.parts[0]).toBe(partA);
		expect(json(doc.parts[1])).toBe(bAfter);
	});

	it('restores the Part and records nothing when the edit throws', () => {
		const { doc, partA, partB, history } = twoPartDoc();
		const bBefore = json(partB);
		expect(() =>
			history.partSnapshotTx('Failing edit', partB, () => {
				partB.name = 'Changed';
				throw new Error('boom');
			})
		).toThrow('boom');
		expect(history.numberOfUndos).toBe(0);
		expect(doc.parts[0]).toBe(partA);
		expect(json(doc.parts[1])).toBe(bBefore);
	});

	it('follows a Part replaced by one with another id (plugin results)', () => {
		const { doc, partA, partB, history } = twoPartDoc();
		const replacement = Part.forType('FREEFORM', 'B2');
		history.partSnapshotTx('Replace', partB, () => {
			doc.parts[1] = replacement;
		});
		expect(doc.parts[1].id).toBe(replacement.id);

		history.undoOnce();
		expect(doc.parts[1].id).toBe(partB.id);
		expect(doc.parts[0]).toBe(partA);

		history.redoOnce();
		expect(doc.parts[1].id).toBe(replacement.id);
	});

	it('refuses an edit that touches another Part', () => {
		const { partA, partB, history } = twoPartDoc();
		const vh = partA.virtualHelices[0];
		expect(() =>
			history.partSnapshotTx('Leaky edit', partB, () => {
				partA.createOligo(vh, 0, 10, '#ff0000');
			})
		).toThrow(/outside its Part-scoped snapshot/);
	});

	it('refuses an edit that adds a Part', () => {
		const { doc, partB, history } = twoPartDoc();
		expect(() =>
			history.partSnapshotTx('Adds a Part', partB, () => {
				doc.addNewPart('SQUARE');
			})
		).toThrow(/outside its Part-scoped snapshot/);
	});

	it('refuses a Part that is not in the document', () => {
		const { history } = twoPartDoc();
		expect(() => history.partSnapshotTx('Stray', Part.forType('SQUARE', 'X'), () => {})).toThrow(
			/not in the document/
		);
	});

	it('rebuilds mirrors of the edited Part inside the same entry', () => {
		const { doc, partA, history } = twoPartDoc();
		const vh = partA.virtualHelices[0];
		const oligo = partA.createOligo(vh, 0, 10, '#00ff00');
		const before = json(partA);
		createRepeatGroupCmd({ part: partA, oligos: [oligo], bpOffset: 20 }, history);
		const mirrors = [...doc.parts[0].oligos].filter((o) => o.isMirror);
		expect(mirrors.length).toBe(1);

		history.undoOnce();
		expect(json(doc.parts[0])).toBe(before);
	});
});
