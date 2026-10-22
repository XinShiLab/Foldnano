// Host side of the repeat-group replay golden written by
// python/tests/test_foldnano_mini_repeat.py: a foldnano_mini script that creates and edits
// repeat groups writes a log; replaying it here must leave the same originals, the same
// mirrors (keyed by source and instance, since each side gives them fresh ids) and groups.

import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

import { Part } from '$lib/model/Part';
import { syncRepeatGroups } from '$lib/model/Part/repeatGroups';
import { replayMutationLog, type MutationOp } from './opDispatch';

const GOLDEN_PATH = path.resolve(
	__dirname,
	'python/tests/fixtures/foldnano_mini_repeat_replay.golden.json'
);

type PartJson = ReturnType<Part['toJSON']>;
type OligoJson = PartJson['oligos'][number];

function slotKind(seq: string): 'skip' | 'insertion' | null {
	if (seq.length === 0) return 'skip';
	return seq.length > 1 ? 'insertion' : null;
}

const byTuple = (a: unknown[], b: unknown[]) => {
	for (let i = 0; i < Math.min(a.length, b.length); i++) {
		const [x, y] = [a[i], b[i]];
		if (x === y || typeof x === 'object') continue;
		return (x as number | string) < (y as number | string) ? -1 : 1;
	}
	return 0;
};

/** Mirrors `summary()` in the Python test. */
function summary(json: PartJson) {
	const segments = (o: OligoJson) =>
		o.segments
			.map((s) => [
				s.inVirtualHelixIndex,
				s.fivePrime.index,
				s.threePrime.index,
				s.fivePrime.modification ?? null,
				s.threePrime.modification ?? null,
				s.slots
					.filter((slot) => slotKind(slot.seq) !== null)
					.map((slot) => [slot.bpIndex, slotKind(slot.seq)])
					.sort(byTuple),
			])
			.sort(byTuple);
	return {
		real: json.oligos
			.filter((o) => !o.mirrorOf)
			.map((o) => [o.id, o.color, o.repeatGroupId ?? null, segments(o)])
			.sort(byTuple),
		mirrors: json.oligos
			.filter((o) => o.mirrorOf)
			.map((o) => [o.mirrorOf!.sourceOligoId, o.mirrorOf!.instanceId, o.color, segments(o)])
			.sort(byTuple),
		groups: (json.repeatGroups ?? [])
			.map((g) => [g.id, g.name, g.instances.map((i) => [i.id, i.bpOffset])])
			.sort(byTuple),
		vhs: json.virtualHelices.map((vh) => [vh.index, vh.length]).sort(byTuple),
		regions: json.regions.map((r) => [r.id, r.maxBase]).sort(byTuple),
	};
}

describe('foldnano_mini repeat-group replay golden', () => {
	it('replays the Python log to the groups and mirrors the Python side built', () => {
		const { part: json, log, expected } = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8'));
		const part = Part.fromJSON(json);
		replayMutationLog(part, log as MutationOp[]);
		// The end-of-transaction sync ResultApplicator's snapshotTx runs.
		syncRepeatGroups(part);
		expect(summary(part.toJSON())).toEqual(expected);
	});
});
