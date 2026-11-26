import { describe, expect, it } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import { Plane } from '$lib/model/Part';
import { addLatticeVh, addFreeformVh } from '$lib/model/test/testHelpers';
import {
	canonicalPartJson,
	linkFromSource,
	partContentHash,
	sameLinkTarget,
} from '$lib/model/partLinks';
import { InvalidOperationError } from '$lib/errors';
import { collectDesignIssues } from '$lib/model/checks/collect';
import { StorageManager } from '$lib/services/storage/StorageManager';
import { HistoryStack } from './history.svelte';
import { deletePartCmd, duplicatePartCmd, renamePartCmd } from './assembly';
import { addPlaneCmd } from './planes';
import { drawStrandCmd, paintOligoCmd } from './strands';
import { addFreeformVirtualHelixCmd } from './virtualHelix';
import { breakPartLinkCmd, insertLinkedPartCmd, updateLinkedPartCmd } from './partLinks';

function sourceDesign(kind: 'HONEYCOMB' | 'FREEFORM' = 'HONEYCOMB') {
	const doc = new FoldnanoDocument(undefined, 'Hinge');
	const part = doc.addNewPart(kind);
	const vh = kind === 'HONEYCOMB' ? addLatticeVh(part, 0, 0) : addFreeformVh(part, [0, 0, 0]);
	part.createOligo(vh, 0, 20, '#ff0000');
	return { doc, part };
}

async function assemblyWithLink(kind: 'HONEYCOMB' | 'FREEFORM' = 'HONEYCOMB') {
	const source = sourceDesign(kind);
	const doc = new FoldnanoDocument(undefined, 'Assembly');
	const own = doc.addNewPart('HONEYCOMB');
	const history = new HistoryStack(doc, new StorageManager('memory'));
	history.setAutoSaveConfig({ enabled: false });
	const link = await linkFromSource(source.doc, { docId: source.doc.id });
	const linked = insertLinkedPartCmd(history, doc, link.json, link.source, source.doc.name);
	return { source, doc, own, history, linked };
}

const contentOf = (doc: FoldnanoDocument) => JSON.stringify(doc.toJSON());

describe('linked Parts', () => {
	it('insert a read-only copy with fresh ids, one undoable step', async () => {
		const { source, doc, history, linked } = await assemblyWithLink();
		expect(linked.name).toBe('Hinge');
		expect(linked.source).toMatchObject({ docId: source.doc.id, partId: source.part.id });
		expect(doc.assembly.occurrencesOf(linked.id)).toHaveLength(1);
		const copyText = JSON.stringify(linked.toJSON());
		for (const oligo of source.part.oligos) expect(copyText).not.toContain(oligo.id);
		expect(linked.oligos.size).toBe(source.part.oligos.size);

		history.undoOnce();
		expect(doc.parts.some((p) => p.id === linked.id)).toBe(false);
	});

	it('refuse every kind of edit and leave the document as it was', async () => {
		const { doc, history, linked } = await assemblyWithLink();
		const before = contentOf(doc);
		const undos = history.numberOfUndos;
		const vhIdx = linked.virtualHelices[0].index;
		const oligo = [...linked.oligos][0];
		const edits: [string, () => void][] = [
			[
				'targeted strand edit',
				() =>
					drawStrandCmd(
						{ part: linked, vhIdx, startIdx: 25, endIdx: 30, color: '#00ff00' },
						history
					),
			],
			['field edit', () => paintOligoCmd({ oligo, color: '#00ff00' }, history)],
			['plane edit', () => addPlaneCmd(history, linked, new Plane())],
			[
				'whole-document snapshot',
				() => history.tx(() => linked.createOligo(linked.virtualHelices[0], 25, 30, '#0f0')),
			],
		];
		for (const [what, edit] of edits) {
			expect(edit, what).toThrow(InvalidOperationError);
			expect(contentOf(doc), what).toBe(before);
		}
		expect(history.numberOfUndos).toBe(undos);
	});

	it('refuse a Part-scoped snapshot edit', async () => {
		const { doc, history, linked } = await assemblyWithLink('FREEFORM');
		const before = contentOf(doc);
		expect(() => addFreeformVirtualHelixCmd({ part: linked, x: 5, y: 5 }, history)).toThrow(
			InvalidOperationError
		);
		expect(contentOf(doc)).toBe(before);
	});

	it('still rename, duplicate and delete', async () => {
		const { doc, history, linked } = await assemblyWithLink();
		renamePartCmd(history, linked, 'Left hinge');
		expect(linked.name).toBe('Left hinge');
		const copy = duplicatePartCmd(history, doc, linked.id)!;
		expect(copy.source).toBeNull();
		paintOligoCmd({ oligo: [...copy.oligos][0], color: '#00ff00' }, history);
		deletePartCmd(history, doc, linked.id);
		expect(doc.parts.some((p) => p.id === linked.id)).toBe(false);
	});

	it('break link makes the Part editable; undo links it again', async () => {
		const { history, linked } = await assemblyWithLink();
		breakPartLinkCmd(history, linked);
		expect(linked.source).toBeNull();
		paintOligoCmd({ oligo: [...linked.oligos][0], color: '#00ff00' }, history);
		history.undoOnce();
		history.undoOnce();
		expect(linked.source).not.toBeNull();
		expect(() =>
			paintOligoCmd({ oligo: [...linked.oligos][0], color: '#0000ff' }, history)
		).toThrow(InvalidOperationError);
	});

	it('update brings in the source change, keeping id, name and placements; undo reverts', async () => {
		const { source, doc, history, linked } = await assemblyWithLink();
		renamePartCmd(history, linked, 'Left hinge');
		const placements = JSON.stringify(doc.assembly.toJSON());
		source.part.createOligo(source.part.virtualHelices[0], 25, 30, '#00ff00');
		const link = await linkFromSource(source.doc, { docId: source.doc.id });
		expect(link.source.contentHash).not.toBe(linked.source!.contentHash);

		updateLinkedPartCmd(history, doc, linked.id, link.json, link.source);
		const updated = doc.parts.find((p) => p.id === linked.id)!;
		expect(updated.oligos.size).toBe(2);
		expect(updated.name).toBe('Left hinge');
		expect(updated.source!.contentHash).toBe(link.source.contentHash);
		expect(JSON.stringify(doc.assembly.toJSON())).toBe(placements);

		history.undoOnce();
		expect(doc.parts.find((p) => p.id === linked.id)!.oligos.size).toBe(1);
	});

	it('update keeps the ids of entities that survive, so the active region still resolves', async () => {
		const { source, doc, history, linked } = await assemblyWithLink();
		const regionId = linked.regions[0].id;
		const vhId = linked.virtualHelices[0].id;
		source.part.createOligo(source.part.virtualHelices[0], 25, 30, '#00ff00');
		const link = await linkFromSource(source.doc, { docId: source.doc.id });
		updateLinkedPartCmd(history, doc, linked.id, link.json, link.source);
		const updated = doc.parts.find((p) => p.id === linked.id)!;
		expect(updated.regions[0].id).toBe(regionId);
		expect(updated.virtualHelices[0].id).toBe(vhId);
	});

	it('two copies of one source never share an id', async () => {
		const { source, doc, history, linked } = await assemblyWithLink();
		const link = await linkFromSource(source.doc, { docId: source.doc.id });
		const second = insertLinkedPartCmd(history, doc, link.json, link.source, 'Hinge');
		const idsOf = (json: unknown) => new Set(JSON.stringify(json).match(/"id":"[^"]+"/g));
		const first = idsOf(linked.toJSON());
		for (const id of idsOf(second.toJSON())) expect(first.has(id)).toBe(false);
	});
});

describe('sameLinkTarget', () => {
	const link = { partId: 'p', contentHash: 'h', linkedAt: '' };
	it('matches a local link once its source is published (same local id, new repo path)', () => {
		expect(sameLinkTarget({ ...link, docId: 'd' }, { docId: 'd', repoPath: 'a.fn.json' })).toBe(
			true
		);
	});
	it('matches by repo path, and tells different designs apart', () => {
		expect(
			sameLinkTarget({ ...link, repoPath: 'a.fn.json', docId: 'x' }, { repoPath: 'a.fn.json' })
		).toBe(true);
		expect(sameLinkTarget({ ...link, docId: 'd' }, { docId: 'e' })).toBe(false);
		expect(sameLinkTarget({ ...link, repoPath: 'a.fn.json' }, { repoPath: 'b.fn.json' })).toBe(
			false
		);
	});
});

describe('partContentHash', () => {
	it('ignores key order, id, name and link info', async () => {
		const { part } = sourceDesign();
		const json = part.snapshot();
		const reordered = Object.fromEntries(Object.entries(json).reverse()) as typeof json;
		expect(canonicalPartJson(reordered)).toBe(canonicalPartJson(json));
		const renamed = { ...json, id: 'other', name: 'Other', source: undefined };
		expect(await partContentHash(renamed)).toBe(await partContentHash(json));
	});

	it('changes with the content', async () => {
		const { part } = sourceDesign();
		const before = await partContentHash(part.snapshot());
		part.createOligo(part.virtualHelices[0], 25, 30, '#00ff00');
		expect(await partContentHash(part.snapshot())).not.toBe(before);
	});

	it('survives a save and reload of the source', async () => {
		const { doc, part } = sourceDesign();
		const reloaded = FoldnanoDocument.fromJSON(JSON.parse(JSON.stringify(doc.snapshot())));
		expect(await partContentHash(reloaded.parts[0].snapshot())).toBe(
			await partContentHash(part.snapshot())
		);
	});
});

describe('link design checks', () => {
	it('warn about an outdated or missing source, only for linked Parts', async () => {
		const { own, linked } = await assemblyWithLink();
		const none = { integrity: false, simulation: false, cadnano: false };
		expect(collectDesignIssues(linked, null, none, 'upToDate')).toEqual([]);
		expect(collectDesignIssues(linked, null, none, 'outdated').map((i) => i.rule)).toEqual([
			'link-outdated',
		]);
		expect(collectDesignIssues(linked, null, none, 'missing')[0].severity).toBe('warning');
		expect(collectDesignIssues(own, null, none, 'outdated')).toEqual([]);
	});
});
