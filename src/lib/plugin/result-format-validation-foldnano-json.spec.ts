import { describe, it, expect } from 'vitest';
import { makeHoneycombPart, addLatticeVh } from '$lib/model/test/testHelpers';
import { PluginValidationError } from './plugin-result-errors';
import { validateResultShape } from './result-format-validation-foldnano-json';
import type { PartJSON } from './result-replacement-operations';

/** Two VHs, one oligo spanning both via a crossover (one linear chain), one custom
 *  modification, and one overlay placement — a realistic, fully valid `foldnano_json` result. */
function makeValidFixture(): PartJSON {
	const part = makeHoneycombPart('Test');
	const vh1 = addLatticeVh(part, 0, 0);
	const vh2 = addLatticeVh(part, 1, 0);
	const oligo1 = part.createOligo(vh1, 0, 5, '#000000');
	const oligo2 = part.createOligo(vh2, 0, 5, '#000000');
	part.connectTwoOligos(oligo1, oligo2);
	part.customModifications.push({ name: 'Thiol Test', color: '#ff0000' });
	part.setOverlayPlacement('overlay-1', 'source-1', {
		position: { x: 0, y: 0, z: 0 },
		quaternion: [0, 0, 0, 1],
	});
	return part.toJSON();
}

function clone(x: PartJSON): PartJSON {
	return JSON.parse(JSON.stringify(x));
}

function serialize(x: unknown): string {
	return JSON.stringify(x);
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

describe('validateResultShape (foldnano_json) — positive path and boundary', () => {
	it('accepts a valid, realistic two-VH crossover result', () => {
		const result = validateResultShape(serialize(makeValidFixture()), 'plugin-x');
		expect(result.virtualHelices.length).toBe(2);
		expect(result.oligos.length).toBe(1);
	});

	it('rejects a null primaryArtifact', () => {
		expectRejects(null);
	});

	it('rejects primaryArtifact that is not valid JSON', () => {
		expectRejects('{not json');
	});
});

describe('validateResultShape (foldnano_json) — top-level and plane/region shape', () => {
	it('rejects a mirrored (left-handed) plane basis', () => {
		const fixture = clone(makeValidFixture());
		Object.assign(fixture.planes[0], {
			u: { x: 0, y: 1, z: 0 },
			v: { x: 0, y: 0, z: -1 },
			normal: { x: 1, y: 0, z: 0 },
		});
		expectRejects(serialize(fixture), 'mirrored-plane');
	});

	it('rejects a missing top-level "name"', () => {
		const data = clone(makeValidFixture()) as unknown as Record<string, unknown>;
		delete data.name;
		expectRejects(serialize(data));
	});

	it('accepts empty-string names on the part, a plane, and a region — name is free text, not an identifier', () => {
		const data = clone(makeValidFixture());
		data.name = '';
		data.planes[0].name = '';
		data.regions[0].name = '';
		const result = validateResultShape(serialize(data), 'plugin-x');
		expect(result.name).toBe('');
		expect(result.planes[0].name).toBe('');
		expect(result.regions[0].name).toBe('');
	});

	it('rejects a plane with a malformed "origin"', () => {
		const data = clone(makeValidFixture());
		(data.planes[0] as unknown as Record<string, unknown>).origin = { x: 0, y: 0 };
		expectRejects(serialize(data));
	});

	it('rejects a region with an invalid "kind"', () => {
		const data = clone(makeValidFixture());
		(data.regions[0] as unknown as Record<string, unknown>).kind = 'TRIANGLE';
		expectRejects(serialize(data));
	});

	it('rejects a region with minBase > maxBase', () => {
		const data = clone(makeValidFixture());
		data.regions[0].minBase = data.regions[0].maxBase + 1;
		expectRejects(serialize(data));
	});

	it('rejects a region with a non-integer "maxBase"', () => {
		const data = clone(makeValidFixture());
		data.regions[0].maxBase += 0.5;
		expectRejects(serialize(data));
	});

	it('rejects a region with a non-positive "step"', () => {
		const data = clone(makeValidFixture());
		data.regions[0].step = 0;
		expectRejects(serialize(data));
	});

	it('rejects a region with a non-integer "turnsPerStep"', () => {
		const data = clone(makeValidFixture());
		(data.regions[0] as unknown as Record<string, unknown>).turnsPerStep = 1.5;
		expectRejects(serialize(data));
	});

	it('rejects a region whose "vhOrder" references an unknown VH id', () => {
		const data = clone(makeValidFixture());
		data.regions[0].vhOrder = [...data.regions[0].vhOrder, 'nonexistent-vh-id'];
		expectRejects(serialize(data), 'reference');
	});

	it('rejects a region whose "vhOrder" has a duplicate entry', () => {
		const data = clone(makeValidFixture());
		data.regions[0].vhOrder = [data.regions[0].vhOrder[0], data.regions[0].vhOrder[0]];
		expectRejects(serialize(data));
	});

	it("rejects a VH whose regionId points elsewhere than its region's vhOrder claims", () => {
		const data = clone(makeValidFixture());
		// Remove the first VH's id from vhOrder while it still claims that regionId.
		data.regions[0].vhOrder = data.regions[0].vhOrder.filter(
			(id) => id !== data.virtualHelices[0].id
		);
		expectRejects(serialize(data), 'reference');
	});
});

describe('validateResultShape (foldnano_json) — virtual helix shape', () => {
	it('rejects a duplicate virtual helix "index"', () => {
		const data = clone(makeValidFixture());
		data.virtualHelices[1].index = data.virtualHelices[0].index;
		expectRejects(serialize(data));
	});

	it('rejects a duplicate virtual helix "id"', () => {
		const data = clone(makeValidFixture());
		data.virtualHelices[1].id = data.virtualHelices[0].id;
		expectRejects(serialize(data));
	});

	it('rejects a non-integer discrete field ("length")', () => {
		const data = clone(makeValidFixture());
		(data.virtualHelices[0] as unknown as Record<string, unknown>).length = 10.5;
		expectRejects(serialize(data));
	});

	// Part.fromJSON silently resolves this on load by growing one side to match the other (a
	// too-short VH is grown to the region's maxBase; a too-long VH instead grows the region's
	// own maxBase) — reject the plugin's own contradiction here instead of letting reconstruction
	// pick a winner unseen.
	it("rejects a virtual helix whose length does not match its region's maxBase", () => {
		const data = clone(makeValidFixture());
		data.virtualHelices[0].length = data.regions[0].maxBase - 1;
		expectRejects(serialize(data));
	});

	it('rejects a VH with other than exactly two strand sets', () => {
		const data = clone(makeValidFixture());
		data.virtualHelices[0].strandSets.pop();
		expectRejects(serialize(data));
	});

	it('rejects a latticed VH missing "latticeCoords"', () => {
		const data = clone(makeValidFixture());
		delete (data.virtualHelices[0] as Partial<PartJSON['virtualHelices'][number]>).latticeCoords;
		expectRejects(serialize(data));
	});

	it('rejects two VHs in the same region sharing "latticeCoords"', () => {
		const data = clone(makeValidFixture());
		data.virtualHelices[1].latticeCoords = { ...data.virtualHelices[0].latticeCoords! };
		expectRejects(serialize(data));
	});
});

describe('validateResultShape (foldnano_json) — strand set / segment ownership', () => {
	it('rejects a strand set with a duplicate strandIndex', () => {
		const data = clone(makeValidFixture());
		data.virtualHelices[0].strandSets[1].strandIndex =
			data.virtualHelices[0].strandSets[0].strandIndex;
		expectRejects(serialize(data));
	});

	it('rejects a segment absent from every strand set', () => {
		const data = clone(makeValidFixture());
		const seg = data.oligos[0].segments[0];
		const vh = data.virtualHelices.find((v) => v.index === seg.inVirtualHelixIndex)!;
		for (const ss of vh.strandSets) {
			ss.segmentIds = ss.segmentIds.filter((id) => id !== seg.id);
		}
		expectRejects(serialize(data));
	});

	it('rejects a segment whose inVirtualHelixIndex does not match its own strand set membership', () => {
		const data = clone(makeValidFixture());
		const [vhA, vhB] = data.virtualHelices;
		const segOnA = data.oligos[0].segments.find((s) => s.inVirtualHelixIndex === vhA.index)!;
		// Move the claim to vhB while leaving it registered under vhA's own strand set.
		segOnA.inVirtualHelixIndex = vhB.index;
		expectRejects(serialize(data), 'reference');
	});

	it('rejects a segment filed under the strand set whose direction does not match its endpoints', () => {
		const data = clone(makeValidFixture());
		const seg = data.oligos[0].segments[0];
		const vh = data.virtualHelices.find((v) => v.index === seg.inVirtualHelixIndex)!;
		const correctIndex = seg.fivePrime.index < seg.threePrime.index ? 0 : 1;
		const wrongSS = vh.strandSets.find((ss) => ss.strandIndex !== correctIndex)!;
		const rightSS = vh.strandSets.find((ss) => ss.strandIndex === correctIndex)!;
		rightSS.segmentIds = rightSS.segmentIds.filter((id) => id !== seg.id);
		wrongSS.segmentIds = [...wrongSS.segmentIds, seg.id];
		expectRejects(serialize(data), 'reference');
	});

	it('rejects two overlapping segments filed under the same strand set', () => {
		const data = clone(makeValidFixture());
		const vh = data.virtualHelices[0];
		const seg = data.oligos[0].segments.find((s) => s.inVirtualHelixIndex === vh.index)!;
		const overlapping = {
			...JSON.parse(JSON.stringify(seg)),
			id: 'overlap-segment',
			fivePrime: { ...seg.fivePrime, segmentId: 'overlap-segment', connectedSegmentId: null },
			threePrime: { ...seg.threePrime, segmentId: 'overlap-segment', connectedSegmentId: null },
		};
		data.oligos[0].segments.push(overlapping);
		const ss = vh.strandSets.find((s) => s.segmentIds.includes(seg.id))!;
		ss.segmentIds = [...ss.segmentIds, 'overlap-segment'];
		expectRejects(serialize(data));
	});
});

describe('validateResultShape (foldnano_json) — segment/endpoint semantics', () => {
	it('rejects a segment whose fivePrime.isThreePrime is not false', () => {
		const data = clone(makeValidFixture());
		data.oligos[0].segments[0].fivePrime.isThreePrime = true;
		expectRejects(serialize(data));
	});

	it('rejects a segment whose threePrime.isThreePrime is not true', () => {
		const data = clone(makeValidFixture());
		data.oligos[0].segments[0].threePrime.isThreePrime = false;
		expectRejects(serialize(data));
	});

	it('rejects an end whose own segmentId does not match its containing segment', () => {
		const data = clone(makeValidFixture());
		data.oligos[0].segments[0].fivePrime.segmentId = 'not-this-segment';
		expectRejects(serialize(data));
	});

	it('rejects self-connection (an end connecting to its own segment)', () => {
		const data = clone(makeValidFixture());
		const seg = data.oligos[0].segments[0];
		seg.fivePrime.connectedSegmentId = seg.id;
		expectRejects(serialize(data), 'self-connection');
	});

	it('rejects a connection spanning two different oligos', () => {
		const part = makeHoneycombPart('Test');
		const vh1 = addLatticeVh(part, 0, 0);
		const vh2 = addLatticeVh(part, 1, 0);
		const oligo1 = part.createOligo(vh1, 0, 5, '#000000');
		const oligo2 = part.createOligo(vh2, 0, 5, '#000000');
		part.connectTwoOligos(oligo1, oligo2);
		// A separate, properly-registered third oligo on the same VH, later bp range.
		const oligo3 = part.createOligo(vh1, 6, 8, '#000000');
		const data = part.toJSON();

		const sourceOligo = data.oligos.find((o) => o.id === oligo1.id)!;
		const targetSeg = data.oligos.find((o) => o.id === oligo3.id)!.segments[0];
		sourceOligo.segments[0].fivePrime.connectedSegmentId = targetSeg.id;
		expectRejects(serialize(data), 'reference');
	});

	it('rejects a non-reciprocal connectedSegmentId', () => {
		const data = clone(makeValidFixture());
		const [, segB] = data.oligos[0].segments;
		// A's threePrime claims to connect to B, but B's fivePrime no longer claims A back.
		segB.fivePrime.connectedSegmentId = null;
		expectRejects(serialize(data), 'reciprocity');
	});

	it('rejects an oligo whose segments do not form one linear chain (disconnected)', () => {
		const data = clone(makeValidFixture());
		const [segA, segB] = data.oligos[0].segments;
		segA.threePrime.connectedSegmentId = null;
		segB.fivePrime.connectedSegmentId = null;
		expectRejects(serialize(data), 'reference');
	});
});

describe('validateResultShape (foldnano_json) — slots and sequence', () => {
	it('rejects a segment with empty "slots"', () => {
		const data = clone(makeValidFixture());
		data.oligos[0].segments[0].slots = [];
		expectRejects(serialize(data), 'slot-coverage');
	});

	it('rejects a segment whose "slots" only partially cover its own interval', () => {
		const data = clone(makeValidFixture());
		const seg = data.oligos[0].segments[0];
		seg.slots = seg.slots.slice(0, seg.slots.length - 1);
		expectRejects(serialize(data), 'slot-coverage');
	});

	it('rejects a segment with a slot outside its own interval', () => {
		const data = clone(makeValidFixture());
		const seg = data.oligos[0].segments[0];
		seg.slots.push({ bpIndex: 999, seq: 'A' });
		expectRejects(serialize(data), 'slot-coverage');
	});

	it('rejects a "sequence" that does not match the joined slots', () => {
		const data = clone(makeValidFixture());
		data.oligos[0].segments[0].sequence = 'ZZZZZZ';
		expectRejects(serialize(data), 'sequence-slot-mismatch');
	});
});

describe('validateResultShape (foldnano_json) — duplicate ids, references, and non-empty ids', () => {
	it('rejects a duplicate oligo id', () => {
		const data = clone(makeValidFixture());
		const part = makeHoneycombPart('Other');
		const vh = addLatticeVh(part, 5, 5);
		const other = part.createOligo(vh, 0, 3, '#000000').toJSON();
		data.oligos.push({ ...other, id: data.oligos[0].id });
		expectRejects(serialize(data));
	});

	it('rejects an oligo with an empty "segments" array as a PluginValidationError, not a raw exception', () => {
		const data = clone(makeValidFixture());
		data.oligos[0].segments = [];
		expectRejects(serialize(data));
	});

	it('rejects a duplicate segment id across different oligos', () => {
		const data = clone(makeValidFixture());
		const part = makeHoneycombPart('Other');
		const vh = addLatticeVh(part, 5, 5);
		const otherOligo = part.createOligo(vh, 0, 3, '#000000').toJSON();
		otherOligo.segments[0].id = data.oligos[0].segments[0].id;
		data.oligos.push(otherOligo);
		expectRejects(serialize(data));
	});

	it('rejects a region referencing an unknown planeId', () => {
		const data = clone(makeValidFixture());
		data.regions[0].planeId = 'no-such-plane';
		expectRejects(serialize(data), 'reference');
	});

	it('rejects a segment referencing an unknown inVirtualHelixIndex', () => {
		const data = clone(makeValidFixture());
		data.oligos[0].segments[0].inVirtualHelixIndex = 9999;
		expectRejects(serialize(data), 'reference');
	});

	it('rejects an empty string plane id', () => {
		const data = clone(makeValidFixture());
		data.planes[0].id = '';
		expectRejects(serialize(data));
	});
});

describe('validateResultShape (foldnano_json) — customModifications / overlayPlacements', () => {
	it('rejects a malformed customModifications element', () => {
		const data = clone(makeValidFixture());
		(data as unknown as Record<string, unknown>).customModifications = [{ name: 'X' }];
		expectRejects(serialize(data));
	});

	it('rejects a malformed overlayPlacements element', () => {
		const data = clone(makeValidFixture());
		(data as unknown as Record<string, unknown>).overlayPlacements = [{ id: 'a' }];
		expectRejects(serialize(data));
	});

	it('rejects a duplicate overlayPlacements id', () => {
		const data = clone(makeValidFixture());
		data.overlayPlacements = [...data.overlayPlacements!, { ...data.overlayPlacements![0] }];
		expectRejects(serialize(data));
	});
});

describe('validateResultShape (foldnano_json) — reverse-strand sequence order', () => {
	it('accepts a valid reverse-strand segment whose sequence is not equal to its ascending-bpIndex join', () => {
		const part = makeHoneycombPart('Test');
		const vh = addLatticeVh(part, 0, 0);
		// fivePrimeEndIndex (6) > threePrimeEndIndex (0) => strandIndex 1 (reverse strand).
		const oligo = part.createOligo(vh, 6, 0, '#000000');
		const seg = Array.from(oligo.segments)[0];
		seg.sequence = 'ACGTACG'; // not a palindrome — ascending vs. descending joins differ
		const data = part.toJSON();

		const result = validateResultShape(serialize(data), 'plugin-x');
		expect(result.oligos[0].segments[0].sequence).toBe('ACGTACG');
	});
});

describe('validateResultShape (foldnano_json) — strand-set references, both directions', () => {
	it('rejects a strand set referencing an unknown segment id, as a PluginValidationError', () => {
		const data = clone(makeValidFixture());
		data.virtualHelices[0].strandSets[0].segmentIds = [
			...data.virtualHelices[0].strandSets[0].segmentIds,
			'totally-fake-segment-id',
		];
		expectRejects(serialize(data), 'reference');
	});

	it('rejects a segment listed in more than one strand set', () => {
		const data = clone(makeValidFixture());
		const seg = data.oligos[0].segments[0];
		const vh = data.virtualHelices.find((v) => v.index === seg.inVirtualHelixIndex)!;
		const correctIndex = seg.fivePrime.index < seg.threePrime.index ? 0 : 1;
		const otherSS = vh.strandSets.find((ss) => ss.strandIndex !== correctIndex)!;
		otherSS.segmentIds = [...otherSS.segmentIds, seg.id];
		expectRejects(serialize(data), 'reference');
	});
});

describe('validateResultShape (foldnano_json) — listRow shape', () => {
	it('rejects a virtual helix missing "listRow"', () => {
		const data = clone(makeValidFixture()) as unknown as {
			virtualHelices: Record<string, unknown>[];
		};
		delete data.virtualHelices[0].listRow;
		expectRejects(serialize(data));
	});
});

describe('validateResultShape (foldnano_json) — non-object array elements', () => {
	it('rejects a non-object planes element', () => {
		const data = clone(makeValidFixture()) as unknown as Record<string, unknown>;
		data.planes = [null];
		expectRejects(serialize(data));
	});

	it('rejects a non-object regions element', () => {
		const data = clone(makeValidFixture()) as unknown as Record<string, unknown>;
		data.regions = [null];
		expectRejects(serialize(data));
	});

	it('rejects a non-object virtualHelices element', () => {
		const data = clone(makeValidFixture()) as unknown as Record<string, unknown>;
		data.virtualHelices = [null];
		expectRejects(serialize(data));
	});

	it('rejects a non-object strand set element', () => {
		const data = clone(makeValidFixture());
		(data.virtualHelices[0].strandSets as unknown[])[0] = null;
		expectRejects(serialize(data));
	});

	it('rejects a non-object oligos element', () => {
		const data = clone(makeValidFixture()) as unknown as Record<string, unknown>;
		data.oligos = [null];
		expectRejects(serialize(data));
	});

	it('rejects a non-object segment element', () => {
		const data = clone(makeValidFixture());
		(data.oligos[0].segments as unknown[])[0] = null;
		expectRejects(serialize(data));
	});

	it('rejects a non-object customModifications element', () => {
		const data = clone(makeValidFixture()) as unknown as Record<string, unknown>;
		data.customModifications = [null];
		expectRejects(serialize(data));
	});

	it('rejects a non-object overlayPlacements element', () => {
		const data = clone(makeValidFixture()) as unknown as Record<string, unknown>;
		data.overlayPlacements = [null];
		expectRejects(serialize(data));
	});
});
