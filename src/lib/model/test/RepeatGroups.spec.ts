import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import FoldnanoDocument from '$lib/model/document.svelte';
import type Oligo from '$lib/model/Oligo';
import type OligoSegment from '$lib/model/Oligo/OligoSegment.svelte';
import { Part } from '$lib/model/Part';
import { oligoFingerprint } from '$lib/model/Part/repeatGroups';
import { FreeformRegion } from '$lib/model/Part/DesignRegion';
import { HistoryStack } from '$lib/commands/history.svelte';
import {
	addSkipOrInsertionCmd,
	breakOligoCmd,
	fillSequenceToOligoCmd,
	moveOligoEndCmd,
	paintOligoCmd,
	removeOligoCmd,
} from '$lib/commands/strands';
import {
	addRepeatInstanceCmd,
	createRepeatGroupCmd,
	deleteRepeatGroupCmd,
	detachRepeatGroupCmd,
	removeRepeatInstanceCmd,
} from '$lib/commands/repeatGroups';
import { collectPartOligoReportRows } from '$lib/model/io/oligoReport';
import { collectPartOligoSequences } from '$lib/model/io/sequenceCSV';
import { collectOxDnaNucleotides } from '$lib/model/io/oxdnaExport';
import { CadnanoJSON } from '$lib/model/io/cadnanoJSON';
import { exportStrandViewSvg } from '$lib/components/Editor/StrandView/exportSvg';
import type { LatticedDesignRegion } from '$lib/model/Part/DesignRegion';
import { addLatticeVh } from './testHelpers';
import { StorageManager } from '$lib/services/storage/StorageManager';
import type { StorageProvider } from '$lib/services/storage/StorageProvider';

class MockStorageProvider implements StorageProvider {
	async saveDocument(): Promise<boolean> {
		return true;
	}
	async loadDocument(): Promise<object | null> {
		return null;
	}
	async deleteDocument(): Promise<boolean> {
		return true;
	}
	async getDocumentList(): Promise<[]> {
		return [];
	}
	async saveContext(): Promise<boolean> {
		return true;
	}
	async loadContext(): Promise<object | null> {
		return null;
	}
	getProviderInfo() {
		return { name: 'Mock', type: 'memory' as const, description: 'Mock storage provider' };
	}
	async isAvailable(): Promise<boolean> {
		return true;
	}
}

/** A freeform document with one VH and a HistoryStack. `part()` re-reads the live part,
 * since undo/redo replace the Part instance. */
function setup() {
	const doc = new FoldnanoDocument();
	doc.addNewPart('FREEFORM');
	const storage = new StorageManager('memory');
	storage.registerProvider('memory', new MockStorageProvider());
	const history = new HistoryStack(doc, storage);
	const part = () => doc.parts[0];
	const region = part().getDefaultRegion() as FreeformRegion;
	const vh = region.addVhAt(part(), [0, 0, 0], [0, 0, 1]);
	return { doc, history, part, vh };
}

const onlySegment = (oligo: Oligo): OligoSegment => [...oligo.segments][0];
const mirrorsOf = (part: Part) => [...part.oligos].filter((o) => o.isMirror);
const originalsOf = (part: Part) => [...part.oligos].filter((o) => o.repeatGroupId);
const range = (oligo: Oligo) => {
	const seg = onlySegment(oligo);
	return [seg.fivePrime.index, seg.threePrime.index];
};

describe('repeat groups: mirror oligos', () => {
	it('creates tagged mirrors that match their source, and undo removes them', () => {
		const { history, part, vh } = setup();
		const src = part().createOligo(vh, 0, 9);
		onlySegment(src).sequence = 'ACGTACGTAC';

		createRepeatGroupCmd({ part: part(), oligos: [src], bpOffset: 21 }, history);

		const [mirror] = mirrorsOf(part());
		expect(mirror.mirrorOf?.sourceOligoId).toBe(src.id);
		expect(range(mirror)).toEqual([21, 30]);
		expect(onlySegment(mirror).sequence).toBe('ACGTACGTAC');
		expect(part().realOligos).toHaveLength(1);

		history.undoOnce();
		expect(mirrorsOf(part())).toHaveLength(0);
		expect(part().repeatGroups).toHaveLength(0);
		expect(originalsOf(part())).toHaveLength(0);
	});

	it('rebuilds only the mirrors of an edited original, in one undo step', () => {
		const { history, part, vh } = setup();
		const a = part().createOligo(vh, 0, 5);
		const b = part().createOligo(vh, 8, 12);
		createRepeatGroupCmd({ part: part(), oligos: [a, b], bpOffset: 21 }, history);
		const mirrorOfB = mirrorsOf(part()).find((m) => m.mirrorOf?.sourceOligoId === b.id)!;

		moveOligoEndCmd({ part: part(), end: onlySegment(a).threePrime, toIdx: 6 }, history);

		const mirrors = mirrorsOf(part());
		const mirrorOfA = mirrors.find((m) => m.mirrorOf?.sourceOligoId === a.id)!;
		expect(range(mirrorOfA)).toEqual([21, 27]);
		expect(mirrors).toContain(mirrorOfB);

		history.undoOnce();
		const restored = mirrorsOf(part()).find((m) => m.mirrorOf?.sourceOligoId === a.id)!;
		expect(range(restored)).toEqual([21, 26]);
	});

	it('follows sequence changes on the original', () => {
		const { history, part, vh } = setup();
		const src = part().createOligo(vh, 0, 3);
		createRepeatGroupCmd({ part: part(), oligos: [src], bpOffset: 21 }, history);

		fillSequenceToOligoCmd({ oligo: src, sequence: 'GATC' }, history);

		expect(onlySegment(mirrorsOf(part())[0]).sequence).toBe('GATC');
	});

	it('rejects an edit whose mirror would collide, leaving the document unchanged', () => {
		const { history, part, vh } = setup();
		const src = part().createOligo(vh, 0, 9);
		part().createOligo(vh, 32, 35);
		createRepeatGroupCmd({ part: part(), oligos: [src], bpOffset: 21 }, history);

		expect(() =>
			moveOligoEndCmd({ part: part(), end: onlySegment(src).threePrime, toIdx: 12 }, history)
		).toThrow(/Copy 1 of Repeat 1: .*overlap/);
		const live = part().getOligoById(src.id)!;
		expect(range(live)).toEqual([0, 9]);
		expect(range(mirrorsOf(part())[0])).toEqual([21, 30]);
	});

	it('rejects direct edits to a mirror', () => {
		const { history, part, vh } = setup();
		const src = part().createOligo(vh, 0, 9);
		createRepeatGroupCmd({ part: part(), oligos: [src], bpOffset: 21 }, history);
		const mirror = () => mirrorsOf(part())[0];

		expect(() =>
			moveOligoEndCmd({ part: part(), end: onlySegment(mirror()).threePrime, toIdx: 32 }, history)
		).toThrow(/Mirror oligos can't be edited/);
		expect(() =>
			breakOligoCmd(
				{ part: part(), oligo: mirror(), segment: onlySegment(mirror()), atIndex: 25 },
				history
			)
		).toThrow(/Mirror oligos can't be edited/);
		expect(() => removeOligoCmd({ part: part(), oligo: mirror() }, history)).toThrow(
			/Mirror oligos can't be edited/
		);
		expect(range(mirror())).toEqual([21, 30]);
	});

	it("reverts sequence written into a mirror, and never changes the original's", () => {
		const { history, part, vh } = setup();
		const src = part().createOligo(vh, 0, 3);
		createRepeatGroupCmd({ part: part(), oligos: [src], bpOffset: 21 }, history);
		const partner = part().createOligo(vh, 24, 21);

		fillSequenceToOligoCmd({ oligo: partner, sequence: 'AAAA' }, history);

		const mirror = mirrorsOf(part())[0];
		expect(oligoFingerprint(mirror, 21)).toBe(oligoFingerprint(part().getOligoById(src.id)!));
		expect(onlySegment(part().getOligoById(src.id)!).sequence).toBe('NNNN');
		expect(onlySegment(part().getOligoById(partner.id)!).sequence).toBe('AAAA');
	});

	it('keeps both halves of a broken original in the group', () => {
		const { history, part, vh } = setup();
		const src = part().createOligo(vh, 0, 9);
		createRepeatGroupCmd({ part: part(), oligos: [src], bpOffset: 21 }, history);

		breakOligoCmd({ part: part(), oligo: src, segment: onlySegment(src), atIndex: 4 }, history);

		expect(originalsOf(part())).toHaveLength(2);
		const ranges = mirrorsOf(part())
			.map(range)
			.sort((x, y) => x[0] - y[0]);
		expect(ranges).toEqual([
			[21, 25],
			[26, 30],
		]);
	});

	it('carries a skip added to a duplex original', () => {
		const { history, part, vh } = setup();
		const top = part().createOligo(vh, 0, 9);
		const bottom = part().createOligo(vh, 9, 0);
		createRepeatGroupCmd({ part: part(), oligos: [top, bottom], bpOffset: 21 }, history);

		addSkipOrInsertionCmd({ segment: onlySegment(top), atIndex: 5, count: -1 }, history);

		for (const mirror of mirrorsOf(part())) expect(onlySegment(mirror).slotSeq(26)).toBe('');
	});

	it('edits one strand of a duplex original with a skip', () => {
		const { history, part, vh } = setup();
		const top = part().createOligo(vh, 0, 9);
		const bottom = part().createOligo(vh, 9, 0);
		createRepeatGroupCmd({ part: part(), oligos: [top, bottom], bpOffset: 21 }, history);
		addSkipOrInsertionCmd({ segment: onlySegment(top), atIndex: 5, count: -1 }, history);
		const mirrorOfBottom = mirrorsOf(part()).find((m) => m.mirrorOf?.sourceOligoId === bottom.id)!;

		// Only top's copy is rebuilt; bottom's kept copy already holds the paired skip.
		paintOligoCmd({ oligo: top, color: '#123456' }, history);
		moveOligoEndCmd({ part: part(), end: onlySegment(top).threePrime, toIdx: 10 }, history);

		const mirrorOfTop = mirrorsOf(part()).find((m) => m.mirrorOf?.sourceOligoId === top.id)!;
		expect(mirrorOfTop.color).toBe('#123456');
		expect(range(mirrorOfTop)).toEqual([21, 31]);
		expect(mirrorsOf(part())).toContain(mirrorOfBottom);
		for (const mirror of mirrorsOf(part())) expect(onlySegment(mirror).slotSeq(26)).toBe('');
	});

	it('removes the mirrors of a deleted original', () => {
		const { history, part, vh } = setup();
		const a = part().createOligo(vh, 0, 5);
		const b = part().createOligo(vh, 8, 12);
		createRepeatGroupCmd({ part: part(), oligos: [a, b], bpOffset: 21 }, history);

		removeOligoCmd({ part: part(), oligo: a }, history);

		expect(mirrorsOf(part()).map((m) => m.mirrorOf?.sourceOligoId)).toEqual([b.id]);
	});

	it('adds and removes instances, detaches, and deletes groups', () => {
		const { history, part, vh } = setup();
		const src = part().createOligo(vh, 0, 9);
		const group = createRepeatGroupCmd({ part: part(), oligos: [src], bpOffset: 21 }, history);

		addRepeatInstanceCmd({ part: part(), groupId: group.id, bpOffset: 42 }, history);
		expect(mirrorsOf(part()).map(range)).toContainEqual([42, 51]);
		expect(part().getDefaultRegion().maxBase).toBe(63);

		const first = part().getRepeatGroup(group.id)!.instances[0];
		removeRepeatInstanceCmd({ part: part(), groupId: group.id, instanceId: first.id }, history);
		expect(mirrorsOf(part()).map(range)).toEqual([[42, 51]]);

		detachRepeatGroupCmd({ part: part(), groupId: group.id }, history);
		expect(part().repeatGroups).toHaveLength(0);
		expect(mirrorsOf(part())).toHaveLength(0);
		expect(part().oligos.size).toBe(2);

		history.undoOnce();
		deleteRepeatGroupCmd({ part: part(), groupId: group.id }, history);
		expect(part().oligos.size).toBe(1);
		expect(originalsOf(part())).toHaveLength(0);
	});

	it('rejects mirroring a mirror or oligos already in a group', () => {
		const { history, part, vh } = setup();
		const src = part().createOligo(vh, 0, 9);
		createRepeatGroupCmd({ part: part(), oligos: [src], bpOffset: 21 }, history);

		expect(() =>
			createRepeatGroupCmd({ part: part(), oligos: [mirrorsOf(part())[0]], bpOffset: 42 }, history)
		).toThrow(/original oligos/);
		expect(() =>
			createRepeatGroupCmd(
				{ part: part(), oligos: [part().getOligoById(src.id)!], bpOffset: 42 },
				history
			)
		).toThrow(/already belong/);
	});

	it('round-trips groups and mirror tags through JSON', () => {
		const { history, part, vh } = setup();
		const src = part().createOligo(vh, 0, 9);
		createRepeatGroupCmd({ part: part(), oligos: [src], bpOffset: 21 }, history);

		const loaded = Part.fromJSON(JSON.parse(JSON.stringify(part().toJSON())));

		expect(loaded.repeatGroups).toEqual(part().repeatGroups);
		expect(mirrorsOf(loaded)[0].mirrorOf).toEqual(mirrorsOf(part())[0].mirrorOf);
		expect(loaded.getOligoById(src.id)!.repeatGroupId).toBe(part().repeatGroups[0].id);
	});

	it('does not add repeat fields to parts without groups', () => {
		const { part, vh } = setup();
		part().createOligo(vh, 0, 9);
		const json = part().toJSON();
		expect(json.repeatGroups).toBeUndefined();
		expect('repeatGroupId' in json.oligos[0]).toBe(false);
		expect('mirrorOf' in json.oligos[0]).toBe(false);
	});

	it('mirrors the 10hb tube and rejects an edit that makes a copy overlap', () => {
		const json = JSON.parse(
			readFileSync(join(process.cwd(), 'test_files/fn_designs/10hb_tube.fn.json'), 'utf-8')
		);
		const doc = new FoldnanoDocument();
		doc.parts = [Part.fromJSON(json.parts[0])];
		const storage = new StorageManager('memory');
		storage.registerProvider('memory', new MockStorageProvider());
		const history = new HistoryStack(doc, storage);
		const part = () => doc.parts[0];

		createRepeatGroupCmd({ part: part(), oligos: [...part().oligos], bpOffset: 20 }, history);
		expect(mirrorsOf(part())).toHaveLength(10);

		// VH0's top strand runs 16–35 and its copy 36–55: growing the original's free end by
		// 1 bp shifts the copy onto the original's other end.
		const vh0Top = [...part().oligos]
			.filter((o) => !o.isMirror)
			.flatMap((o) => [...o.segments])
			.find((s) => s.inVirtualHelix.index === 0 && s.inStrandIndex === 0)!;
		const end = vh0Top.fivePrime.isFree ? vh0Top.fivePrime : vh0Top.threePrime;
		const outward = end.index === vh0Top.lowIndex ? end.index - 1 : end.index + 1;
		expect(() => moveOligoEndCmd({ part: part(), end, toIdx: outward }, history)).toThrow(
			/overlap/
		);
		expect(mirrorsOf(part())).toHaveLength(10);
	});

	describe('exports', () => {
		it('leave mirrors out of the oligo report, CSV and oxDNA unless asked', () => {
			const { history, part, vh } = setup();
			const src = part().createOligo(vh, 0, 9);
			createRepeatGroupCmd({ part: part(), oligos: [src], bpOffset: 21 }, history);

			expect(collectPartOligoReportRows(part())).toHaveLength(1);
			expect(collectPartOligoSequences(part())).toHaveLength(1);
			expect(collectOxDnaNucleotides(part())).toHaveLength(10);
			expect(collectOxDnaNucleotides(part(), undefined, 'T', true)).toHaveLength(20);
		});

		it('fade mirrors in the strand-view SVG with a group opacity', () => {
			const { history, part, vh } = setup();
			const src = part().createOligo(vh, 0, 9);
			createRepeatGroupCmd({ part: part(), oligos: [src], bpOffset: 21 }, history);

			const svg = exportStrandViewSvg(part());
			const groups = svg.match(/<g class="mirror-oligo" opacity="0\.4">/g) ?? [];
			expect(groups).toHaveLength(2); // strands + crossovers passes
			expect(svg.match(/<g\b/g)?.length).toBe(svg.match(/<\/g>/g)?.length);
		});

		it('leave mirrors out of the cadnano export', () => {
			const doc = new FoldnanoDocument();
			const part = doc.addNewPart('HONEYCOMB');
			const storage = new StorageManager('memory');
			storage.registerProvider('memory', new MockStorageProvider());
			const history = new HistoryStack(doc, storage);
			const vh = addLatticeVh(part, 0, 0);
			const src = part.createOligo(vh, 0, 9);
			createRepeatGroupCmd({ part, oligos: [src], bpOffset: 21 }, history);

			const { json } = CadnanoJSON.fromRegion(
				part.getDefaultRegion() as LatticedDesignRegion,
				part
			);
			const strand = json.vstrands[0];
			const occupied = (arr: number[][]) =>
				arr.flatMap((nt, bp) => (nt.some((v) => v !== -1) ? [bp] : []));
			expect([...occupied(strand.scaf), ...occupied(strand.stap)]).toEqual(
				Array.from({ length: 10 }, (_, i) => i)
			);
		});
	});
});
