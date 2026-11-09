import { afterEach, describe, expect, it, vi } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import { createTestHistory } from '$lib/commands/test/undoRoundTrip';
import { addLatticeVh } from '$lib/model/test/testHelpers';
import { notify } from '$lib/notifications/notify.svelte';
import { CIRCULAR_FILL_ERROR } from '$lib/model/Oligo/Oligo.svelte';
import { InvalidOperationError } from '$lib/errors';
import { SequenceTool } from './sequence';
import type { PointerEvt } from './index';
import type { ViewContext } from '$lib/canvasEditor/core/views';

type Mode = 'RANDOM' | 'SEQ' | 'REMOVE';

/** A ring over two helices: 4 bases each, 8 in all. */
function ringScene() {
	const doc = new FoldnanoDocument('doc', 'circular-fill');
	const part = doc.addNewPart('HONEYCOMB');
	const vh0 = addLatticeVh(part, 0, 0);
	const vh1 = addLatticeVh(part, 0, 1);
	const ring = part.createOligo(vh0, 0, 3, '#ff0000');
	const other = part.createOligo(vh1, 3, 0, '#00ff00');
	const [a] = [...ring.segments];
	const [b] = [...other.segments];
	part.connectSegmentEnds(a, b);
	part.connectSegmentEnds(b, a);
	expect(ring.isCircular).toBe(true);
	return { part, ring, segment: a, history: createTestHistory(doc) };
}

function click(mode: Mode, filters: string[], fillType = 'ALL', sequence = 'ACGTACGT') {
	const scene = ringScene();
	const ctx = {
		part: scene.part,
		history: scene.history,
		camera: { toWorld: () => ({ x: 0, y: 0 }) },
		hit: { hitAt: () => [{ kind: 'SEGMENT', id: scene.segment.id }] },
		strandCtx: {
			selectionFilter: new Set(['SCAF', 'STAP', ...filters]),
			selected: { ends: new Set() },
			sequenceContext: { mode, fillType, sequence, gcContent: 0.5, fillResults: [] },
			recentFill: null,
		},
	} as unknown as ViewContext;
	const evt = { type: 'down', button: 0, clientX: 0, clientY: 0 } as unknown as PointerEvt;
	SequenceTool().onPointer?.(evt, ctx);
	return scene;
}

describe('SequenceTool on a circular oligo', () => {
	afterEach(() => vi.restoreAllMocks());

	it.each<[Mode, string]>([
		['RANDOM', 'ALL'],
		['SEQ', 'ALL'],
		['SEQ', 'ONLY_EMPTY'],
	])('refuses a whole-oligo %s fill (%s) with a warning, not an error', (mode, fillType) => {
		const warn = vi.spyOn(notify, 'warning').mockImplementation(() => '');
		const { ring, history } = click(mode, ['OLIGO'], fillType);
		expect(warn).toHaveBeenCalledWith(CIRCULAR_FILL_ERROR);
		expect(ring.sequence).toBe('');
		expect(ring.segments.values().next().value!.sequence).toBe('NNNN');
		expect(history.numberOfUndos).toBe(0);
	});

	it('still fills one segment of the ring', () => {
		const warn = vi.spyOn(notify, 'warning').mockImplementation(() => '');
		const { segment } = click('SEQ', ['SEGMENT'], 'ALL', 'GGGG');
		expect(warn).not.toHaveBeenCalled();
		expect(segment.sequence).toBe('GGGG');
	});

	it('still fills only the empty bases of the whole ring at random', () => {
		const warn = vi.spyOn(notify, 'warning').mockImplementation(() => '');
		const { ring } = click('RANDOM', ['OLIGO'], 'ONLY_EMPTY');
		expect(warn).not.toHaveBeenCalled();
		for (const seg of ring.segments) expect(seg.sequence).toMatch(/^[ACGT]{4}$/);
	});
});

describe('Oligo.fillRandomSequence on a ring', () => {
	it('throws a refusal, not a bug', () => {
		const { ring } = ringScene();
		expect(() => ring.fillRandomSequence()).toThrow(InvalidOperationError);
	});
});
