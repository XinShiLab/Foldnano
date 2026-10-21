// Host side of the Python → host replay golden written by
// python/tests/test_foldnano_mini_replay_host.py: a foldnano_mini script's mutation log must
// replay on the real Part and land where the Python mirror did, ids included.

import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

import { Part } from '$lib/model/Part';
import { dispatchOp, type MutationOp } from './opDispatch';

const GOLDEN_PATH = path.resolve(
	__dirname,
	'python/tests/fixtures/foldnano_mini_replay.golden.json'
);

type PartJson = ReturnType<Part['toJSON']>;
type SegmentJson = PartJson['oligos'][number]['segments'][number];

function slotKind(seq: string): 'skip' | 'insertion' | null {
	if (seq.length === 0) return 'skip';
	return seq.length > 1 ? 'insertion' : null;
}

/** Mirrors `summary()` in the Python test. */
function summary(json: PartJson) {
	const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
	const segment = (s: SegmentJson) => [
		s.id,
		s.inVirtualHelixIndex,
		s.fivePrime.index,
		s.threePrime.index,
		s.fivePrime.connectedSegmentId,
		s.threePrime.connectedSegmentId,
		s.fivePrime.modification,
		s.threePrime.modification,
		s.slots
			.filter((slot) => slotKind(slot.seq) !== null)
			.map((slot) => [slot.bpIndex, slotKind(slot.seq), slot.seq.length])
			.sort((a, b) => Number(a[0]) - Number(b[0])),
	];
	return {
		oligos: [...json.oligos]
			.sort(byId)
			.map((o) => [o.id, o.color, o.isScaffold, [...o.segments].sort(byId).map(segment)]),
		vhs: json.virtualHelices.map((vh) => [vh.index, vh.length]).sort((a, b) => a[0] - b[0]),
		regions: json.regions
			.map((r) => [r.id, r.maxBase])
			.sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
	};
}

describe('foldnano_mini replay golden', () => {
	it('replays the Python log to the state the mirror predicted', () => {
		const { part: json, log, expected } = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8'));
		const part = Part.fromJSON(json);
		(log as MutationOp[]).forEach((op, i) => {
			try {
				dispatchOp(op, part);
			} catch (e) {
				throw new Error(`op ${i} (${op.op}) failed: ${(e as Error).message}`);
			}
		});
		expect(summary(part.toJSON())).toEqual(expected);
	});
});
