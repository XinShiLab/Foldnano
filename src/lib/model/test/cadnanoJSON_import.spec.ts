import { describe, it, expect } from 'vitest';
import { CadnanoJSON } from '../io/cadnanoJSON';
import * as fs from 'fs';
import * as path from 'path';
import { Part } from '$lib/model/Part';
import { Plane } from '$lib/model/Part/Plane.svelte';
import { HoneycombRegion, LatticedDesignRegion } from '$lib/model/Part/DesignRegion';
import { addLatticeVh } from './testHelpers';

describe('CadnanoJSON import', () => {
	describe('xover from adjacent index on different VH', () => {
		/**
		 * Regression test for: crossover whose "from" position has the same adjacent
		 * index as the current position, but originates from a *different* VH.
		 *
		 * The old isXoverEntryStart predicate used `nt[1] !== prevIndex(i)` to detect
		 * xover entries, which fails when the from-index of a cross-VH crossover
		 * happens to equal the traversal-adjacent index. The fix replaces that check
		 * with `nt[0] !== curVh` (from a different VH).
		 *
		 * Test file topology:
		 *   VH 0 (row 1, col 5) — scaffold strandSetIdx 0, step +1
		 *   VH 1 (row 1, col 4) — scaffold strandSetIdx 1, step −1
		 *
		 *   Circular scaffold (32 bases):
		 *     VH0[4..18]  → xover → VH1[17..1] → xover → VH0[4]
		 *
		 *   Linear scaffold (19 bases):
		 *     VH0[19..37]
		 */
		const testFilePath = path.resolve(
			process.cwd(),
			'test_files/internal_cadnano_designs/test_file_xover_from_adjacent_index_diff_vh.cadnano.json'
		);

		it('loads without throwing an error', () => {
			const raw = JSON.parse(fs.readFileSync(testFilePath, 'utf-8'));
			expect(() => {
				const cadnanoJson = new CadnanoJSON(raw.name, raw.vstrands);
				cadnanoJson.toPart();
			}).not.toThrow();
		});

		it('produces 2 virtual helices', () => {
			const raw = JSON.parse(fs.readFileSync(testFilePath, 'utf-8'));
			const part = new CadnanoJSON(raw.name, raw.vstrands).toPart();
			expect(part.virtualHelices.length).toBe(2);
		});

		it('produces exactly 2 oligos', () => {
			const raw = JSON.parse(fs.readFileSync(testFilePath, 'utf-8'));
			const part = new CadnanoJSON(raw.name, raw.vstrands).toPart();
			expect(part.oligos.size).toBe(2);
		});

		it('produces one circular oligo with 2 segments spanning both VHs', () => {
			const raw = JSON.parse(fs.readFileSync(testFilePath, 'utf-8'));
			const part = new CadnanoJSON(raw.name, raw.vstrands).toPart();

			const circular = Array.from(part.oligos).find((o) => o.isCircular);
			expect(circular).toBeDefined();
			expect(circular!.segments.size).toBe(2);
			// VH0 segment: indices 4–18 = 15 bases; VH1 segment: indices 17–1 = 17 bases
			expect(circular!.length).toBe(32);
		});

		it('produces one linear oligo with 1 segment on VH 0', () => {
			const raw = JSON.parse(fs.readFileSync(testFilePath, 'utf-8'));
			const part = new CadnanoJSON(raw.name, raw.vstrands).toPart();

			const linear = Array.from(part.oligos).find((o) => !o.isCircular);
			expect(linear).toBeDefined();
			expect(linear!.segments.size).toBe(1);
			// VH0 free-end segment: indices 19–37 = 19 bases
			expect(linear!.length).toBe(19);
		});

		it('the circular scaffold segments reside on VH 0 and VH 1 respectively', () => {
			const raw = JSON.parse(fs.readFileSync(testFilePath, 'utf-8'));
			const part = new CadnanoJSON(raw.name, raw.vstrands).toPart();

			const circular = Array.from(part.oligos).find((o) => o.isCircular)!;
			const vhIndices = Array.from(circular.segments).map((s) => s.inVirtualHelix.index);
			expect(vhIndices.sort()).toEqual([0, 1]);
		});
	});

	describe('Hilbert curve design (self-referential crossover exits)', () => {
		/**
		 * Regression test for: cadnano files that encode crossover exit endpoints using a
		 * self-referential prev field — [vh_num, i, next_vh, next_pos] at position i —
		 * instead of the standard [vh_num, prevIndex(i), next_vh, next_pos].
		 *
		 * The old isXoverExitEnd predicate required nt[1] === prevIndex(i), so these
		 * positions were never detected as segment exits. The affected segments were left
		 * unlinked and fell into the circular-oligo pass, which attempted to close them
		 * into loops — causing "Cannot connect segment end to another end on the same
		 * segment" errors.
		 *
		 * Hilbert.json has 100+ such self-referential crossover exits across its 110 VHs.
		 */
		const testFilePath = path.resolve(
			process.cwd(),
			'test_files/published_cadnano_designs/Hilbert.json'
		);

		it('loads without throwing an error', () => {
			const raw = JSON.parse(fs.readFileSync(testFilePath, 'utf-8'));
			expect(() => {
				const cadnanoJson = new CadnanoJSON(raw.name, raw.vstrands);
				cadnanoJson.toPart();
			}).not.toThrow();
		});

		it('produces 110 virtual helices', () => {
			const raw = JSON.parse(fs.readFileSync(testFilePath, 'utf-8'));
			const part = new CadnanoJSON(raw.name, raw.vstrands).toPart();
			expect(part.virtualHelices.length).toBe(110);
		});

		it('produces 185 oligos, all linear', () => {
			const raw = JSON.parse(fs.readFileSync(testFilePath, 'utf-8'));
			const part = new CadnanoJSON(raw.name, raw.vstrands).toPart();
			const oligos = Array.from(part.oligos);
			expect(oligos.length).toBe(185);
			expect(oligos.every((o) => !o.isCircular)).toBe(true);
		});

		it('has one scaffold strand of length 7968', () => {
			const raw = JSON.parse(fs.readFileSync(testFilePath, 'utf-8'));
			const part = new CadnanoJSON(raw.name, raw.vstrands).toPart();
			const lengths = Array.from(part.oligos).map((o) => o.length);
			expect(Math.max(...lengths)).toBe(7968);
		});

		it('has no segment whose 3-prime end connects back to its own 5-prime end', () => {
			const raw = JSON.parse(fs.readFileSync(testFilePath, 'utf-8'));
			const part = new CadnanoJSON(raw.name, raw.vstrands).toPart();
			for (const oligo of part.oligos) {
				for (const seg of oligo.segments) {
					expect(seg.threePrime.connectedSegment).not.toBe(seg);
					expect(seg.fivePrime.connectedSegment).not.toBe(seg);
				}
			}
		});
	});

	describe('multi-base insertions (loop > 1)', () => {
		const testFilePath = path.resolve(
			process.cwd(),
			'test_files/internal_cadnano_designs/nontrivial_uiuc.json'
		);

		it('imports without capping insert count > 1', () => {
			const raw = JSON.parse(fs.readFileSync(testFilePath, 'utf-8'));
			const cadnanoJson = new CadnanoJSON(raw.name, raw.vstrands);
			const part = cadnanoJson.toPart();
			// VH num=0, position 22 has loop=2 in the source file
			const vh0 = part.virtualHelices.find((vh) => vh.index === 0);
			expect(vh0).toBeDefined();
			const allSegments = vh0!.strandSets.flatMap((ss) =>
				[...ss.segmentIds].map((id) => part.getSegmentById(id)).filter(Boolean)
			);
			const insertAt22 = allSegments
				.flatMap((seg) => seg!.skipsAndInserts)
				.find(([bp]) => bp === 22);
			expect(insertAt22).toBeDefined();
			expect(insertAt22![1]).toBe(2);
		});

		it('produces no warnings for the nontrivial_uiuc file', () => {
			const raw = JSON.parse(fs.readFileSync(testFilePath, 'utf-8'));
			const cadnanoJson = new CadnanoJSON(raw.name, raw.vstrands);
			expect(cadnanoJson.warnings).toHaveLength(0);
		});

		it('round-trips insert count > 1 through export', () => {
			const raw = JSON.parse(fs.readFileSync(testFilePath, 'utf-8'));
			const cadnanoJson = new CadnanoJSON(raw.name, raw.vstrands);
			const part = cadnanoJson.toPart();
			const region = part.regions.find((r) => r instanceof LatticedDesignRegion);
			expect(region).toBeDefined();
			const { json: exported } = CadnanoJSON.fromRegion(region as LatticedDesignRegion, part);
			const vs0 = exported.vstrands.find((vs) => vs.num === 0);
			expect(vs0).toBeDefined();
			expect(vs0!.loop[22]).toBe(2);
		});
	});

	describe('1-nt strands', () => {
		it('rejects a file containing a 1-nt strand, naming its position', () => {
			const empty = (): [number, number, number, number][] =>
				Array.from({ length: 21 }, () => [-1, -1, -1, -1]);
			const vstrand = (num: number, col: number, other: number) => {
				const stap = empty();
				// 1 nt at bp 5 whose only neighbours are crossovers to the other helix
				stap[5] = [other, 5, other, 5];
				return { num, row: 0, col, scaf: empty(), stap, loop: [], skip: [], stap_colors: [] };
			};
			const raw = { name: 'one-nt', vstrands: [vstrand(0, 0, 1), vstrand(1, 1, 0)] };

			const cadnano = new CadnanoJSON(raw.name, raw.vstrands as never);
			expect(() => cadnano.toPart()).toThrow(/1-nt strands.*0\[5\], 1\[5\]/);
		});
	});

	describe('region replacement safety', () => {
		it('rejects replacement data whose VH indices collide with surviving regions', () => {
			const part = Part.forType('HONEYCOMB', 'two-region');
			const regionA = part.regions[0] as HoneycombRegion;
			addLatticeVh(part, 0, 0);
			addLatticeVh(part, 1, 0);

			const planeB = new Plane('Plane B', undefined, { x: 0, y: 0, z: 10 });
			const regionB = new HoneycombRegion('Honeycomb 2', planeB.id);
			part.addPlane(planeB);
			part.addRegion(regionB);
			const regionBVh = regionB.addVhAtCoords(part, 0, 0);

			const { json } = CadnanoJSON.fromRegion(regionA, part);
			json.vstrands[0].num = regionBVh.index;

			const regionAVhIndices = part.virtualHelices
				.filter((vh) => vh.regionId === regionA.id)
				.map((vh) => vh.index);
			part.removeVirtualHelicesByIndex(regionAVhIndices);

			expect(() => json.replaceRegionInPart(part, regionA)).toThrow(
				/existing virtual helix indices outside the target region/
			);
		});
	});
});
