import { describe, expect, it } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import type Oligo from '$lib/model/Oligo';
import type OligoSegment from '$lib/model/Oligo/OligoSegment.svelte';
import type { Part } from '$lib/model/Part';
import { fillEmptySequenceCmd } from '$lib/commands/strands';
import { createTestHistory } from '$lib/commands/test/undoRoundTrip';
import { addRepeatInstanceCmd, createRepeatGroupCmd } from '$lib/commands/repeatGroups';
import type { FreeformRegion } from '$lib/model/Part/DesignRegion';
import { addLatticeVh } from './testHelpers';

const COMPLEMENT: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G' };

function scene() {
	const doc = new FoldnanoDocument('doc', 'fill-empty');
	const part = doc.addNewPart('HONEYCOMB');
	const vh = addLatticeVh(part, 0, 0);
	return { doc, part, vh };
}

const seg = (oligo: Oligo): OligoSegment => [...oligo.segments][0];
const seqAt = (segment: OligoSegment, bp: number) => segment.slotForBp(bp)!.seq;
const setSeq = (segment: OligoSegment, bp: number, seq: string) => {
	segment.slotForBp(bp)!.seq = seq;
};

function expectPaired(part: Part) {
	for (const oligo of part.oligos) {
		for (const segment of oligo.segments) expect(segment.mismatchedBps()).toEqual([]);
	}
}

describe('Part.fillEmptySequence', () => {
	it('fills only N bases and pairs them with an empty opposite strand', () => {
		const { part, vh } = scene();
		const up = part.createOligo(vh, 0, 9);
		const down = part.createOligo(vh, 9, 0);
		setSeq(seg(up), 3, 'G');

		const filled = part.fillEmptySequence(up.segments);

		expect(seqAt(seg(up), 3)).toBe('G');
		expect(seg(up).emptyNucleotideCount).toBe(0);
		// bp 3 was already G, so its opposite N is left alone (it is not a target).
		expect(seqAt(seg(down), 3)).toBe('N');
		for (let bp = 0; bp <= 9; bp++) {
			if (bp === 3) continue;
			expect(seqAt(seg(down), bp)).toBe(COMPLEMENT[seqAt(seg(up), bp)]);
		}
		expectPaired(part);
		expect(filled.filled).toBe(18);
		expect(filled.copied).toBe(0);
		expect(filled.cells).toHaveLength(18);
	});

	it('copies the complement of an already-sequenced opposite strand instead of overwriting it', () => {
		const { part, vh } = scene();
		const scaffold = part.createOligo(vh, 0, 9);
		scaffold.isScaffold = true;
		scaffold.fillSequence('ACGTACGTAC', true);
		const staple = part.createOligo(vh, 9, 0);

		const filled = part.fillEmptySequence(staple.segments);

		expect(scaffold.sequence).toBe('ACGTACGTAC');
		expect(scaffold.isSequenceLocked).toBe(true);
		expect(staple.sequence).toBe('GTACGTACGT');
		expect(filled.copied).toBe(10);
		expectPaired(part);
	});

	it('does not write random bases into a scaffold that is not a target', () => {
		const { part, vh } = scene();
		const scaffold = part.createOligo(vh, 0, 9);
		scaffold.isScaffold = true;
		const staple = part.createOligo(vh, 9, 0);

		part.fillEmptySequence(staple.segments);

		expect(staple.sequence).not.toContain('N');
		expect(scaffold.sequence).toBe('N'.repeat(10));
	});

	it('writes the scaffold when it is a target too', () => {
		const { part, vh } = scene();
		const scaffold = part.createOligo(vh, 0, 9);
		scaffold.isScaffold = true;
		const staple = part.createOligo(vh, 9, 0);

		part.fillEmptySequence([seg(staple), seg(scaffold)]);

		expect(scaffold.sequence).not.toContain('N');
		expectPaired(part);
	});

	it('fills circular oligos', () => {
		const { part } = scene();
		const vh1 = addLatticeVh(part, 2, 0);
		const vh0 = part.virtualHelices[0];
		const a = part.createOligo(vh0, 0, 3);
		const b = part.createOligo(vh1, 3, 0);
		seg(a).threePrime.connectTo(seg(b).fivePrime);
		a.addSegment(seg(b));
		part.oligos.delete(b);
		seg(b).threePrime.connectTo(seg(a).fivePrime);
		expect(a.isCircular).toBe(true);

		part.fillEmptySequence(a.segments);

		expect([...a.segments].map((segment) => segment.emptyNucleotideCount)).toEqual([0, 0]);
	});

	it('pairs insertion slots base by base in antiparallel order', () => {
		const { part, vh } = scene();
		const up = part.createOligo(vh, 0, 9);
		const down = part.createOligo(vh, 9, 0);
		seg(up).addSkipOrInsertion(4, 2);
		setSeq(seg(down), 4, 'ANN');

		part.fillEmptySequence(up.segments);

		const upSlot = seqAt(seg(up), 4);
		const downSlot = seqAt(seg(down), 4);
		expect(upSlot).toHaveLength(3);
		expect(downSlot[0]).toBe('A');
		expect(upSlot[2]).toBe('T');
		for (let i = 0; i < 3; i++) expect(downSlot[2 - i]).toBe(COMPLEMENT[upSlot[i]]);
	});

	it('returns nothing when there is no empty nucleotide', () => {
		const { part, vh } = scene();
		const up = part.createOligo(vh, 0, 4);
		up.fillSequence('ACGTA');
		expect(part.fillEmptySequence(up.segments).filled).toBe(0);
		expect(up.sequence).toBe('ACGTA');
	});
});

describe('fillEmptySequenceCmd', () => {
	it('undoes the fill on both strands in one step', () => {
		const { doc, part, vh } = scene();
		const up = part.createOligo(vh, 0, 9);
		const down = part.createOligo(vh, 9, 0);
		const history = createTestHistory(doc);

		fillEmptySequenceCmd({ part, segments: up.segments }, history);
		expect(down.sequence).not.toContain('N');

		history.undoOnce();
		expect(up.sequence).toBe('N'.repeat(10));
		expect(down.sequence).toBe('N'.repeat(10));
	});
});

describe('fillEmptySequenceCmd with linked mirror copies', () => {
	function linkedScene() {
		const doc = new FoldnanoDocument('doc', 'fill-empty-linked');
		const part = doc.addNewPart('FREEFORM');
		const region = part.getDefaultRegion() as FreeformRegion;
		const vh = region.addVhAt(part, [0, 0, 0], [0, 0, 1]);
		const history = createTestHistory(doc);
		return { doc, part, vh, history };
	}

	const expectNoMismatch = (part: Part) => {
		for (const oligo of part.oligos) {
			for (const segment of oligo.segments) expect(segment.mismatchedBps()).toEqual([]);
		}
	};

	it('pairs with a strand opposite a mirror copy, not just the original', () => {
		const { part, vh, history } = linkedScene();
		const original = part.createOligo(vh, 0, 3);
		const oppositeCopy = part.createOligo(vh, 24, 21);
		oppositeCopy.fillSequence('AAAA');
		createRepeatGroupCmd({ part, oligos: [original], bpOffset: 21 }, history);

		const result = fillEmptySequenceCmd(
			{ part, segments: original.segments, gcContent: 1 },
			history
		);

		expect(original.sequence).toBe('TTTT');
		expect(oppositeCopy.sequence).toBe('AAAA');
		expect(result.copied).toBe(4);
		expectNoMismatch(part);
	});

	it('leaves a base empty when its copies pair with conflicting bases', () => {
		const { part, vh, history } = linkedScene();
		const original = part.createOligo(vh, 0, 3);
		const opposite = part.createOligo(vh, 3, 0);
		opposite.fillSequence('CCCC');
		const oppositeCopy = part.createOligo(vh, 24, 21);
		oppositeCopy.fillSequence('AAAA');
		// The original's own complement fill already wrote GGGG; clear it to leave a gap.
		for (const slot of seg(original).slots) slot.seq = 'N';
		createRepeatGroupCmd({ part, oligos: [original], bpOffset: 21 }, history);

		const result = fillEmptySequenceCmd({ part, segments: original.segments }, history);

		expect(original.sequence).toBe('NNNN');
		expect(result.conflicts).toBe(4);
		expect(result.filled).toBe(0);
		expectNoMismatch(part);
	});

	it('does not write into the original behind a mirror opposite the target', () => {
		const { part, vh, history } = linkedScene();
		const source = part.createOligo(vh, 3, 0);
		createRepeatGroupCmd({ part, oligos: [source], bpOffset: 21 }, history);
		const target = part.createOligo(vh, 21, 24);

		fillEmptySequenceCmd({ part, segments: target.segments }, history);

		expect(target.sequence).not.toContain('N');
		expect(source.sequence).toBe('NNNN');
		expectNoMismatch(part);
	});
});

describe('mismatches between a mirror and a real strand', () => {
	it('are reported on both sides, so the mismatch markers draw them', () => {
		const doc = new FoldnanoDocument('doc', 'mirror-mismatch');
		const part = doc.addNewPart('FREEFORM');
		const region = part.getDefaultRegion() as FreeformRegion;
		const vh = region.addVhAt(part, [0, 0, 0], [0, 0, 1]);
		const history = createTestHistory(doc);
		const original = part.createOligo(vh, 0, 3);
		original.fillSequence('AAAA');
		const real = part.createOligo(vh, 24, 21);
		real.fillSequence('CCCC');
		createRepeatGroupCmd({ part, oligos: [original], bpOffset: 21 }, history);

		const mirror = [...part.oligos].find((oligo) => oligo.isMirror)!;
		expect(seg(mirror).mismatchedBps()).toEqual([21, 22, 23, 24]);
		expect(seg(real).mismatchedBps()).toEqual([24, 23, 22, 21]);
	});

	it('are reported between two mirrors once a later copy lands opposite an earlier one', () => {
		const doc = new FoldnanoDocument('doc', 'mirror-mirror');
		const part = doc.addNewPart('FREEFORM');
		const region = part.getDefaultRegion() as FreeformRegion;
		const vh = region.addVhAt(part, [0, 0, 0], [0, 0, 1]);
		const history = createTestHistory(doc);
		const top = part.createOligo(vh, 7, 20);
		const bottom = part.createOligo(vh, 13, 0);
		top.fillSequence('ATCGCGGCTACATT');
		bottom.fillSequence('CCGCGATAATGTAG');
		const group = createRepeatGroupCmd({ part, oligos: [top, bottom], bpOffset: 14 }, history);
		const topCopy = [...part.oligos].find((o) => o.mirrorOf?.sourceOligoId === top.id)!;
		expect(seg(topCopy).mismatchedBps()).toEqual([]);

		addRepeatInstanceCmd({ part, groupId: group.id, bpOffset: 32 }, history);

		// The +14 top copy is unchanged; only the new +32 bottom copy now sits opposite it.
		expect(seg(topCopy).mismatchedBps()).toEqual([32, 34]);
	});
});
