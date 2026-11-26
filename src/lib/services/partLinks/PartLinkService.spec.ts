import { describe, expect, it } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import { addLatticeVh } from '$lib/model/test/testHelpers';
import { linkFromSource, type PartLinkTarget } from '$lib/model/partLinks';
import { insertLinkedPartCmd } from '$lib/commands/partLinks';
import { HistoryStack } from '$lib/commands/history.svelte';
import { StorageManager } from '$lib/services/storage/StorageManager';
import { PartLinkService } from './PartLinkService.svelte';

function hinge() {
	const doc = new FoldnanoDocument('hinge-doc', 'Hinge');
	const part = doc.addNewPart('HONEYCOMB');
	part.createOligo(addLatticeVh(part, 0, 0), 0, 20, '#ff0000');
	return { doc, part };
}

/** An assembly linking the hinge through `target`, with stored designs in `stored`. */
async function setup(
	target: PartLinkTarget,
	repoPaths: Record<string, string> = {},
	otherRepos: Record<string, string> = {}
) {
	const source = hinge();
	const stored = new Map<string, object>([[source.doc.id, source.doc.snapshot()]]);
	const doc = new FoldnanoDocument(undefined, 'Assembly');
	doc.addNewPart('HONEYCOMB');
	const history = new HistoryStack(doc, new StorageManager('memory'));
	history.setAutoSaveConfig({ enabled: false });
	const link = await linkFromSource(source.doc, target);
	const linked = insertLinkedPartCmd(history, doc, link.json, link.source, 'Hinge');
	const service = new PartLinkService(() => doc, {
		loadDocument: async (id) => stored.get(id) ?? null,
		findDocIdByRepoPath: (path) => repoPaths[path] ?? null,
		repoPathOf: (id) => Object.entries(repoPaths).find(([, docId]) => docId === id)?.[0] ?? null,
		blobShaOf: () => undefined,
		otherRepoOf: (id) => otherRepos[id] ?? null,
	});
	const status = async () => {
		await service.refresh();
		return service.statusOf(linked)?.state;
	};
	return { source, stored, doc, history, linked, service, status };
}

describe('PartLinkService', () => {
	it('a fresh link is up to date', async () => {
		const { status, service, linked } = await setup({ docId: 'hinge-doc' });
		expect(await status()).toBe('upToDate');
		expect(service.statusOf(linked)?.localOnly).toBe(true);
	});

	it('a saved change to the source makes it outdated, and update brings it in', async () => {
		const { source, stored, status, service, history, doc, linked } = await setup({
			docId: 'hinge-doc',
		});
		source.part.createOligo(source.part.virtualHelices[0], 25, 30, '#00ff00');
		expect(await status()).toBe('upToDate');
		stored.set(source.doc.id, source.doc.snapshot());
		expect(await status()).toBe('outdated');

		expect(await service.update(history, linked.id)).toEqual({ ok: true });
		const updated = doc.parts.find((p) => p.id === linked.id)!;
		expect(updated.oligos.size).toBe(2);
		expect(service.statusOf(updated)?.state).toBe('upToDate');
	});

	it('a deleted source is missing; the copy stays', async () => {
		const { stored, status, linked } = await setup({ docId: 'hinge-doc' });
		stored.clear();
		expect(await status()).toBe('missing');
		expect(linked.oligos.size).toBe(1);
	});

	it('resolves a repo path in the current repo before the stored id', async () => {
		const { stored, source, status, service, linked } = await setup(
			{ repoPath: 'parts/hinge.json', docId: 'old-id' },
			{ 'parts/hinge.json': 'hinge-doc' }
		);
		expect(stored.has(source.doc.id)).toBe(true);
		expect(await status()).toBe('upToDate');
		expect(service.statusOf(linked)).toMatchObject({ sourceDocId: 'hinge-doc', localOnly: false });
	});

	it('flags links others cannot follow from the design repo', async () => {
		const local = await setup({ docId: 'hinge-doc' });
		expect(local.service.unfollowableLinks()).toEqual({ localOnly: [local.linked], otherRepo: [] });

		const here = await setup(
			{ repoPath: 'parts/hinge.json', docId: 'hinge-doc' },
			{ 'parts/hinge.json': 'hinge-doc' }
		);
		expect(here.service.unfollowableLinks()).toEqual({ localOnly: [], otherRepo: [] });

		// A source in another repo is flagged whether or not its link has a path.
		for (const target of [
			{ repoPath: 'parts/hinge.json', docId: 'hinge-doc' },
			{ docId: 'hinge-doc' },
		]) {
			const elsewhere = await setup(target, {}, { 'hinge-doc': 'lab/parts' });
			expect(elsewhere.service.unfollowableLinks()).toEqual({
				localOnly: [],
				otherRepo: [{ part: elsewhere.linked, repo: 'lab/parts' }],
			});
		}
	});

	it('update gives a local-only link the repo path its source was published to', async () => {
		const repoPaths: Record<string, string> = {};
		const { service, history, doc, linked, status } = await setup(
			{ docId: 'hinge-doc' },
			repoPaths
		);
		expect(await status()).toBe('upToDate');
		repoPaths['parts/hinge.json'] = 'hinge-doc';
		await service.update(history, linked.id);
		const updated = doc.parts.find((p) => p.id === linked.id)!;
		expect(updated.source?.repoPath).toBe('parts/hinge.json');
		expect(service.statusOf(updated)?.localOnly).toBe(false);
	});

	it('a repo design not opened here is not local', async () => {
		const { status } = await setup({ repoPath: 'parts/hinge.json' });
		expect(await status()).toBe('notLocal');
	});

	it('a portable link whose local id is from another browser is not local, not missing', async () => {
		const { stored, status } = await setup({ repoPath: 'parts/hinge.json', docId: 'hinge-doc' });
		stored.clear();
		expect(await status()).toBe('notLocal');
	});

	it('a source whose Part was replaced is never updated silently', async () => {
		const { source, stored, status, service, history, doc, linked } = await setup({
			docId: 'hinge-doc',
		});
		const before = JSON.stringify(linked.toJSON());
		source.doc.removePart(source.part.id);
		source.doc.addNewPart('SQUARE');
		stored.set(source.doc.id, source.doc.snapshot());
		expect(await status()).toBe('replaced');

		expect(await service.update(history, linked.id)).toEqual({ ok: false, reason: 'replaced' });
		expect(JSON.stringify(doc.parts.find((p) => p.id === linked.id)!.toJSON())).toBe(before);

		expect(await service.update(history, linked.id, { relink: true })).toEqual({ ok: true });
		const relinked = doc.parts.find((p) => p.id === linked.id)!;
		expect(relinked.source?.partId).toBe(source.doc.parts[0].id);
		expect(service.statusOf(relinked)?.state).toBe('upToDate');
	});

	it('a source that gained a second Part is unlinkable, and update leaves the copy', async () => {
		const { source, stored, status, service, history, linked } = await setup({
			docId: 'hinge-doc',
		});
		const before = JSON.stringify(linked.toJSON());
		source.doc.addNewPart('SQUARE');
		stored.set(source.doc.id, source.doc.snapshot());
		expect(await status()).toBe('unlinkable');
		expect(await service.update(history, linked.id)).toMatchObject({
			ok: false,
			reason: 'unlinkable',
		});
		expect(JSON.stringify(linked.toJSON())).toBe(before);
	});
});

describe('PartLinkService update while the source is being read', () => {
	it('does not revert a Relink made in the meantime', async () => {
		const { source, stored, service, history, doc, linked } = await setup({ docId: 'hinge-doc' });
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const original = source.doc.snapshot();
		// The slow read hands out the original source; a Relink to a new Part lands meanwhile.
		const slow = new PartLinkService(() => doc, {
			loadDocument: async () => {
				await gate;
				return original;
			},
			findDocIdByRepoPath: () => null,
			repoPathOf: () => null,
			otherRepoOf: () => null,
			blobShaOf: () => undefined,
		});
		const pending = slow.update(history, linked.id);
		source.doc.removePart(source.part.id);
		source.doc.addNewPart('SQUARE');
		stored.set(source.doc.id, source.doc.snapshot());
		expect(await service.update(history, linked.id, { relink: true })).toEqual({ ok: true });
		const relinked = JSON.stringify(doc.parts.find((p) => p.id === linked.id)!.toJSON());

		release();
		expect(await pending).toEqual({ ok: false, reason: 'superseded' });
		expect(JSON.stringify(doc.parts.find((p) => p.id === linked.id)!.toJSON())).toBe(relinked);
	});

	it('refuses to replace the copy once the tab no longer owns the design', async () => {
		const { stored, source, service, history, doc, linked } = await setup({ docId: 'hinge-doc' });
		source.part.createOligo(source.part.virtualHelices[0], 25, 30, '#00ff00');
		stored.set(source.doc.id, source.doc.snapshot());
		let owner = true;
		const before = JSON.stringify(linked.toJSON());
		const pending = service.update(history, linked.id, { canEdit: () => owner });
		owner = false;
		expect(await pending).toEqual({ ok: false, reason: 'readOnly' });
		expect(JSON.stringify(doc.parts.find((p) => p.id === linked.id)!.toJSON())).toBe(before);
	});
});
