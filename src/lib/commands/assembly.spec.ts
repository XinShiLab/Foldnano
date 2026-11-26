import { describe, expect, it } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import { Part } from '$lib/model/Part';
import { addLatticeVh } from '$lib/model/test/testHelpers';
import { checkDocumentIntegrity } from '$lib/model/checks/integrity';
import { remapPartIds } from '$lib/model/Part/remapPartIds';
import { createRepeatGroupCmd } from './repeatGroups';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { StorageManager } from '$lib/services/storage/StorageManager';
import { HistoryStack } from './history.svelte';
import {
	addOccurrenceCmd,
	addPartCmd,
	deleteOccurrenceCmd,
	deletePartCmd,
	duplicatePartCmd,
	relinkOccurrenceCmd,
	renameOccurrenceCmd,
	renamePartCmd,
	setOccurrenceTransformCmd,
	setOccurrenceVisibleCmd,
} from './assembly';

function setup() {
	const doc = new FoldnanoDocument(undefined, 'Assembly');
	const part = doc.addNewPart('HONEYCOMB');
	const vh = addLatticeVh(part, 0, 0);
	part.createOligo(vh, 0, 20, '#ff0000');
	const history = new HistoryStack(doc, new StorageManager('memory'));
	history.setAutoSaveConfig({ enabled: false });
	return { doc, part, history };
}

const snapshotOf = (doc: FoldnanoDocument) => JSON.stringify(doc.snapshot());

/** Runs `edit`, then checks undo returns to the state before and redo to the state after. */
function expectUndoable(doc: FoldnanoDocument, history: HistoryStack, edit: () => void): void {
	const before = snapshotOf(doc);
	edit();
	const after = snapshotOf(doc);
	expect(after).not.toBe(before);
	history.undoOnce();
	expect(snapshotOf(doc)).toBe(before);
	history.redoOnce();
	expect(snapshotOf(doc)).toBe(after);
}

const MOVED = {
	position: { x: 5, y: -2, z: 1 },
	quaternion: [0, 0, 1, 0] as [number, number, number, number],
};

describe('FoldnanoDocument assembly', () => {
	it('places a new Part once, named after it', () => {
		const { doc, part } = setup();
		expect(doc.assembly.occurrences.map((o) => [o.partId, o.name])).toEqual([
			[part.id, 'Part 1 1'],
		]);
	});

	it('removing a Part removes its occurrences', () => {
		const { doc, part } = setup();
		doc.assembly.add(part.id, 'extra');
		doc.removePart(part.id);
		expect(doc.parts).toHaveLength(0);
		expect(doc.assembly.occurrences).toHaveLength(0);
	});

	it('refuses to add the same Part twice', () => {
		const { doc, part } = setup();
		expect(() => doc.addPart(part)).toThrow(/already in the document/);
	});

	it('round-trips through JSON', () => {
		const { doc, part } = setup();
		doc.assembly.add(part.id, 'Moved', { transform: MOVED, visible: false });
		const reloaded = FoldnanoDocument.fromJSON(doc.snapshot());
		expect(reloaded.toJSON().assembly).toEqual(doc.toJSON().assembly);
	});

	it('restores the assembly on a whole-document undo', () => {
		const { doc, history } = setup();
		expectUndoable(doc, history, () => addPartCmd(history, doc, 'SQUARE'));
		expect(doc.assembly.occurrences).toHaveLength(2);
	});
});

describe('assembly commands', () => {
	it('adds and deletes Parts with undo', () => {
		const { doc, part, history } = setup();
		expectUndoable(doc, history, () => addPartCmd(history, doc, 'FREEFORM'));
		expectUndoable(doc, history, () => deletePartCmd(history, doc, part.id));
		expect(doc.parts.map((p) => p.name)).toEqual(['Part 2']);
		expect(doc.assembly.occurrences.every((o) => o.partId !== part.id)).toBe(true);
	});

	it('duplicates a Part as an independent definition placed like the original', () => {
		const { doc, part, history } = setup();
		const [first] = doc.assembly.occurrencesOf(part.id);
		setOccurrenceTransformCmd(history, doc, first.id, MOVED);

		let copy: Part | null = null;
		expectUndoable(doc, history, () => (copy = duplicatePartCmd(history, doc, part.id)));
		copy = doc.parts[1];

		expect(copy.name).toBe('Part 1 copy');
		expect(copy.id).not.toBe(part.id);
		expect(copy.oligos.size).toBe(part.oligos.size);
		expect(doc.assembly.occurrencesOf(copy.id)[0].transform).toEqual(MOVED);
		const originalIds = new Set(JSON.stringify(part.toJSON()).match(/[0-9a-f-]{36}/g));
		const copyIds = JSON.stringify(copy.toJSON()).match(/[0-9a-f-]{36}/g) ?? [];
		expect(copyIds.filter((id) => originalIds.has(id))).toEqual([]);
	});

	it('names repeated duplicates apart', () => {
		const { doc, part, history } = setup();
		duplicatePartCmd(history, doc, part.id);
		duplicatePartCmd(history, doc, part.id);
		expect(doc.parts.map((p) => p.name)).toEqual(['Part 1', 'Part 1 copy', 'Part 1 copy 2']);
	});

	it('renames a Part with undo and ignores a blank name', () => {
		const { doc, part, history } = setup();
		expectUndoable(doc, history, () => renamePartCmd(history, part, '  Brick  '));
		expect(part.name).toBe('Brick');
		renamePartCmd(history, part, '   ');
		expect(part.name).toBe('Brick');
	});

	it('adds, edits and deletes occurrences with undo', () => {
		const { doc, part, history } = setup();
		let id = '';
		expectUndoable(doc, history, () => {
			id = addOccurrenceCmd(history, doc, part.id, MOVED)!.id;
		});
		expect(doc.assembly.getById(id)?.name).toBe('Part 1 2');

		expectUndoable(doc, history, () =>
			setOccurrenceTransformCmd(history, doc, id, {
				position: { x: 0, y: 3, z: 0 },
				quaternion: [0, 0, 0, 1],
			})
		);
		expectUndoable(doc, history, () => renameOccurrenceCmd(history, doc, id, 'Left brick'));
		expectUndoable(doc, history, () => setOccurrenceVisibleCmd(history, doc, id, false));
		expectUndoable(doc, history, () => deleteOccurrenceCmd(history, doc, id));
	});

	it('puts a deleted occurrence back at its list position', () => {
		const { doc, part, history } = setup();
		addOccurrenceCmd(history, doc, part.id);
		addOccurrenceCmd(history, doc, part.id);
		const order = doc.assembly.occurrences.map((o) => o.id);
		deleteOccurrenceCmd(history, doc, order[1]);
		history.undoOnce();
		expect(doc.assembly.occurrences.map((o) => o.id)).toEqual(order);
	});

	it("refuses to delete a Part's last occurrence", () => {
		const { doc, part, history } = setup();
		const [only] = doc.assembly.occurrencesOf(part.id);
		expect(deleteOccurrenceCmd(history, doc, only.id)).toBe(false);
		expect(doc.assembly.occurrencesOf(part.id)).toHaveLength(1);
		expect(history.numberOfUndos).toBe(0);
	});

	it('relinks a broken occurrence to a Part, keeping its placement, with undo', () => {
		const { doc, part, history } = setup();
		const broken = doc.assembly.add('no-such-part', 'Orphan', { transform: MOVED });
		expectUndoable(doc, history, () =>
			expect(relinkOccurrenceCmd(history, doc, broken.id, part.id)).toBe(true)
		);
		const relinked = doc.assembly.getById(broken.id)!;
		expect([relinked.partId, relinked.name, relinked.transform]).toEqual([
			part.id,
			'Orphan',
			MOVED,
		]);
		expect(checkDocumentIntegrity(doc).map((issue) => issue.rule)).not.toContain('occurrence-part');
	});

	it("refuses to relink a Part's last occurrence away", () => {
		const { doc, part, history } = setup();
		const other = addPartCmd(history, doc, 'SQUARE');
		const [only] = doc.assembly.occurrencesOf(part.id);
		expect(relinkOccurrenceCmd(history, doc, only.id, other.id)).toBe(false);
		expect(doc.assembly.getById(only.id)?.partId).toBe(part.id);
	});

	it('deletes a broken occurrence even when it is the only one left', () => {
		const { doc, history } = setup();
		const broken = doc.assembly.add('no-such-part', 'Orphan');
		expectUndoable(doc, history, () =>
			expect(deleteOccurrenceCmd(history, doc, broken.id)).toBe(true)
		);
	});

	it('refuses an assembly edit inside a Part-scoped snapshot', () => {
		const { doc, part, history } = setup();
		expect(() =>
			history.partSnapshotTx('Leaky', part, () => {
				doc.assembly.add(part.id, 'sneaky');
			})
		).toThrow(/outside its Part-scoped snapshot/);
	});
});

describe('remapPartIds', () => {
	it('gives every entity a new id and keeps the references consistent', () => {
		const { part } = setup();
		const copy = Part.fromJSON(remapPartIds(part.snapshot()));
		expect(copy.id).not.toBe(part.id);
		expect(copy.virtualHelices[0].id).not.toBe(part.virtualHelices[0].id);
		expect(copy.virtualHelices[0].regionId).toBe(copy.regions[0].id);
		expect(copy.regions[0].planeId).toBe(copy.planes[0].id);
		const segment = [...[...copy.oligos][0].segments][0];
		expect(copy.segmentsLookup.get(segment.id)).toBe(segment);
	});

	it('rewrites only id fields: content equal to an id stays as it is', () => {
		const raw = JSON.parse(
			readFileSync(join(process.cwd(), 'test_files/fixtures/document_format/v3.fn.json'), 'utf8')
		);
		const part = Part.fromJSON({ ...raw.parts[0], id: 'N' });
		const before = part.snapshot();
		const after = remapPartIds(before);
		expect(after.id).not.toBe('N');
		const seqsOf = (json: typeof before) =>
			json.oligos.flatMap((o) => o.segments.flatMap((s) => s.slots.map((slot) => slot.seq)));
		expect(seqsOf(after)).toEqual(seqsOf(before));
		expect(Part.fromJSON(after).oligos.size).toBe(part.oligos.size);
	});

	it('leaves no old id anywhere, repeat groups and mirrors included', () => {
		const { part, history } = setup();
		const [oligo] = [...part.oligos];
		createRepeatGroupCmd({ part, oligos: [oligo], bpOffset: 21 }, history);
		const before = part.snapshot();
		const oldIds = new Set(
			JSON.stringify(before)
				.match(/"id":"([^"]+)"/g)!
				.map((m) => m.slice(6, -1))
		);
		const text = JSON.stringify(remapPartIds(before));
		for (const id of oldIds) expect(text).not.toContain(id);
		const copy = Part.fromJSON(JSON.parse(text));
		const mirror = [...copy.oligos].find((o) => o.mirrorOf)!;
		expect(copy.repeatGroups[0].id).toBe(mirror.mirrorOf!.groupId);
		expect([...copy.oligos].some((o) => o.id === mirror.mirrorOf!.sourceOligoId)).toBe(true);
	});
});

describe('occurrence integrity', () => {
	it('flags an occurrence whose Part is missing', () => {
		const { doc } = setup();
		doc.assembly.add('no-such-part', 'Orphan');
		expect(checkDocumentIntegrity(doc).map((issue) => issue.rule)).toContain('occurrence-part');
	});

	it('flags a Part that is not placed', () => {
		const { doc, part } = setup();
		doc.assembly.removeAllOf(part.id);
		expect(checkDocumentIntegrity(doc).map((issue) => issue.message)).toContain(
			`Part "${part.name}" isn't placed anywhere in the design.`
		);
	});
});
