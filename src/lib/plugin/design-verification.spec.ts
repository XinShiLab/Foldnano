import { describe, it, expect } from 'vitest';
import { makeHoneycombPart, addLatticeVh } from '$lib/model/test/testHelpers';
import { CadnanoJSON, type VStrandJSON } from '$lib/model/io/cadnanoJSON';
import {
	HoneycombRegion,
	FreeformRegion,
	LatticedDesignRegion,
} from '$lib/model/Part/DesignRegion';
import { Plane } from '$lib/model/Part/Plane.svelte';
import type { PartJSON } from './result-replacement-operations';
import { verifyDesign, type DesignVerificationInput } from './design-verification';
import { validateResultShape } from './result-format-validation-cadnano-json';
import { PluginValidationError } from './plugin-result-errors';
import type { PluginManifest } from './types';

function roundTrip<T>(x: T): T {
	return JSON.parse(JSON.stringify(x));
}

function makeManifest(applyStrategy: PluginManifest['applyStrategy']): PluginManifest {
	return {
		schemaVersion: 1,
		id: 'test-plugin',
		name: 'Test Plugin',
		version: '1.0.0',
		format: applyStrategy.startsWith('replaceRegion') ? 'cadnano_json' : 'foldnano_json',
		applyStrategy,
		entrypoint: 'def run(ctx): pass',
	};
}

function expectRejects(fn: () => void, category: string) {
	try {
		fn();
		expect.fail('expected verifyDesign to throw');
	} catch (e) {
		expect(e).toBeInstanceOf(PluginValidationError);
		expect((e as PluginValidationError).invariantCategory).toBe(category);
		expect((e as PluginValidationError).phase).toBe('design-verification');
	}
}

// ---------------------------------------------------------------------------
// replacePart
// ---------------------------------------------------------------------------

describe('verifyDesign — replacePart', () => {
	it('accepts a valid foldnano_json result and mutates nothing on the real part', () => {
		const part = makeHoneycombPart('Original');
		const vh = addLatticeVh(part, 0, 0);
		part.createOligo(vh, 0, 5, '#000000');
		const beforeJson = JSON.stringify(part.toJSON());
		const resultData = roundTrip(part.toJSON()) as PartJSON;

		const input: DesignVerificationInput = { format: 'foldnano_json', data: resultData };
		expect(() =>
			verifyDesign(makeManifest('replacePart'), 'plugin-x', null, null, input)
		).not.toThrow();

		expect(JSON.stringify(part.toJSON())).toBe(beforeJson);
	});

	it("rejects a segment whose index falls outside its own virtual helix's length — not caught by reconstruction alone", () => {
		const part = makeHoneycombPart('Original');
		const vh = addLatticeVh(part, 0, 0);
		part.createOligo(vh, 0, 5, '#000000');
		const json = roundTrip(part.toJSON()) as PartJSON;
		const seg = json.oligos[0].segments[0];
		const overIndex = vh.length + 5;
		seg.threePrime.index = overIndex;
		seg.slots = Array.from({ length: overIndex - seg.fivePrime.index + 1 }, (_, i) => ({
			bpIndex: seg.fivePrime.index + i,
			seq: 'A',
		}));

		const input: DesignVerificationInput = { format: 'foldnano_json', data: json };
		expectRejects(
			() => verifyDesign(makeManifest('replacePart'), 'plugin-x', null, null, input),
			'bounds'
		);
	});

	it('wraps a genuine reconstruction failure (dangling VH reference) as a "reconstruction" rejection, not a raw crash', () => {
		const part = makeHoneycombPart('Original');
		const vh = addLatticeVh(part, 0, 0);
		part.createOligo(vh, 0, 5, '#000000');
		const json = roundTrip(part.toJSON()) as PartJSON;
		json.oligos[0].segments[0].inVirtualHelixIndex = 999; // no such VH

		const input: DesignVerificationInput = { format: 'foldnano_json', data: json };
		expectRejects(
			() => verifyDesign(makeManifest('replacePart'), 'plugin-x', null, null, input),
			'reconstruction'
		);
	});

	it('rejects a cadnano_json result for a strategy that requires foldnano_json', () => {
		const input: DesignVerificationInput = {
			format: 'cadnano_json',
			data: { name: 'x', vstrands: [] },
		};
		expectRejects(
			() => verifyDesign(makeManifest('replacePart'), 'plugin-x', null, null, input),
			'reconstruction'
		);
	});
});

// ---------------------------------------------------------------------------
// replacePartKeepAnnotationsWhereMatched
// ---------------------------------------------------------------------------

describe('verifyDesign — replacePartKeepAnnotationsWhereMatched', () => {
	it('accepts a valid result without throwing, and leaves the real part untouched', () => {
		const part = makeHoneycombPart('Original');
		const vh = addLatticeVh(part, 0, 0);
		const oligo = part.createOligo(vh, 0, 5, '#000000');
		oligo.name = 'Annotated';
		const preRunSnapshot = roundTrip(part.toJSON()) as PartJSON;
		const beforeJson = JSON.stringify(part.toJSON());
		const resultData = roundTrip(part.toJSON()) as PartJSON;

		const input: DesignVerificationInput = { format: 'foldnano_json', data: resultData };
		expect(() =>
			verifyDesign(
				makeManifest('replacePartKeepAnnotationsWhereMatched'),
				'plugin-x',
				preRunSnapshot,
				null,
				input
			)
		).not.toThrow();

		// The real part was never touched — only a scratch part was built and discarded.
		expect(JSON.stringify(part.toJSON())).toBe(beforeJson);
	});

	it('rejects when no pre-run snapshot was captured (should-never-happen guard, not a `!` crash)', () => {
		const part = makeHoneycombPart('Original');
		const vh = addLatticeVh(part, 0, 0);
		part.createOligo(vh, 0, 5, '#000000');
		const resultData = roundTrip(part.toJSON()) as PartJSON;

		const input: DesignVerificationInput = { format: 'foldnano_json', data: resultData };
		expectRejects(
			() =>
				verifyDesign(
					makeManifest('replacePartKeepAnnotationsWhereMatched'),
					'plugin-x',
					null,
					null,
					input
				),
			'missing-snapshot'
		);
	});
});

// ---------------------------------------------------------------------------
// replaceRegion
// ---------------------------------------------------------------------------

function makeRegionFixture() {
	const part = makeHoneycombPart('Original');
	const vh = addLatticeVh(part, 0, 0);
	const oligo = part.createOligo(vh, 0, 5, '#000000');
	const region = part.getDefaultRegion() as LatticedDesignRegion;
	return { part, region, oligo };
}

// No oligo, so there's no scaf/stap connection for a renumbered `num` to leave dangling — Result validation can't intercept first.
function makeEmptyRegionFixture() {
	const part = makeHoneycombPart('Original');
	addLatticeVh(part, 0, 0);
	const region = part.getDefaultRegion() as LatticedDesignRegion;
	return { part, region };
}

function validatedCadnanoInput(cadnanoData: {
	name: string;
	vstrands: VStrandJSON[];
}): DesignVerificationInput {
	const validated = validateResultShape(JSON.stringify(cadnanoData), 'plugin-x');
	return { format: 'cadnano_json', data: { name: validated.name, vstrands: validated.vstrands } };
}

describe('verifyDesign — replaceRegion', () => {
	it('accepts a valid cadnano_json result and mutates nothing on the real part', () => {
		const { part, region } = makeRegionFixture();
		const preRunSnapshot = roundTrip(part.toJSON()) as PartJSON;
		const beforeJson = JSON.stringify(part.toJSON());
		const { json } = CadnanoJSON.fromRegion(region, part);
		const cadnanoData = roundTrip(json) as { name: string; vstrands: VStrandJSON[] };

		const input: DesignVerificationInput = { format: 'cadnano_json', data: cadnanoData };
		expect(() =>
			verifyDesign(makeManifest('replaceRegion'), 'plugin-x', preRunSnapshot, region.id, input)
		).not.toThrow();

		expect(JSON.stringify(part.toJSON())).toBe(beforeJson);
	});

	it('rejects when no pre-run snapshot was captured', () => {
		const { part, region } = makeRegionFixture();
		const { json } = CadnanoJSON.fromRegion(region, part);
		const cadnanoData = roundTrip(json) as { name: string; vstrands: VStrandJSON[] };

		const input: DesignVerificationInput = { format: 'cadnano_json', data: cadnanoData };
		expectRejects(
			() => verifyDesign(makeManifest('replaceRegion'), 'plugin-x', null, region.id, input),
			'missing-snapshot'
		);
	});

	it('rejects when no active region was recorded', () => {
		const { part, region } = makeRegionFixture();
		const preRunSnapshot = roundTrip(part.toJSON()) as PartJSON;
		const { json } = CadnanoJSON.fromRegion(region, part);
		const cadnanoData = roundTrip(json) as { name: string; vstrands: VStrandJSON[] };

		const input: DesignVerificationInput = { format: 'cadnano_json', data: cadnanoData };
		expectRejects(
			() => verifyDesign(makeManifest('replaceRegion'), 'plugin-x', preRunSnapshot, null, input),
			'missing-region'
		);
	});

	it('rejects when the recorded active region id does not resolve in the pre-run snapshot', () => {
		const { part, region } = makeRegionFixture();
		const preRunSnapshot = roundTrip(part.toJSON()) as PartJSON;
		const { json } = CadnanoJSON.fromRegion(region, part);
		const cadnanoData = roundTrip(json) as { name: string; vstrands: VStrandJSON[] };

		const input: DesignVerificationInput = { format: 'cadnano_json', data: cadnanoData };
		expectRejects(
			() =>
				verifyDesign(
					makeManifest('replaceRegion'),
					'plugin-x',
					preRunSnapshot,
					'no-such-region-id',
					input
				),
			'missing-region'
		);
	});

	// Fires after the scratch region reconstructs, but before the incoming result is grafted onto it.
	it("rejects a result that relabels the region's VH to a different region's index", () => {
		const part = makeHoneycombPart('Original');
		const region1 = part.getDefaultRegion() as LatticedDesignRegion;
		addLatticeVh(part, 0, 0);

		const plane2 = new Plane('Plane 2');
		const region2 = new HoneycombRegion('Region 2', plane2.id);
		part.addPlane(plane2);
		part.addRegion(region2);
		const vh2 = region2.addVhAtCoords(part, 0, 0);

		const preRunSnapshot = roundTrip(part.toJSON()) as PartJSON;
		const { json } = CadnanoJSON.fromRegion(region1, part);
		const cadnanoData = roundTrip(json) as { name: string; vstrands: VStrandJSON[] };
		cadnanoData.vstrands[0].num = vh2.index;

		const input = validatedCadnanoInput(cadnanoData);
		expectRejects(
			() =>
				verifyDesign(makeManifest('replaceRegion'), 'plugin-x', preRunSnapshot, region1.id, input),
			'vh-index-set'
		);
	});

	it('wraps a broken pre-run snapshot (Part.fromJSON failure) as a "reconstruction" rejection, distinct from a bad result payload', () => {
		const { part, region } = makeRegionFixture();
		const preRunSnapshot = roundTrip(part.toJSON()) as PartJSON;
		delete (preRunSnapshot as { virtualHelices?: unknown }).virtualHelices; // Part.fromJSON's own schema guard
		const { json } = CadnanoJSON.fromRegion(region, part);
		const cadnanoData = roundTrip(json) as { name: string; vstrands: VStrandJSON[] };

		const input: DesignVerificationInput = { format: 'cadnano_json', data: cadnanoData };
		expectRejects(
			() =>
				verifyDesign(makeManifest('replaceRegion'), 'plugin-x', preRunSnapshot, region.id, input),
			'reconstruction'
		);
	});

	// A region with no VHs keeps the index-set check from firing (before=after=∅), isolating the reconstruction failure below.
	it('rejects vstrands: [] with a clear message instead of a raw TypeError from reading vstrands[0]', () => {
		const part = makeHoneycombPart('Original');
		const region = part.getDefaultRegion() as LatticedDesignRegion;
		const preRunSnapshot = roundTrip(part.toJSON()) as PartJSON;

		const input: DesignVerificationInput = {
			format: 'cadnano_json',
			data: { name: 'x', vstrands: [] },
		};
		try {
			verifyDesign(makeManifest('replaceRegion'), 'plugin-x', preRunSnapshot, region.id, input);
			expect.fail('expected verifyDesign to throw');
		} catch (e) {
			expect(e).toBeInstanceOf(PluginValidationError);
			const err = e as PluginValidationError;
			expect(err.invariantCategory).toBe('reconstruction');
			expect(err.message).not.toMatch(/cannot read propert/i);
			expect(err.message).toMatch(/no virtual strands/i);
		}
	});

	// A shorter VH survives Apply itself unchanged, but the next save/reload's Part.fromJSON
	// normalize grows the VH up to the region's maxBase — silently discarding the length the
	// plugin declared (measured with a probe, not assumed — see the plan). Whether that should
	// be rejected here is an open, deferred policy decision: automatic region resizing is not
	// implemented, so for now this must be accepted, not rejected. This test exists to catch an
	// accidental re-introduction of the rejection without a deliberate decision to do so.
	it("accepts a result whose declared length is shorter than the target region's maxBase (resizing policy deferred)", () => {
		const { part, region } = makeRegionFixture();
		const preRunSnapshot = roundTrip(part.toJSON()) as PartJSON;
		const { json } = CadnanoJSON.fromRegion(region, part);
		const cadnanoData = roundTrip(json) as { name: string; vstrands: VStrandJSON[] };
		// One step shorter than the region's maxBase — still a valid HONEYCOMB base count
		// (numBases % 21 === 0), so lattice detection isn't what's being exercised here.
		const shorterLen = cadnanoData.vstrands[0].scaf.length - region.step;
		for (const key of ['scaf', 'stap', 'loop', 'skip'] as const) {
			(cadnanoData.vstrands[0][key] as unknown[]).length = shorterLen;
		}

		const input: DesignVerificationInput = { format: 'cadnano_json', data: cadnanoData };
		expect(() =>
			verifyDesign(makeManifest('replaceRegion'), 'plugin-x', preRunSnapshot, region.id, input)
		).not.toThrow();
	});

	// A longer VH is not a problem: cadnano_json has no maxBase field of its own, so on reload
	// normalize grows the region's maxBase to match the VH instead — the plugin's declared
	// length is never touched, so this must be accepted, not rejected.
	it("accepts a result whose declared length is longer than the target region's maxBase", () => {
		const { part, region } = makeRegionFixture();
		const preRunSnapshot = roundTrip(part.toJSON()) as PartJSON;
		const { json } = CadnanoJSON.fromRegion(region, part);
		const cadnanoData = roundTrip(json) as { name: string; vstrands: VStrandJSON[] };
		const longerLen = cadnanoData.vstrands[0].scaf.length + region.step;
		for (const key of ['scaf', 'stap', 'loop', 'skip'] as const) {
			const arr = cadnanoData.vstrands[0][key] as unknown[];
			arr.length = longerLen;
			arr.fill(key === 'loop' || key === 'skip' ? 0 : [-1, -1, -1, -1], arr.length - region.step);
		}

		const input: DesignVerificationInput = { format: 'cadnano_json', data: cadnanoData };
		expect(() =>
			verifyDesign(makeManifest('replaceRegion'), 'plugin-x', preRunSnapshot, region.id, input)
		).not.toThrow();
	});

	it('rejects an active region that exists but is a Freeform region, not a latticed one', () => {
		const { part, region } = makeRegionFixture();
		const { json } = CadnanoJSON.fromRegion(region, part);
		const cadnanoData = roundTrip(json) as { name: string; vstrands: VStrandJSON[] };

		const plane2 = new Plane('Freeform Plane');
		const freeformRegion = new FreeformRegion('Freeform Region', plane2.id);
		part.addPlane(plane2);
		part.addRegion(freeformRegion);
		const preRunSnapshot = roundTrip(part.toJSON()) as PartJSON;

		const input: DesignVerificationInput = { format: 'cadnano_json', data: cadnanoData };
		expectRejects(
			() =>
				verifyDesign(
					makeManifest('replaceRegion'),
					'plugin-x',
					preRunSnapshot,
					freeformRegion.id,
					input
				),
			'missing-region'
		);
	});
});

// ---------------------------------------------------------------------------
// replaceRegionKeepAnnotationsWhereMatched
// ---------------------------------------------------------------------------

describe('verifyDesign — replaceRegionKeepAnnotationsWhereMatched', () => {
	it('accepts a valid result without throwing, and leaves the real part untouched', () => {
		const { part, region, oligo } = makeRegionFixture();
		oligo.name = 'Annotated';
		const preRunSnapshot = roundTrip(part.toJSON()) as PartJSON;
		const beforeJson = JSON.stringify(part.toJSON());
		const { json } = CadnanoJSON.fromRegion(region, part);
		const cadnanoData = roundTrip(json) as { name: string; vstrands: VStrandJSON[] };

		const input: DesignVerificationInput = { format: 'cadnano_json', data: cadnanoData };
		expect(() =>
			verifyDesign(
				makeManifest('replaceRegionKeepAnnotationsWhereMatched'),
				'plugin-x',
				preRunSnapshot,
				region.id,
				input
			)
		).not.toThrow();

		expect(JSON.stringify(part.toJSON())).toBe(beforeJson);
	});

	it('rejects when no pre-run snapshot was captured', () => {
		const { part, region } = makeRegionFixture();
		const { json } = CadnanoJSON.fromRegion(region, part);
		const cadnanoData = roundTrip(json) as { name: string; vstrands: VStrandJSON[] };

		const input: DesignVerificationInput = { format: 'cadnano_json', data: cadnanoData };
		expectRejects(
			() =>
				verifyDesign(
					makeManifest('replaceRegionKeepAnnotationsWhereMatched'),
					'plugin-x',
					null,
					region.id,
					input
				),
			'missing-snapshot'
		);
	});
});

function makeTwoVhRegionFixture() {
	const part = makeHoneycombPart('Original');
	const vh0 = addLatticeVh(part, 0, 0);
	const vh1 = addLatticeVh(part, 1, 0);
	part.createOligo(vh0, 0, 5, '#000000');
	part.createOligo(vh1, 0, 5, '#000000');
	const region = part.getDefaultRegion() as LatticedDesignRegion;
	return { part, region };
}

describe('verifyDesign — VH-index-set check', () => {
	it("rejects replaceRegion when the result's vstrand indices don't match the region's VH set", () => {
		const { part, region } = makeEmptyRegionFixture();
		const preRunSnapshot = roundTrip(part.toJSON()) as PartJSON;
		const { json } = CadnanoJSON.fromRegion(region, part);
		const cadnanoData = roundTrip(json) as { name: string; vstrands: VStrandJSON[] };
		cadnanoData.vstrands[0].num = cadnanoData.vstrands[0].num + 10;

		const input = validatedCadnanoInput(cadnanoData);
		expectRejects(
			() =>
				verifyDesign(makeManifest('replaceRegion'), 'plugin-x', preRunSnapshot, region.id, input),
			'vh-index-set'
		);
	});

	it("rejects replaceRegionKeepAnnotationsWhereMatched when the result's vstrand indices don't match the region's VH set", () => {
		const { part, region } = makeEmptyRegionFixture();
		const preRunSnapshot = roundTrip(part.toJSON()) as PartJSON;
		const { json } = CadnanoJSON.fromRegion(region, part);
		const cadnanoData = roundTrip(json) as { name: string; vstrands: VStrandJSON[] };
		cadnanoData.vstrands[0].num = cadnanoData.vstrands[0].num + 10;

		const input = validatedCadnanoInput(cadnanoData);
		expectRejects(
			() =>
				verifyDesign(
					makeManifest('replaceRegionKeepAnnotationsWhereMatched'),
					'plugin-x',
					preRunSnapshot,
					region.id,
					input
				),
			'vh-index-set'
		);
	});

	it('accepts a result whose vstrands list the same VH indices in a different order — the check compares sets, not array order', () => {
		const { part, region } = makeTwoVhRegionFixture();
		const preRunSnapshot = roundTrip(part.toJSON()) as PartJSON;
		const { json } = CadnanoJSON.fromRegion(region, part);
		const cadnanoData = roundTrip(json) as { name: string; vstrands: VStrandJSON[] };
		cadnanoData.vstrands.reverse();

		const input: DesignVerificationInput = { format: 'cadnano_json', data: cadnanoData };
		expect(() =>
			verifyDesign(makeManifest('replaceRegion'), 'plugin-x', preRunSnapshot, region.id, input)
		).not.toThrow();
	});

	it("rejects with 'missing-vh-mapping' when the region's vhOrder references a VH id absent from the pre-run snapshot", () => {
		const { part, region } = makeRegionFixture();
		const preRunSnapshot = roundTrip(part.toJSON()) as PartJSON;
		const preRunRegion = preRunSnapshot.regions.find((r) => r.id === region.id)!;
		preRunRegion.vhOrder.push('no-such-vh-id');
		const { json } = CadnanoJSON.fromRegion(region, part);
		const cadnanoData = roundTrip(json) as { name: string; vstrands: VStrandJSON[] };

		const input: DesignVerificationInput = { format: 'cadnano_json', data: cadnanoData };
		expectRejects(
			() =>
				verifyDesign(makeManifest('replaceRegion'), 'plugin-x', preRunSnapshot, region.id, input),
			'missing-vh-mapping'
		);
	});

	it('does not apply the VH-index-set check to replacePart — a whole-part result may freely renumber VH indices', () => {
		const part = makeHoneycombPart('Original');
		const vh = addLatticeVh(part, 0, 0);
		part.createOligo(vh, 0, 5, '#000000');
		const json = roundTrip(part.toJSON()) as PartJSON;
		json.virtualHelices[0].index = 99;
		for (const oligo of json.oligos) {
			for (const seg of oligo.segments) seg.inVirtualHelixIndex = 99;
		}

		const input: DesignVerificationInput = { format: 'foldnano_json', data: json };
		expect(() =>
			verifyDesign(makeManifest('replacePart'), 'plugin-x', null, null, input)
		).not.toThrow();
	});

	it('does not apply the VH-index-set check to replacePartKeepAnnotationsWhereMatched — a whole-part result may freely renumber VH indices', () => {
		const part = makeHoneycombPart('Original');
		const vh = addLatticeVh(part, 0, 0);
		part.createOligo(vh, 0, 5, '#000000');
		const preRunSnapshot = roundTrip(part.toJSON()) as PartJSON;
		const json = roundTrip(part.toJSON()) as PartJSON;
		json.virtualHelices[0].index = 99;
		for (const oligo of json.oligos) {
			for (const seg of oligo.segments) seg.inVirtualHelixIndex = 99;
		}

		const input: DesignVerificationInput = { format: 'foldnano_json', data: json };
		expect(() =>
			verifyDesign(
				makeManifest('replacePartKeepAnnotationsWhereMatched'),
				'plugin-x',
				preRunSnapshot,
				null,
				input
			)
		).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// Reconstructed-graph invariants not guaranteed by Part.fromJSON itself
// ---------------------------------------------------------------------------

// Two VHs, two oligos, connected by one real crossover via connectTwoOligos (genuine reciprocity).
function makeCrossoverFixture() {
	const part = makeHoneycombPart('Original');
	const vh1 = addLatticeVh(part, 0, 0);
	const vh2 = addLatticeVh(part, 1, 0);
	const oligo1 = part.createOligo(vh1, 0, 5, '#000000');
	const oligo2 = part.createOligo(vh2, 0, 5, '#000000');
	part.connectTwoOligos(oligo1, oligo2);
	return { part, vh1, vh2 };
}

describe('verifyDesign — reconstructed-graph invariants', () => {
	it('rejects a strand set whose segmentIds includes an id with no matching segment, instead of silently skipping it', () => {
		const part = makeHoneycombPart('Original');
		const vh = addLatticeVh(part, 0, 0);
		part.createOligo(vh, 0, 5, '#000000');
		const json = roundTrip(part.toJSON()) as PartJSON;
		json.virtualHelices[0].strandSets[0].segmentIds.push('no-such-segment');

		const input: DesignVerificationInput = { format: 'foldnano_json', data: json };
		expectRejects(
			() => verifyDesign(makeManifest('replacePart'), 'plugin-x', null, null, input),
			'reference'
		);
	});

	it('rejects a connection pointing at a segment id that does not exist', () => {
		const { part } = makeCrossoverFixture();
		const json = roundTrip(part.toJSON()) as PartJSON;
		const seg = json.oligos
			.flatMap((o) => o.segments)
			.find((s) => s.threePrime.connectedSegmentId !== null)!;
		seg.threePrime.connectedSegmentId = 'no-such-segment';

		const input: DesignVerificationInput = { format: 'foldnano_json', data: json };
		expectRejects(
			() => verifyDesign(makeManifest('replacePart'), 'plugin-x', null, null, input),
			'reference'
		);
	});

	it('rejects a connection whose target does not connect back (one-sided, not caught by reconstruction alone)', () => {
		const part = makeHoneycombPart('Original');
		const vh1 = addLatticeVh(part, 0, 0);
		const vh2 = addLatticeVh(part, 1, 0);
		const vh3 = addLatticeVh(part, 2, 0);
		const oligo1 = part.createOligo(vh1, 0, 5, '#000000');
		const oligo2 = part.createOligo(vh2, 0, 5, '#000000');
		part.createOligo(vh3, 0, 5, '#000000'); // innocent third segment, never claims oligo1 back
		part.connectTwoOligos(oligo1, oligo2);
		const json = roundTrip(part.toJSON()) as PartJSON;

		const oligo3Json = json.oligos.find((o) => o.segments[0].inVirtualHelixIndex === vh3.index)!;
		const seg1Json = json.oligos
			.flatMap((o) => o.segments)
			.find((s) => s.threePrime.connectedSegmentId !== null)!;
		seg1Json.threePrime.connectedSegmentId = oligo3Json.segments[0].id;

		const input: DesignVerificationInput = { format: 'foldnano_json', data: json };
		expectRejects(
			() => verifyDesign(makeManifest('replacePart'), 'plugin-x', null, null, input),
			'reciprocity'
		);
	});

	it('rejects a virtual helix whose regionId references a region that does not exist', () => {
		const part = makeHoneycombPart('Original');
		const vh = addLatticeVh(part, 0, 0);
		part.createOligo(vh, 0, 5, '#000000');
		const json = roundTrip(part.toJSON()) as PartJSON;
		json.virtualHelices[0].regionId = 'no-such-region';

		const input: DesignVerificationInput = { format: 'foldnano_json', data: json };
		expectRejects(
			() => verifyDesign(makeManifest('replacePart'), 'plugin-x', null, null, input),
			'reference'
		);
	});

	it('rejects a region whose planeId references a plane that does not exist', () => {
		const part = makeHoneycombPart('Original');
		const vh = addLatticeVh(part, 0, 0);
		part.createOligo(vh, 0, 5, '#000000');
		const json = roundTrip(part.toJSON()) as PartJSON;
		json.regions[0].planeId = 'no-such-plane';

		const input: DesignVerificationInput = { format: 'foldnano_json', data: json };
		expectRejects(
			() => verifyDesign(makeManifest('replacePart'), 'plugin-x', null, null, input),
			'reference'
		);
	});

	it('rejects a virtual helix with no region assigned (undefined regionId) — getRegionForVh throws for this outside the single-region auto-heal case', () => {
		const part = makeHoneycombPart('Original');
		const vh = addLatticeVh(part, 0, 0);
		part.createOligo(vh, 0, 5, '#000000');
		const json = roundTrip(part.toJSON()) as PartJSON;
		delete (json.virtualHelices[0] as { regionId?: string }).regionId;

		const input: DesignVerificationInput = { format: 'foldnano_json', data: json };
		expectRejects(
			() => verifyDesign(makeManifest('replacePart'), 'plugin-x', null, null, input),
			'reference'
		);
	});

	it('rejects a strand set whose segmentIds includes a real segment that belongs to a different virtual helix', () => {
		const part = makeHoneycombPart('Original');
		const vh1 = addLatticeVh(part, 0, 0);
		const vh2 = addLatticeVh(part, 1, 0);
		part.createOligo(vh1, 0, 5, '#000000');
		const oligo2 = part.createOligo(vh2, 0, 5, '#000000');
		const vh2SegId = [...oligo2.segments][0].id;
		const json = roundTrip(part.toJSON()) as PartJSON;
		json.virtualHelices[0].strandSets[0].segmentIds.push(vh2SegId);

		const input: DesignVerificationInput = { format: 'foldnano_json', data: json };
		expectRejects(
			() => verifyDesign(makeManifest('replacePart'), 'plugin-x', null, null, input),
			'reference'
		);
	});
});
