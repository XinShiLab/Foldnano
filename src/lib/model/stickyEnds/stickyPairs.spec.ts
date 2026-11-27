import { describe, expect, it } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import { Part } from '$lib/model/Part';
import { addLatticeVh } from '$lib/model/test/testHelpers';
import { createTestHistory } from '$lib/commands/test/undoRoundTrip';
import {
	removeStickyRecordCmd,
	saveStickyMatchCmd,
	stickyMatchBlocker,
} from '$lib/commands/stickyEnds';
import { remapPartIds } from '$lib/model/Part/remapPartIds';
import { InvalidOperationError } from '$lib/errors';
import { collectDesignIssues } from '$lib/model/checks/collect';
import { findStickyMatches, singleStrandedRuns } from './stickyEnds';
import {
	anchorAt,
	recordCovers,
	resolveAnchor,
	resolveRecord,
	stickyPairStatus,
} from './stickyPairs';

let nextCol = 0;
function strand(p: Part, sequence: string) {
	const vh = addLatticeVh(p, nextCol++, 0);
	const oligo = p.createOligo(vh, 0, sequence.length - 1);
	[...oligo.segments][0].sequence = sequence;
	return oligo;
}

function onePart() {
	const doc = new FoldnanoDocument(undefined, 'Pairs');
	const part = doc.addNewPart('HONEYCOMB');
	const arm = strand(part, 'TTTGATTACAGGC');
	const socket = strand(part, 'GCCTGTAATCAAA');
	const history = createTestHistory(doc);
	const [match] = findStickyMatches(singleStrandedRuns(part), 7);
	return { doc, part, arm, socket, history, match };
}

const statusOf = (doc: FoldnanoDocument, home: Part | null, i = 0) => {
	const records = home ? home.stickyRecords : doc.assembly.stickyRecords;
	return stickyPairStatus(resolveRecord(doc.parts, home, records.pairs[i]));
};

describe('anchors', () => {
	it('count from the nearer end and resolve back to the same bases', () => {
		const { part, arm } = onePart();
		const near5 = anchorAt(part, arm.id, 2, 4, false)!;
		const near3 = anchorAt(part, arm.id, 8, 4, false)!;
		expect(near5).toEqual({ oligoId: arm.id, from: '5p', offset: 2 });
		expect(near3).toEqual({ oligoId: arm.id, from: '3p', offset: 1 });
		expect(resolveAnchor(part, near3, 4)!.start).toBe(8);
		expect(resolveAnchor(part, near3, 40)).toBeNull();
	});
});

describe('pairing within one Part', () => {
	it('saves the pair on the Part, undoably', () => {
		const { doc, part, history, match } = onePart();
		const record = saveStickyMatchCmd(history, doc, match, 'pairs')!;
		expect(part.stickyRecords.pairs).toEqual([record]);
		expect(record.a.partId).toBeUndefined();
		expect(doc.assembly.stickyRecords.pairs).toEqual([]);
		expect(statusOf(doc, part)).toBe('matching');
		expect(recordCovers(resolveRecord(doc.parts, part, record), match)).toBe(true);

		history.undoOnce();
		expect(part.stickyRecords.pairs).toEqual([]);
		history.redoOnce();
		expect(part.stickyRecords.pairs).toEqual([record]);
		removeStickyRecordCmd(history, doc, { kind: 'part', partId: part.id }, 'pairs', record.id);
		expect(part.stickyRecords.pairs).toEqual([]);
		history.undoOnce();
		expect(part.stickyRecords.pairs).toEqual([record]);
	});

	it('round-trips through JSON, and leaves both lists out when empty', () => {
		const { doc, part, history, match } = onePart();
		expect(JSON.stringify(part.toJSON())).not.toContain('stickyPairs');
		expect(JSON.stringify(part.toJSON())).not.toContain('ignoredMatches');
		saveStickyMatchCmd(history, doc, match, 'ignored');
		const copy = Part.fromJSON(JSON.parse(JSON.stringify(part.toJSON())));
		expect(copy.stickyRecords.ignored).toEqual(part.stickyRecords.ignored);
		expect(copy.stickyRecords.pairs).toEqual([]);
	});

	it('drops a malformed saved record instead of failing to load', () => {
		const { part } = onePart();
		const json = { ...part.toJSON(), stickyPairs: [{ id: 'x', a: {}, b: {}, length: 0 }] };
		expect(Part.fromJSON(json as never).stickyRecords.pairs).toEqual([]);
	});

	it('reports partial, broken, missing and unassigned pairs', () => {
		const { doc, part, arm, socket, history, match } = onePart();
		saveStickyMatchCmd(history, doc, match, 'pairs');
		const armSegment = [...arm.segments][0];
		armSegment.sequence = 'TTTGATTACAGGG';
		expect(statusOf(doc, part)).toBe('partial');
		armSegment.sequence = 'TTTCCCCCCCCCC';
		expect(statusOf(doc, part)).toBe('broken');
		armSegment.sequence = 'TTTGATTACANNN';
		expect(statusOf(doc, part)).toBe('noSequence');
		part.removeOligo(socket);
		expect(statusOf(doc, part)).toBe('missing');
	});

	it('rewrites anchors when a Part is copied with new ids', () => {
		const { doc, part, arm, history, match } = onePart();
		saveStickyMatchCmd(history, doc, match, 'pairs');
		const copy = remapPartIds(part.toJSON());
		const ids = [copy.stickyPairs![0].a.oligoId, copy.stickyPairs![0].b.oligoId];
		expect(ids).not.toContain(arm.id);
		expect(ids.every((id) => copy.oligos.some((o) => o.id === id))).toBe(true);
	});

	it('refuses to pair or unpair the ends of a linked Part', () => {
		const { doc, part, history, match } = onePart();
		const record = saveStickyMatchCmd(history, doc, match, 'pairs')!;
		part.source = { partId: 'src', contentHash: 'h', linkedAt: '' };
		expect(stickyMatchBlocker(doc, match)).toMatch(/linked/);
		expect(saveStickyMatchCmd(history, doc, match, 'ignored')).toBeNull();
		expect(() =>
			removeStickyRecordCmd(history, doc, { kind: 'part', partId: part.id }, 'pairs', record.id)
		).toThrow(InvalidOperationError);
		expect(part.stickyRecords.pairs).toHaveLength(1);
	});
});

describe('pairing across Parts', () => {
	function twoParts() {
		const doc = new FoldnanoDocument(undefined, 'Assembly');
		const arm = doc.addNewPart('HONEYCOMB');
		const base = doc.addNewPart('HONEYCOMB');
		strand(arm, 'GATTACAGGC');
		strand(base, 'GCCTGTAATC');
		const history = createTestHistory(doc);
		const [match] = findStickyMatches([...singleStrandedRuns(arm), ...singleStrandedRuns(base)], 7);
		return { doc, arm, base, history, match };
	}

	it('saves the pair in the assembly, with each side naming its Part', () => {
		const { doc, arm, base, history, match } = twoParts();
		const record = saveStickyMatchCmd(history, doc, match, 'pairs')!;
		expect(doc.assembly.stickyRecords.pairs).toEqual([record]);
		expect(new Set([record.a.partId, record.b.partId])).toEqual(new Set([arm.id, base.id]));
		expect(statusOf(doc, null)).toBe('matching');
		expect(doc.assembly.toJSON().stickyPairs).toHaveLength(1);
	});

	it('is allowed when both Parts are linked, and goes when a Part is deleted', () => {
		const { doc, arm, base, history, match } = twoParts();
		for (const p of [arm, base]) p.source = { partId: 'src', contentHash: 'h', linkedAt: '' };
		expect(saveStickyMatchCmd(history, doc, match, 'pairs')).not.toBeNull();
		doc.removePart(base.id);
		expect(doc.assembly.stickyRecords.pairs).toEqual([]);
	});
});

describe('design checks of saved pairs', () => {
	const check = (doc: FoldnanoDocument, part: Part, stickyPairs = true) =>
		collectDesignIssues(
			part,
			null,
			{ integrity: false, simulation: false, cadnano: false, stickyPairs },
			null,
			doc
		).map((issue) => issue.rule);

	it('warn when a pair breaks or loses a side, and only for saved pairs', () => {
		const { doc, part, arm, socket, history, match } = onePart();
		[...arm.segments][0].sequence = 'TTTCCCCCCCCCC';
		expect(check(doc, part)).toEqual([]);
		[...arm.segments][0].sequence = 'TTTGATTACAGGC';
		saveStickyMatchCmd(history, doc, match, 'pairs');
		expect(check(doc, part)).toEqual([]);
		[...arm.segments][0].sequence = 'TTTCCCCCCCCCC';
		expect(check(doc, part)).toEqual(['sticky-pair-broken']);
		expect(check(doc, part, false)).toEqual([]);
		part.removeOligo(socket);
		expect(check(doc, part)).toEqual(['sticky-pair-missing']);
	});

	it('checks an assembly pair from each Part it joins', () => {
		const doc = new FoldnanoDocument(undefined, 'Assembly');
		const arm = doc.addNewPart('HONEYCOMB');
		const base = doc.addNewPart('HONEYCOMB');
		const armOligo = strand(arm, 'GATTACAGGC');
		strand(base, 'GCCTGTAATC');
		const history = createTestHistory(doc);
		const [match] = findStickyMatches([...singleStrandedRuns(arm), ...singleStrandedRuns(base)], 7);
		saveStickyMatchCmd(history, doc, match, 'pairs');
		[...armOligo.segments][0].sequence = 'CCCCCCCCCC';
		const [issue] = collectDesignIssues(
			base,
			null,
			{ integrity: false, simulation: false, cadnano: false },
			null,
			doc
		);
		expect(issue.rule).toBe('sticky-pair-broken');
		expect(issue.anchor?.vhId).toBe(base.virtualHelices[0].id);
		expect(check(doc, arm)).toEqual(['sticky-pair-broken']);
	});
});
