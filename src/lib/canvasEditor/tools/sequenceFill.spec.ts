import { describe, expect, it } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import { fillSequenceToOligoCmd } from '$lib/commands/strands';
import { createTestHistory } from '$lib/commands/test/undoRoundTrip';
import { addLatticeVh } from '$lib/model/test/testHelpers';
import { emptyFillTargets, fillEmptyAndHighlight, withFillHighlight } from './sequenceFill';

type StrandCtx = Parameters<typeof emptyFillTargets>[1];

function scene() {
	const doc = new FoldnanoDocument('doc', 'sequence-fill');
	const part = doc.addNewPart('HONEYCOMB');
	const vh = addLatticeVh(part, 0, 0);
	const history = createTestHistory(doc);
	const strandCtx = {
		selectionFilter: new Set(['SCAF', 'STAP', 'SEGMENT']),
		selected: { ends: new Set() },
		sequenceContext: { gcContent: 0.5, fillResults: [] },
		recentFill: null,
	} as unknown as StrandCtx;
	return { part, vh, history, strandCtx };
}

describe('emptyFillTargets', () => {
	it('drops the scaffold for staple-only fills even with SCAF on', () => {
		const { part, vh, strandCtx } = scene();
		const scaffold = part.createOligo(vh, 0, 9);
		scaffold.isScaffold = true;
		const staple = part.createOligo(vh, 9, 0);

		expect(emptyFillTargets(part, strandCtx)).toHaveLength(2);
		const staplesOnly = emptyFillTargets(part, strandCtx, { staplesOnly: true });
		expect(staplesOnly.map((segment) => segment.oligo)).toEqual([staple]);
	});
});

describe('fillEmptyAndHighlight with a base', () => {
	it('fills staples with the base and never writes an empty scaffold', () => {
		const { part, vh, history, strandCtx } = scene();
		const scaffold = part.createOligo(vh, 0, 9);
		scaffold.isScaffold = true;
		const staple = part.createOligo(vh, 9, 0);

		const targets = emptyFillTargets(part, strandCtx, { staplesOnly: true });
		fillEmptyAndHighlight(part, targets, strandCtx, history, 'T');

		expect(staple.sequence).toBe('T'.repeat(10));
		expect(scaffold.sequence).toBe('N'.repeat(10));
		expect(strandCtx.recentFill?.cells).toHaveLength(10);
		expect(strandCtx.recentFill?.revision).toBe(history.revision);
	});
});

describe('withFillHighlight', () => {
	it('highlights the filled strand and the complement it wrote opposite', () => {
		const { part, vh, history, strandCtx } = scene();
		const up = part.createOligo(vh, 0, 4);
		const down = part.createOligo(vh, 4, 0);

		withFillHighlight(part, strandCtx, history, () =>
			fillSequenceToOligoCmd({ oligo: up, sequence: 'ACGTA' }, history)
		);

		expect(down.sequence).toBe('TACGT');
		expect(strandCtx.recentFill?.cells).toHaveLength(10);
		expect(strandCtx.recentFill?.filled).toBe(10);
		expect(strandCtx.recentFill?.revision).toBe(history.revision);
	});

	it('skips bases a fill rewrote unchanged, and clears the highlight when nothing changed', () => {
		const { part, vh, history, strandCtx } = scene();
		const up = part.createOligo(vh, 0, 4);
		up.fillSequence('ACGTA');

		withFillHighlight(part, strandCtx, history, () =>
			fillSequenceToOligoCmd({ oligo: up, sequence: 'ACGTA' }, history)
		);

		expect(strandCtx.recentFill).toBeNull();
	});
});
