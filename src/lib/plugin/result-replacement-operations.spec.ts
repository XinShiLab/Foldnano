import { describe, it, expect, vi } from 'vitest';
import { makeHoneycombPart, addLatticeVh } from '$lib/model/test/testHelpers';
import { CadnanoJSON, type VStrandJSON } from '$lib/model/io/cadnanoJSON';
import { HoneycombRegion, LatticedDesignRegion } from '$lib/model/Part/DesignRegion';
import { Plane } from '$lib/model/Part/Plane.svelte';
import { Part } from '$lib/model/Part';
import {
	performReplacePart,
	performReplacePartKeepAnnotations,
	performReplaceRegion,
	performReplaceRegionKeepAnnotations,
	buildAnnotationMap,
	makeSegmentKey,
	slotsToSequence,
	slotsToSkipsAndInserts,
	type PartJSON,
} from './result-replacement-operations';

function roundTrip<T>(x: T): T {
	return JSON.parse(JSON.stringify(x));
}

/** Spies on console.warn/info for the duration of `fn`, asserting neither was called. */
function expectNoConsoleOutput(fn: () => void): void {
	const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
	const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
	try {
		fn();
		expect(warnSpy).not.toHaveBeenCalled();
		expect(infoSpy).not.toHaveBeenCalled();
	} finally {
		warnSpy.mockRestore();
		infoSpy.mockRestore();
	}
}

describe('performReplacePart', () => {
	it('reconstructs an equivalent, distinct part from its own JSON', () => {
		const part = makeHoneycombPart('Original');
		const vh = addLatticeVh(part, 0, 0);
		part.createOligo(vh, 0, 10, '#000000');
		const resultPartJson = roundTrip(part.toJSON()) as PartJSON;

		const rebuilt = performReplacePart(resultPartJson);

		// Boolean, not .not.toBe(): live $state-proxied Part objects hang vitest's diff on failure.
		expect(rebuilt === part).toBe(false);
		expect(rebuilt.virtualHelices.length).toBe(part.virtualHelices.length);
		expect(rebuilt.oligos.size).toBe(part.oligos.size);
	});

	it('never prints to the console', () => {
		const part = makeHoneycombPart('Original');
		const vh = addLatticeVh(part, 0, 0);
		part.createOligo(vh, 0, 10, '#000000');
		const resultPartJson = roundTrip(part.toJSON()) as PartJSON;

		expectNoConsoleOutput(() => performReplacePart(resultPartJson));
	});

	it('rebuilds spatial-index caches exactly twice: once inside Part.fromJSON, once explicitly after', () => {
		const part = makeHoneycombPart('Original');
		const vh = addLatticeVh(part, 0, 0);
		part.createOligo(vh, 0, 10, '#000000');
		const resultPartJson = roundTrip(part.toJSON()) as PartJSON;

		const spy = vi.spyOn(Part.prototype, 'rebuildRspCaches');
		try {
			performReplacePart(resultPartJson);
			expect(spy).toHaveBeenCalledTimes(2);
		} finally {
			spy.mockRestore();
		}
	});
});

describe('performReplacePartKeepAnnotations', () => {
	it('restores name and modification for matching segments (identity round-trip)', () => {
		const part = makeHoneycombPart('Original');
		const vh = addLatticeVh(part, 0, 0);
		const oligo = part.createOligo(vh, 0, 10, '#000000');
		const seg = [...oligo.segments][0];
		seg.fivePrime.modification = '/5Alex488N/';
		oligo.name = 'Annotated';

		const preRunSnapshot = roundTrip(part.toJSON()) as PartJSON;
		const resultPartJson = roundTrip(part.toJSON()) as PartJSON;

		const { part: rebuilt, diagnostics } = performReplacePartKeepAnnotations(
			resultPartJson,
			preRunSnapshot
		);

		expect(diagnostics).toEqual({ matched: 1, unmatched: 0, warnings: [] });
		const rebuiltOligo = [...rebuilt.oligos][0];
		const rebuiltSeg = [...rebuiltOligo.segments][0];
		expect(rebuiltOligo.name).toBe('Annotated');
		expect(rebuiltSeg.fivePrime.modification).toBe('/5Alex488N/');
	});

	it('reports unmatched segments with the whole-part warning wording when nothing in the snapshot matches', () => {
		const part = makeHoneycombPart('Original');
		const vh = addLatticeVh(part, 0, 0);
		part.createOligo(vh, 0, 10, '#000000');
		const resultPartJson = roundTrip(part.toJSON()) as PartJSON;
		const emptySnapshot: PartJSON = { ...resultPartJson, oligos: [] };

		const { diagnostics } = performReplacePartKeepAnnotations(resultPartJson, emptySnapshot);

		expect(diagnostics).toEqual({
			matched: 0,
			unmatched: 1,
			warnings: [
				'1 segment(s) had no annotation match (new or repositioned topology). 0 segment(s) restored.',
			],
		});
	});

	it('never prints to the console, even when segments are unmatched', () => {
		const part = makeHoneycombPart('Original');
		const vh = addLatticeVh(part, 0, 0);
		part.createOligo(vh, 0, 10, '#000000');
		const resultPartJson = roundTrip(part.toJSON()) as PartJSON;
		const emptySnapshot: PartJSON = { ...resultPartJson, oligos: [] };

		expectNoConsoleOutput(() => performReplacePartKeepAnnotations(resultPartJson, emptySnapshot));
	});

	it('rebuilds caches exactly twice, and only the second call sees the re-grafted name', () => {
		const part = makeHoneycombPart('Original');
		const vh = addLatticeVh(part, 0, 0);
		const oligo = part.createOligo(vh, 0, 10, '#000000');
		oligo.name = 'Annotated';
		const preRunSnapshot = roundTrip(part.toJSON()) as PartJSON;
		// Different name than preRunSnapshot's, so a name change proves rebuild ran after regraft.
		oligo.name = 'Unannotated Result';
		const resultPartJson = roundTrip(part.toJSON()) as PartJSON;

		const original = Part.prototype.rebuildRspCaches;
		const nameAtEachCall: (string | undefined)[] = [];
		const spy = vi.spyOn(Part.prototype, 'rebuildRspCaches').mockImplementation(function (
			this: Part
		) {
			nameAtEachCall.push([...this.oligos][0]?.name);
			return original.call(this);
		});
		try {
			performReplacePartKeepAnnotations(resultPartJson, preRunSnapshot);
			expect(nameAtEachCall).toEqual(['Unannotated Result', 'Annotated']);
		} finally {
			spy.mockRestore();
		}
	});
});

function makeRegionFixture() {
	const part = makeHoneycombPart('Original');
	const vh = addLatticeVh(part, 0, 0);
	const oligo = part.createOligo(vh, 0, 10, '#000000');
	const region = part.getDefaultRegion() as LatticedDesignRegion;
	return { part, region, oligo };
}

// Two honeycomb regions on separate planes, linked by one crossover across the boundary.
function makeTwoRegionCrossLinkFixture() {
	const part = makeHoneycombPart('Original');
	const region1 = part.getDefaultRegion() as LatticedDesignRegion;
	const vh1 = addLatticeVh(part, 0, 0);
	const oligo1 = part.createOligo(vh1, 0, 5, '#000000');

	const plane2 = new Plane('Plane 2');
	const region2 = new HoneycombRegion('Region 2', plane2.id);
	part.addPlane(plane2);
	part.addRegion(region2);
	const vh2 = region2.addVhAtCoords(part, 0, 0);
	const oligo2 = part.createOligo(vh2, 0, 5, '#000000');

	part.connectTwoOligos(oligo1, oligo2);

	return { part, region: region1 };
}

describe('performReplaceRegion', () => {
	it('round-trips a region through its own exported cadnano data, preserving the VH count', () => {
		const { part, region } = makeRegionFixture();
		const { json } = CadnanoJSON.fromRegion(region, part);
		const cadnanoData = roundTrip(json) as { name: string; vstrands: VStrandJSON[] };
		const vhCountBefore = part.virtualHelices.length;

		const crossRegionLinks = performReplaceRegion(part, region, cadnanoData);

		expect(part.virtualHelices.length).toBe(vhCountBefore);
		// A single-region part has no cross-region links to report.
		expect(crossRegionLinks).toEqual({ attempted: 0, restored: 0, skipped: 0, warnings: [] });
	});

	it('never prints to the console', () => {
		const { part, region } = makeRegionFixture();
		const { json } = CadnanoJSON.fromRegion(region, part);
		const cadnanoData = roundTrip(json) as { name: string; vstrands: VStrandJSON[] };

		expectNoConsoleOutput(() => performReplaceRegion(part, region, cadnanoData));
	});

	it('restores a connected cross-region link after region replacement, printing nothing', () => {
		const { part, region } = makeTwoRegionCrossLinkFixture();
		const { json } = CadnanoJSON.fromRegion(region, part);
		const cadnanoData = roundTrip(json) as { name: string; vstrands: VStrandJSON[] };

		let crossRegionLinks!: ReturnType<typeof performReplaceRegion>;
		expectNoConsoleOutput(() => {
			crossRegionLinks = performReplaceRegion(part, region, cadnanoData);
		});

		expect(crossRegionLinks).toEqual({ attempted: 1, restored: 1, skipped: 0, warnings: [] });
		// The restored crossover re-merges the two regions' oligos back into one.
		expect(part.oligos.size).toBe(1);
	});
});

describe('performReplaceRegionKeepAnnotations', () => {
	it('preserves the oligo name through a region identity round-trip (not representable in raw cadnano data)', () => {
		const { part, region, oligo } = makeRegionFixture();
		oligo.name = 'Annotated';
		const preRunSnapshot = roundTrip(part.toJSON()) as PartJSON;
		const { json } = CadnanoJSON.fromRegion(region, part);
		const cadnanoData = roundTrip(json) as { name: string; vstrands: VStrandJSON[] };

		const { diagnostics, crossRegionLinks } = performReplaceRegionKeepAnnotations(
			part,
			region,
			cadnanoData,
			preRunSnapshot
		);

		expect(diagnostics.unmatched).toBe(0);
		expect(diagnostics.warnings).toEqual([]);
		expect(crossRegionLinks).toEqual({ attempted: 0, restored: 0, skipped: 0, warnings: [] });
		expect([...part.oligos][0].name).toBe('Annotated');
	});

	it('reports unmatched region segments with "region segment(s)" wording', () => {
		const { part, region } = makeRegionFixture();
		const { json } = CadnanoJSON.fromRegion(region, part);
		const cadnanoData = roundTrip(json) as { name: string; vstrands: VStrandJSON[] };
		const emptySnapshot: PartJSON = { ...(roundTrip(part.toJSON()) as PartJSON), oligos: [] };

		const { diagnostics } = performReplaceRegionKeepAnnotations(
			part,
			region,
			cadnanoData,
			emptySnapshot
		);

		expect(diagnostics.matched).toBe(0);
		expect(diagnostics.unmatched).toBe(1);
		expect(diagnostics.warnings[0]).toContain('region segment(s)');
	});

	it('never prints to the console, even when segments are unmatched', () => {
		const { part, region } = makeRegionFixture();
		const { json } = CadnanoJSON.fromRegion(region, part);
		const cadnanoData = roundTrip(json) as { name: string; vstrands: VStrandJSON[] };
		const emptySnapshot: PartJSON = { ...(roundTrip(part.toJSON()) as PartJSON), oligos: [] };

		expectNoConsoleOutput(() =>
			performReplaceRegionKeepAnnotations(part, region, cadnanoData, emptySnapshot)
		);
	});
});

describe('annotation helpers', () => {
	it('makeSegmentKey formats a stable, unique key', () => {
		expect(makeSegmentKey(3, 0, 5, 15)).toBe('3:0:5:15');
	});

	it('buildAnnotationMap returns an empty map for a null snapshot', () => {
		expect(buildAnnotationMap(null).size).toBe(0);
	});

	it('buildAnnotationMap keys entries by VH index, strand, and five-/three-prime index', () => {
		const part = makeHoneycombPart('Original');
		const vh = addLatticeVh(part, 0, 0);
		part.createOligo(vh, 0, 10, '#000000');
		const snapshot = roundTrip(part.toJSON()) as PartJSON;

		const map = buildAnnotationMap(snapshot);

		expect(map.size).toBe(1);
		expect(map.has(makeSegmentKey(vh.index, 0, 0, 10))).toBe(true);
	});

	it('slotsToSequence concatenates slot sequences in order', () => {
		expect(
			slotsToSequence([
				{ bpIndex: 0, seq: 'A' },
				{ bpIndex: 1, seq: 'C' },
			])
		).toBe('AC');
	});

	it('slotsToSkipsAndInserts marks empty slots as skips and multi-base slots as inserts', () => {
		expect(
			slotsToSkipsAndInserts([
				{ bpIndex: 0, seq: 'A' },
				{ bpIndex: 1, seq: '' },
				{ bpIndex: 2, seq: 'AAA' },
			])
		).toEqual([
			[1, -1],
			[2, 2],
		]);
	});
});
