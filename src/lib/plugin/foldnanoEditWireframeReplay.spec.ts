// Host side of the wireframe replay golden written by
// python/tests/test_foldnano_edit_wireframe.py: an octahedron with edges of two lengths, built with
// foldnano.edit, must replay on the real Part, land where the Python mirror did and pass the checks.

import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

import { checkPartIntegrity } from '$lib/model/checks/integrity';
import { checkFoldnanoPartJsonShape } from '$lib/model/checks/shape/foldnanoJsonShape';
import { checkSimulationProfile } from '$lib/model/checks/simulation';
import { exportPartToOxDna } from '$lib/model/io/oxdnaExport';
import { Part } from '$lib/model/Part';
import { WireframeRegion } from '$lib/model/Part/DesignRegion';
import { dispatchOp, type MutationOp } from './opDispatch';

const GOLDEN_PATH = path.resolve(
	__dirname,
	'python/tests/fixtures/foldnano_edit_wireframe.golden.json'
);

type PartJson = ReturnType<Part['toJSON']>;

function byTuple(a: unknown[], b: unknown[]): number {
	const [x, y] = [String(a[0]), String(b[0])];
	if (x !== y) return typeof a[0] === 'number' ? Number(a[0]) - Number(b[0]) : x < y ? -1 : 1;
	return a.length > 1 ? byTuple(a.slice(1), b.slice(1)) : 0;
}

const round = (v: number) => Number(v.toFixed(6)) + 0;

/** Mirrors `summary()` in the Python test. */
function summary(json: PartJson) {
	return {
		regions: json.regions
			.map((r) => [r.id, r.kind, r.maxBase, r.vhOrder, r.referenceGeometry ?? null])
			.sort(byTuple),
		vhs: json.virtualHelices
			.map((vh) => [
				vh.index,
				vh.id,
				vh.regionId,
				vh.length,
				vh.localFrame
					? (['origin', 'axis', 'radial0'] as const).flatMap((key) =>
							(['x', 'y', 'z'] as const).map((c) => round(vh.localFrame![key][c]))
						)
					: null,
			])
			.sort(byTuple),
		segments: json.oligos
			.flatMap((o) =>
				o.segments.map((s) => [
					o.id,
					s.id,
					s.inVirtualHelixIndex,
					s.fivePrime.index,
					s.threePrime.index,
					s.fivePrime.connectedSegmentId,
					s.threePrime.connectedSegmentId,
				])
			)
			.sort(byTuple),
	};
}

function replayGolden() {
	const { part: json, log, expected } = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8'));
	const part = Part.fromJSON(json);
	(log as MutationOp[]).forEach((op, i) => {
		try {
			dispatchOp(op, part);
		} catch (e) {
			throw new Error(`op ${i} (${op.op}) failed: ${(e as Error).message}`);
		}
	});
	return { part, expected };
}

describe('foldnano.edit wireframe replay golden', () => {
	it('replays the Python log to the state the mirror predicted', () => {
		const { part, expected } = replayGolden();

		expect(JSON.parse(JSON.stringify(summary(part.toJSON())))).toEqual(
			JSON.parse(JSON.stringify(expected))
		);
	});

	it('survives a JSON round trip as wireframe regions', () => {
		const json = JSON.parse(JSON.stringify(replayGolden().part.toJSON()));

		checkFoldnanoPartJsonShape(json);
		const kinds = Part.fromJSON(json).regions.filter((r) => r instanceof WireframeRegion);
		expect(kinds).toHaveLength(2);
	});

	it('passes the design checks and exports to oxDNA with edges of two lengths', () => {
		const { part } = replayGolden();

		const errors = [...checkPartIntegrity(part), ...checkSimulationProfile(part)].filter(
			(issue) => issue.severity === 'error'
		);
		expect(errors).toEqual([]);
		expect(() => exportPartToOxDna(part)).not.toThrow();
	});
});
