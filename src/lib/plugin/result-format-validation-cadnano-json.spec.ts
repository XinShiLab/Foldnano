import { describe, it, expect } from 'vitest';
import { CadnanoJSON, type VStrandJSON } from '$lib/model/io/cadnanoJSON';
import { PluginValidationError } from './plugin-result-errors';
import { validateResultShape } from './result-format-validation-cadnano-json';

function clone<T>(x: T): T {
	return JSON.parse(JSON.stringify(x));
}

function emptyNt(): [number, number, number, number] {
	return [-1, -1, -1, -1];
}

// Two virtual helices joined by one crossover (vh0 pos2 -> vh2 pos0), a free 5' end on vh0,
// a free 3' end on vh2, one color anchor, and an otherwise-empty stap strand on both.
// 21 bases/VH (HONEYCOMB) so the real cadnano importer (CadnanoJSON.toPart(), which requires
// numBases % 21 === 0 or % 32 === 0) can actually reconstruct it, not just pass shape validation.
function validCadnano(): { name: string; vstrands: VStrandJSON[] } {
	return {
		name: 'Test',
		vstrands: [
			{
				row: 0,
				col: 0,
				num: 0,
				scaf: [[-1, -1, 0, 1], [0, 0, 0, 2], [0, 1, 2, 0], ...Array.from({ length: 18 }, emptyNt)],
				stap: Array.from({ length: 21 }, emptyNt),
				loop: new Array(21).fill(0),
				skip: new Array(21).fill(0),
				scaf_colors: [[0, 0x00ff00]],
			},
			{
				row: 0,
				col: 1,
				num: 2,
				scaf: [[0, 2, 2, 1], [2, 0, 2, 2], [2, 1, -1, -1], ...Array.from({ length: 18 }, emptyNt)],
				stap: Array.from({ length: 21 }, emptyNt),
				loop: new Array(21).fill(0),
				skip: new Array(21).fill(0),
			},
		],
	};
}

// One virtual helix with a genuine chain (0->1->2) whose exit at position 2 carries a phantom
// outgoing pointer to position 10 instead of ending freely. Positions 3-9 are unoccupied (as in
// the real pyOrigamiBreak case), and position 10 independently starts its own free 5' end (its
// own incoming field is the free sentinel, so it makes no competing claim) running to a free 3'
// end at position 11. This mirrors the real bug's shape: VH8 scaf[85] -> 8:170, where scaf[170]'s
// own incoming was [-1,-1].
function oneSidedPointerCadnano(): { name: string; vstrands: VStrandJSON[] } {
	return {
		name: 'Test',
		vstrands: [
			{
				row: 0,
				col: 0,
				num: 0,
				scaf: [
					[-1, -1, 0, 1],
					[0, 0, 0, 2],
					[0, 1, 0, 10], // phantom: should be [0, 1, -1, -1] (free 3' end)
					...Array.from({ length: 7 }, emptyNt), // 3-9: unoccupied
					[-1, -1, 0, 11], // 10: genuine free 5' start, does not claim position 2
					[0, 10, -1, -1], // 11: free 3' end
					...Array.from({ length: 9 }, emptyNt), // 12-20
				],
				stap: Array.from({ length: 21 }, emptyNt),
				loop: new Array(21).fill(0),
				skip: new Array(21).fill(0),
			},
		],
	};
}

function serialize(data: { name: string; vstrands: VStrandJSON[] }): string {
	return JSON.stringify(data);
}

function expectRejects(primaryArtifact: string | null, categorySubstring?: string) {
	try {
		validateResultShape(primaryArtifact, 'plugin-x');
		expect.fail('expected validateResultShape to throw');
	} catch (e) {
		expect(e).toBeInstanceOf(PluginValidationError);
		if (categorySubstring) {
			expect((e as PluginValidationError).invariantCategory).toBe(categorySubstring);
		}
	}
}

describe('validateResultShape (cadnano_json) — positive path and boundary', () => {
	it('accepts a valid, realistic two-VH crossover result, reconstructible by the real importer', () => {
		const result = validateResultShape(serialize(validCadnano()), 'plugin-x');
		expect(result.vstrands.length).toBe(2);
		expect(result.warnings).toEqual([]);
		// Shape validation alone isn't the bar — the importer must actually build a Part from it.
		const part = new CadnanoJSON(result.name, result.vstrands).toPart();
		expect(part.virtualHelices.length).toBe(2);
	});

	it('rejects a null primaryArtifact', () => {
		expectRejects(null);
	});

	it('rejects primaryArtifact that is not valid JSON', () => {
		expectRejects('{not json');
	});
});

describe('validateResultShape (cadnano_json) — one-sided pointer with no competing claim', () => {
	it('discards a one-sided outgoing pointer whose target makes no competing claim, warns, and the cleaned result reconstructs both ends as free', () => {
		const result = validateResultShape(serialize(oneSidedPointerCadnano()), 'plugin-x');

		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toMatch(/scaf\[2\].*did not connect back/);

		const vh0 = result.vstrands.find((vs) => vs.num === 0)!;
		expect(vh0.scaf[2]).toEqual([0, 1, -1, -1]);
		expect(vh0.scaf[10]).toEqual([-1, -1, 0, 11]); // untouched: it never made a claim

		// Apply must use this same cleaned result, not the plugin's raw one — so the real
		// importer has to be able to build it, with the phantom jump gone and both sides free.
		const part = new CadnanoJSON(result.name, result.vstrands).toPart();
		const vh = part.virtualHelices[0];
		const segIds = Array.from(vh.strandSets[0].segmentIds);
		expect(segIds.length).toBe(2);
		const segs = segIds.map((id) => part.getSegmentById(id)!);
		expect(segs.some((seg) => seg.threePrime.index === 2 && seg.threePrime.isFree)).toBe(true);
		expect(segs.some((seg) => seg.fivePrime.index === 10 && seg.fivePrime.isFree)).toBe(true);
	});

	// Mirror of the outgoing case above (fromVh/fromBp instead of toVh/toBp) — a separate branch, e.g. a crossover helper that sets only setConnection5p().
	it('discards a one-sided incoming pointer whose source is free without changing the raw result', () => {
		const raw = oneSidedPointerCadnano();
		raw.vstrands[0].scaf[2] = [0, 1, -1, -1];
		raw.vstrands[0].scaf[10] = [0, 2, 0, 11];

		const result = validateResultShape(serialize(raw), 'plugin-x');
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toMatch(/scaf\[10\].*incoming pointer/);
		expect(result.vstrands[0].scaf[10]).toEqual([-1, -1, 0, 11]);
		expect(raw.vstrands[0].scaf[10]).toEqual([0, 2, 0, 11]);

		const part = new CadnanoJSON(result.name, result.vstrands).toPart();
		const segIds = Array.from(part.virtualHelices[0].strandSets[0].segmentIds);
		const segs = segIds.map((id) => part.getSegmentById(id)!);
		expect(segs.some((seg) => seg.threePrime.index === 2 && seg.threePrime.isFree)).toBe(true);
		expect(segs.some((seg) => seg.fivePrime.index === 10 && seg.fivePrime.isFree)).toBe(true);
	});

	// Incoming-side twin of "still rejects a non-reciprocal connection" below — source position 1 has a real outgoing connection, so no safe fallback.
	it('rejects an incoming pointer whose source already connects elsewhere', () => {
		const raw = oneSidedPointerCadnano();
		raw.vstrands[0].scaf[2] = [0, 1, -1, -1];
		raw.vstrands[0].scaf[10] = [0, 1, 0, 11];
		expectRejects(serialize(raw), 'reciprocity');
	});

	it('still rejects a non-reciprocal connection whose target claims a different, conflicting connection', () => {
		// Already covered by the "rejects a non-reciprocal connection" case above — the target
		// (vh2 pos1) claims a connection to a third position, not the free sentinel, so there is
		// no safe repair and it must still fail rather than being silently discarded.
		const data = clone(validCadnano());
		data.vstrands[0].scaf[2] = [0, 1, 2, 1];
		expectRejects(JSON.stringify(data), 'reciprocity');
	});
});

describe('validateResultShape (cadnano_json) — shape rejections', () => {
	it('rejects a non-object vstrands element as a PluginValidationError, not a raw exception', () => {
		const data = { name: 'Test', vstrands: [null] } as unknown as {
			name: string;
			vstrands: VStrandJSON[];
		};
		expectRejects(serialize(data));
	});

	it('rejects a non-string "name"', () => {
		const data = clone(validCadnano()) as unknown as Record<string, unknown>;
		data.name = 42;
		expectRejects(JSON.stringify(data));
	});

	it('rejects a non-array "vstrands"', () => {
		const data = clone(validCadnano()) as unknown as Record<string, unknown>;
		data.vstrands = 'nope';
		expectRejects(JSON.stringify(data));
	});

	it('rejects a vstrand missing "scaf"', () => {
		const data = clone(validCadnano());
		delete (data.vstrands[0] as Partial<VStrandJSON>).scaf;
		expectRejects(JSON.stringify(data));
	});

	it('rejects a malformed Nt tuple (wrong length)', () => {
		const data = clone(validCadnano());
		(data.vstrands[0].scaf[0] as unknown as number[]) = [-1, -1, 0];
		expectRejects(JSON.stringify(data));
	});

	it('rejects a malformed Color tuple', () => {
		const data = clone(validCadnano());
		(data.vstrands[0].scaf_colors![0] as unknown as number[]) = [0];
		expectRejects(JSON.stringify(data), 'color-bounds');
	});

	it('rejects mismatched scaf/stap/loop/skip lengths', () => {
		const data = clone(validCadnano());
		data.vstrands[0].loop = [0, 0];
		expectRejects(JSON.stringify(data));
	});

	// Zero bases is rejected outright, not silently grown to the target region's length —
	// Part.fromJSON's legacy-migration repair policy is not extended to new plugin output.
	// A standalone vstrand (not validCadnano()'s crossover fixture) so nothing else references
	// into the emptied arrays and trips a different, unrelated bounds rejection instead.
	it('rejects a virtual helix with zero bases', () => {
		const data = {
			name: 'Test',
			vstrands: [{ row: 0, col: 0, num: 0, scaf: [], stap: [], loop: [], skip: [] }],
		};
		expectRejects(JSON.stringify(data));
	});

	// The importer sizes every new VH from vstrands[0]'s length alone, so a shorter/longer
	// sibling's declared length would otherwise be silently discarded. Two standalone,
	// non-crossover-connected vstrands so nothing else trips a reference/bounds rejection first.
	it('rejects virtual helices with different declared base counts', () => {
		const data = {
			name: 'Test',
			vstrands: [
				{
					row: 0,
					col: 0,
					num: 0,
					scaf: Array(21).fill([-1, -1, -1, -1]),
					stap: Array(21).fill([-1, -1, -1, -1]),
					loop: Array(21).fill(0),
					skip: Array(21).fill(0),
				},
				{
					row: 0,
					col: 1,
					num: 1,
					scaf: Array(42).fill([-1, -1, -1, -1]),
					stap: Array(42).fill([-1, -1, -1, -1]),
					loop: Array(42).fill(0),
					skip: Array(42).fill(0),
				},
			],
		};
		expectRejects(JSON.stringify(data));
	});

	// The importer places each VH at (row, col) as-is with no collision check of its own — two
	// vstrands sharing a lattice position would silently overlap after Apply. Different `num`
	// values (not a duplicate-index case) so this exercises the coordinate check specifically.
	it('rejects two virtual helices sharing the same lattice position', () => {
		const data = {
			name: 'Test',
			vstrands: [
				{
					row: 5,
					col: 5,
					num: 0,
					scaf: Array(21).fill([-1, -1, -1, -1]),
					stap: Array(21).fill([-1, -1, -1, -1]),
					loop: Array(21).fill(0),
					skip: Array(21).fill(0),
				},
				{
					row: 5,
					col: 5,
					num: 1,
					scaf: Array(21).fill([-1, -1, -1, -1]),
					stap: Array(21).fill([-1, -1, -1, -1]),
					loop: Array(21).fill(0),
					skip: Array(21).fill(0),
				},
			],
		};
		expectRejects(JSON.stringify(data));
	});

	it('rejects a duplicate virtual helix "num"', () => {
		const data = clone(validCadnano());
		data.vstrands[1].num = 0;
		expectRejects(JSON.stringify(data));
	});

	it('rejects a non-integer field', () => {
		const data = clone(validCadnano());
		(data.vstrands[0] as unknown as Record<string, unknown>).row = 0.5;
		expectRejects(JSON.stringify(data));
	});

	it('rejects a half-sentinel incoming pointer', () => {
		const data = clone(validCadnano());
		data.vstrands[0].scaf[0] = [-1, 0, 0, 1]; // fromVh=-1 but fromBp=0
		expectRejects(JSON.stringify(data));
	});

	// Separate reject() branch from the incoming case above; mutating vh2's own free 3' end (not referenced by anything else) keeps bounds/reciprocity from also firing.
	it('rejects a half-sentinel outgoing pointer', () => {
		const data = clone(validCadnano());
		data.vstrands[1].scaf[2] = [2, 1, -1, 5]; // toVh=-1 but toBp=5
		expectRejects(JSON.stringify(data));
	});

	// Covers the snake_case/camelCase alt-key block (cadnanoJSON.ts accepts both); previously untested.
	it('rejects a non-integer entry in scaf_loop (same check covers stap_loop/scafLoop/stapLoop)', () => {
		const data = clone(validCadnano());
		(data.vstrands[0] as unknown as Record<string, unknown>).scaf_loop = [0, 'not-a-number'];
		expectRejects(JSON.stringify(data));
	});
});

describe('validateResultShape (cadnano_json) — cross-referential rejections', () => {
	it('rejects a connection pointing at a bp index out of bounds for the virtual helix it references', () => {
		const data = clone(validCadnano());
		// vh2 has 21 bases (indices 0-20); redirect vh0's crossover to vh2 index 21, one past the end.
		data.vstrands[0].scaf[2] = [0, 1, 2, 21];
		expectRejects(JSON.stringify(data), 'bounds');
	});

	it('rejects a connection referencing a virtual helix that does not exist', () => {
		const data = clone(validCadnano());
		data.vstrands[0].scaf[2] = [0, 1, 99, 0];
		expectRejects(JSON.stringify(data), 'reference');
	});

	it('rejects a non-reciprocal connection', () => {
		const data = clone(validCadnano());
		// vh2 pos0's incoming still claims vh0:2, but vh0 pos2's outgoing is redirected elsewhere.
		data.vstrands[0].scaf[2] = [0, 1, 2, 1];
		expectRejects(JSON.stringify(data), 'reciprocity');
	});

	it('rejects an out-of-range color value', () => {
		const data = clone(validCadnano());
		data.vstrands[0].scaf_colors![0] = [0, 0x1000000];
		expectRejects(JSON.stringify(data), 'color-bounds');
	});

	it("rejects a color anchored outside its own strand's array", () => {
		const data = clone(validCadnano());
		data.vstrands[0].scaf_colors![0] = [25, 0x00ff00];
		expectRejects(JSON.stringify(data), 'bounds');
	});
});

describe('validateResultShape (cadnano_json) — loop/skip domain rejections', () => {
	it('rejects skip[i] outside {0, -1}', () => {
		const data = clone(validCadnano());
		data.vstrands[0].skip[0] = -2;
		expectRejects(JSON.stringify(data));
	});

	it('rejects loop[i] < 0', () => {
		const data = clone(validCadnano());
		data.vstrands[0].loop[0] = -1;
		expectRejects(JSON.stringify(data));
	});

	it('rejects a position marked as both a skip and an insertion', () => {
		const data = clone(validCadnano());
		data.vstrands[0].skip[0] = -1;
		data.vstrands[0].loop[0] = 1;
		expectRejects(JSON.stringify(data));
	});
});
