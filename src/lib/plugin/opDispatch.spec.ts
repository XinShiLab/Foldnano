import { describe, it, expect, beforeEach } from 'vitest';
import { dispatchOp, type MutationOp } from './opDispatch';
import FoldnanoDocument from '$lib/model/document.svelte';
import type { Part } from '$lib/model/Part';
import { LatticedDesignRegion } from '$lib/model/Part/DesignRegion';
import { addLatticeVh } from '$lib/model/test/testHelpers';

function newHoneycomb(): Part {
	const doc = new FoldnanoDocument();
	doc.addNewPart('HONEYCOMB');
	return doc.parts[0];
}

function runLog(part: Part, log: MutationOp[], activeRegionId?: string): void {
	for (const op of log) {
		dispatchOp(op, part, { activeRegionId });
	}
}

describe('opDispatch', () => {
	let part: Part;
	let regionId: string;

	beforeEach(() => {
		part = newHoneycomb();
		regionId = part.getDefaultRegion().id;
		// One pre-existing VH so simple-op tests have something to point at.
		const vh = addLatticeVh(part, 0, 0);
		part.createOligo(vh, 0, 10, '#000000');
		part.createOligo(vh, 10, 0, '#111111');
	});

	describe('simple oligo ops', () => {
		it('set_oligo_color updates the oligo', () => {
			const oligo = [...part.oligos][0];
			runLog(part, [{ op: 'set_oligo_color', oligoId: oligo.id, color: '#abcdef' }]);
			expect(oligo.color).toBe('#abcdef');
		});

		it('set_oligo_name updates the oligo', () => {
			const oligo = [...part.oligos][0];
			runLog(part, [{ op: 'set_oligo_name', oligoId: oligo.id, name: 'renamed' }]);
			expect(oligo.name).toBe('renamed');
		});

		it('set_oligo_name with null resets to default empty string', () => {
			const oligo = [...part.oligos][0];
			runLog(part, [{ op: 'set_oligo_name', oligoId: oligo.id, name: 'renamed' }]);
			runLog(part, [{ op: 'set_oligo_name', oligoId: oligo.id, name: null }]);
			expect(oligo.name).toBe('');
		});

		it('set_oligo_is_scaffold updates the scaffold flag', () => {
			const oligo = [...part.oligos][0];
			runLog(part, [{ op: 'set_oligo_is_scaffold', oligoId: oligo.id, isScaffold: true }]);
			expect(oligo.isScaffold).toBe(true);
			runLog(part, [{ op: 'set_oligo_is_scaffold', oligoId: oligo.id, isScaffold: false }]);
			expect(oligo.isScaffold).toBe(false);
		});

		it('remove_oligo removes the oligo from the part', () => {
			const oligo = [...part.oligos][0];
			const beforeCount = part.oligos.size;
			runLog(part, [{ op: 'remove_oligo', oligoId: oligo.id }]);
			expect(part.oligos.size).toBe(beforeCount - 1);
			expect(part.getOligoById(oligo.id)).toBeNull();
		});
	});

	describe('segment ops', () => {
		it('set_segment_modification sets the 5-prime modification', () => {
			const oligo = [...part.oligos][0];
			const seg = [...oligo.segments][0];
			runLog(part, [
				{
					op: 'set_segment_modification',
					oligoId: oligo.id,
					segmentId: seg.id,
					end: '5',
					modification: '/5Alex488N/',
				},
			]);
			expect(seg.fivePrime.modification).toBe('/5Alex488N/');
		});

		it('set_segment_modification sets the 3-prime modification', () => {
			const oligo = [...part.oligos][0];
			const seg = [...oligo.segments][0];
			runLog(part, [
				{
					op: 'set_segment_modification',
					oligoId: oligo.id,
					segmentId: seg.id,
					end: '3',
					modification: '/3Bio/',
				},
			]);
			expect(seg.threePrime.modification).toBe('/3Bio/');
		});

		it('set_segment_modification with null clears the modification', () => {
			const oligo = [...part.oligos][0];
			const seg = [...oligo.segments][0];
			runLog(part, [
				{
					op: 'set_segment_modification',
					oligoId: oligo.id,
					segmentId: seg.id,
					end: '5',
					modification: '/5Alex488N/',
				},
			]);
			runLog(part, [
				{
					op: 'set_segment_modification',
					oligoId: oligo.id,
					segmentId: seg.id,
					end: '5',
					modification: null,
				},
			]);
			expect(seg.fivePrime.modification).toBeNull();
		});

		it('remove_segment removes the segment from the part', () => {
			const vh = addLatticeVh(part, 1, 0);
			const oligoA = part.createOligo(vh, 0, 5, '#aabbcc');
			const oligoB = part.createOligo(vh, 6, 10, '#ddeeff');
			const segA = [...oligoA.segments][0];
			const segB = [...oligoB.segments][0];
			// Merge via connect op so segA has a valid owning oligo with 2 segments
			runLog(part, [{ op: 'connect', fromSegmentId: segA.id, toSegmentId: segB.id }]);
			expect(segA.oligo).not.toBeNull();
			const ownerOligoId = segA.oligo!.id;
			runLog(part, [{ op: 'remove_segment', oligoId: ownerOligoId, segmentId: segA.id }]);
			expect(part.getSegmentById(segA.id)).toBeNull();
		});
	});

	describe('slot-level ops', () => {
		it('set_slot_sequence assigns a base to a specific bp', () => {
			const oligo = [...part.oligos][0];
			const seg = [...oligo.segments][0];
			runLog(part, [
				{ op: 'set_slot_sequence', oligoId: oligo.id, segmentId: seg.id, bpIndex: 5, seq: 'A' },
			]);
			expect(seg.slotForBp(5)?.seq).toBe('A');
		});

		it('set_slot_skip creates a skip at a bp', () => {
			const oligo = [...part.oligos][0];
			const seg = [...oligo.segments][0];
			const compSeg = [...part.oligos][1].segments.values().next().value!;
			runLog(part, [
				{ op: 'set_slot_skip', oligoId: oligo.id, segmentId: seg.id, bpIndex: 3, skip: true },
			]);
			expect(seg.slotForBp(3)?.seq).toBe('');
			expect(compSeg.slotForBp(3)?.seq).toBe('');
		});

		it('set_slot_skip with false removes a skip', () => {
			const oligo = [...part.oligos][0];
			const seg = [...oligo.segments][0];
			runLog(part, [
				{ op: 'set_slot_skip', oligoId: oligo.id, segmentId: seg.id, bpIndex: 3, skip: true },
			]);
			runLog(part, [
				{ op: 'set_slot_skip', oligoId: oligo.id, segmentId: seg.id, bpIndex: 3, skip: false },
			]);
			expect(seg.slotForBp(3)?.seq.length).toBe(1);
		});

		it('add_skip_or_insertion adds inserted bases to both strands, cumulatively', () => {
			const seg = [...[...part.oligos][0].segments][0];
			const compSeg = [...[...part.oligos][1].segments][0];
			compSeg.slotForBp(4)!.seq = 'G';
			const insert = { op: 'add_skip_or_insertion', segmentId: seg.id, bpIndex: 4 } as const;
			runLog(part, [
				{ ...insert, count: 1 },
				{ ...insert, count: 2 },
			]);
			expect(seg.slotForBp(4)?.seq).toHaveLength(4);
			// The complementary strand keeps its base and gains the same number of Ns.
			expect(compSeg.slotForBp(4)?.seq).toBe('GNNN');
		});

		it('add_skip_or_insertion with count -1 adds a skip on both strands', () => {
			const seg = [...[...part.oligos][0].segments][0];
			const compSeg = [...[...part.oligos][1].segments][0];
			runLog(part, [{ op: 'add_skip_or_insertion', segmentId: seg.id, bpIndex: 6, count: -1 }]);
			expect(seg.slotForBp(6)?.seq).toBe('');
			expect(compSeg.slotForBp(6)?.seq).toBe('');
			expect(() =>
				runLog(part, [{ op: 'add_skip_or_insertion', segmentId: seg.id, bpIndex: 6, count: 0 }])
			).toThrow(/count/);
		});

		it('set_slot_insertion creates an insertion on a normal slot (create path)', () => {
			const oligo = [...part.oligos][0];
			const seg = [...oligo.segments][0];
			expect(seg.slotForBp(5)?.seq.length).toBe(1); // starts as normal 1-char slot
			runLog(part, [
				{
					op: 'set_slot_insertion',
					oligoId: oligo.id,
					segmentId: seg.id,
					bpIndex: 5,
					insertion: 'NAT',
				},
			]);
			expect(seg.slotForBp(5)?.seq).toBe('NAT');
			const compSeg = [...part.oligos][1].segments.values().next().value!;
			expect(compSeg.slotForBp(5)?.seq).toBe('NNN');
		});

		it('set_slot_insertion updates an existing insertion (update path)', () => {
			const oligo = [...part.oligos][0];
			const seg = [...oligo.segments][0];
			runLog(part, [
				{
					op: 'set_slot_insertion',
					oligoId: oligo.id,
					segmentId: seg.id,
					bpIndex: 5,
					insertion: 'NAT',
				},
			]);
			runLog(part, [
				{
					op: 'set_slot_insertion',
					oligoId: oligo.id,
					segmentId: seg.id,
					bpIndex: 5,
					insertion: 'NCAT',
				},
			]);
			expect(seg.slotForBp(5)?.seq).toBe('NCAT');
		});
	});

	describe('VH ops', () => {
		it('set_vh_local_frame stores the frame on the VH', () => {
			const vh = part.virtualHelices[0];
			const frame = {
				origin: [0, 0, 0] as [number, number, number],
				axis: [0, 0, 1] as [number, number, number],
				radial0: [1, 0, 0] as [number, number, number],
			};
			runLog(part, [
				{
					op: 'set_vh_local_frame',
					vhId: vh.id,
					localFrame: frame as unknown as Record<string, unknown>,
				},
			]);
			expect(vh.localFrame).toEqual(frame);
		});

		it('set_vh_local_frame with null clears the frame', () => {
			const vh = part.virtualHelices[0];
			const frame = {
				origin: [0, 0, 0] as [number, number, number],
				axis: [0, 0, 1] as [number, number, number],
				radial0: [1, 0, 0] as [number, number, number],
			};
			runLog(part, [
				{
					op: 'set_vh_local_frame',
					vhId: vh.id,
					localFrame: frame as unknown as Record<string, unknown>,
				},
			]);
			runLog(part, [{ op: 'set_vh_local_frame', vhId: vh.id, localFrame: null }]);
			expect(vh.localFrame).toBeUndefined();
		});
	});

	describe('id-sharing across ops', () => {
		it('add_vh_at_coords adopts the plugin-supplied id; subsequent ops resolve directly', () => {
			const log: MutationOp[] = [
				{
					op: 'add_vh_at_coords',
					regionId,
					row: 1,
					col: 0,
					newVhId: 'py-vh-A',
				},
				{
					op: 'create_segment',
					vhId: 'py-vh-A',
					fiveIndex: 0,
					threeIndex: 5,
					color: '#33cc66',
					isScaffold: false,
					name: null,
					newOligoId: 'py-oligo-X',
					newSegmentId: 'py-seg-X',
				},
			];
			runLog(part, log);
			const newVh = part.virtualHelices.find((v) => v.id === 'py-vh-A')!;
			expect(newVh).toBeDefined();
			expect(newVh.regionId).toBe(regionId);
			const newOligo = [...part.oligos].find((o) => o.id === 'py-oligo-X')!;
			expect(newOligo).toBeDefined();
			const seg = [...newOligo.segments][0];
			expect(seg.id).toBe('py-seg-X');
			expect(seg.inVirtualHelix.id).toBe('py-vh-A');
		});

		it('remove_vhs targets the right helix by id, regardless of JS-assigned index', () => {
			const log: MutationOp[] = [
				{
					op: 'add_vh_at_coords',
					regionId,
					row: 2,
					col: 0,
					newVhId: 'py-vh-B',
				},
				{ op: 'remove_vhs', vhIds: ['py-vh-B'] },
			];
			const before = part.virtualHelices.length;
			runLog(part, log);
			expect(part.virtualHelices.length).toBe(before); // added then removed
		});

		it('rejects a duplicate newVhId before mutating the part', () => {
			const before = part.virtualHelices.length;
			expect(() =>
				runLog(part, [
					{
						op: 'add_vh_at_coords',
						regionId,
						row: 2,
						col: 0,
						newVhId: part.virtualHelices[0].id,
					},
				])
			).toThrow(/already exists/);
			expect(part.virtualHelices.length).toBe(before);
		});
	});

	describe('segment-level connect', () => {
		it('connect routes through connectSegmentEnds (segment-specific)', () => {
			const vh = addLatticeVh(part, 1, 0);
			const oligoA = part.createOligo(vh, 0, 10, '#aa0000');
			const oligoB = part.createOligo(vh, 11, 20, '#00aa00');
			const segA = [...oligoA.segments][0];
			const segB = [...oligoB.segments][0];
			runLog(part, [{ op: 'connect', fromSegmentId: segA.id, toSegmentId: segB.id }]);
			// The two oligos should have merged into one.
			expect(part.oligos.has(oligoA) || part.oligos.has(oligoB)).toBe(true);
			expect(part.oligos.has(oligoA) && part.oligos.has(oligoB)).toBe(false);
		});

		it('merging adjacent ends keeps the downstream crossover in the merged oligo', () => {
			const vh = addLatticeVh(part, 1, 0);
			const vh2 = addLatticeVh(part, 2, 0);
			part.createOligo(vh, 0, 9, '#aa0000', { oligoId: 'oA', segmentId: 'sA' });
			part.createOligo(vh, 10, 20, '#00aa00', { oligoId: 'oB', segmentId: 'sB' });
			part.createOligo(vh2, 20, 10, '#0000aa', { oligoId: 'oC', segmentId: 'sC' });
			runLog(part, [
				{ op: 'connect', fromSegmentId: 'sB', toSegmentId: 'sC' },
				{ op: 'connect', fromSegmentId: 'sA', toSegmentId: 'sB' },
			]);
			const merged = part.getOligoById('oA');
			expect([...merged!.segments].map((s) => s.id)).toEqual(['sA', 'sC']);
			expect(part.getOligoById('oB')).toBeNull();
			expect(part.getSegmentById('sB')).toBeNull();
			expect(part.getSegmentById('sA')!.threePrime.index).toBe(20);
		});

		it('connect rejects an end that is already connected', () => {
			const vh = addLatticeVh(part, 1, 0);
			part.createOligo(vh, 0, 9, '#aa0000', { oligoId: 'oA', segmentId: 'sA' });
			part.createOligo(vh, 10, 20, '#00aa00', { oligoId: 'oB', segmentId: 'sB' });
			part.createOligo(vh, 30, 40, '#0000aa', { oligoId: 'oC', segmentId: 'sC' });
			runLog(part, [{ op: 'connect', fromSegmentId: 'sA', toSegmentId: 'sC' }]);
			expect(() =>
				runLog(part, [{ op: 'connect', fromSegmentId: 'sA', toSegmentId: 'sB' }])
			).toThrow(/must be free/);
		});
	});

	describe('region scope', () => {
		it('throws when an op targets a VH outside the active region', () => {
			const oligo = [...part.oligos][0];
			expect(() =>
				runLog(
					part,
					[{ op: 'set_oligo_color', oligoId: oligo.id, color: '#ff0000' }],
					'some-other-region'
				)
			).toThrow(/active region/);
		});

		it('add_vh_at_coords rejects regionId mismatch when active region is set', () => {
			expect(() =>
				runLog(
					part,
					[
						{
							op: 'add_vh_at_coords',
							regionId,
							row: 3,
							col: 0,
							newVhId: 'py-vh-C',
						},
					],
					'other-region'
				)
			).toThrow();
		});
	});

	describe('id propagation across ops', () => {
		it('subsequent ops on a created oligo resolve by the supplied id', () => {
			const vh = addLatticeVh(part, 1, 1);
			const log: MutationOp[] = [
				{
					op: 'create_segment',
					vhId: vh.id,
					fiveIndex: 0,
					threeIndex: 7,
					color: '#cc6633',
					isScaffold: false,
					name: null,
					newOligoId: 'py-oligo-K',
					newSegmentId: 'py-seg-K',
				},
				{ op: 'set_oligo_color', oligoId: 'py-oligo-K', color: '#112233' },
				{ op: 'set_oligo_name', oligoId: 'py-oligo-K', name: 'kappa' },
			];
			runLog(part, log);
			const oligo = [...part.oligos].find((o) => o.id === 'py-oligo-K')!;
			expect(oligo).toBeDefined();
			expect(oligo.color).toBe('#112233');
			expect(oligo.name).toBe('kappa');
		});

		it('rejects a duplicate newOligoId before mutating the part', () => {
			const vh = addLatticeVh(part, 1, 1);
			const existingOligo = [...part.oligos][0];
			const beforeOligos = part.oligos.size;
			const beforeSegments = vh.strandSets[0].segmentIds.size + vh.strandSets[1].segmentIds.size;

			expect(() =>
				runLog(part, [
					{
						op: 'create_segment',
						vhId: vh.id,
						fiveIndex: 0,
						threeIndex: 7,
						color: '#cc6633',
						isScaffold: false,
						name: null,
						newOligoId: existingOligo.id,
						newSegmentId: 'py-seg-new',
					},
				])
			).toThrow(/already exists/);
			expect(part.oligos.size).toBe(beforeOligos);
			expect(vh.strandSets[0].segmentIds.size + vh.strandSets[1].segmentIds.size).toBe(
				beforeSegments
			);
			expect(part.getSegmentById('py-seg-new')).toBeNull();
		});

		it('rejects a duplicate newSegmentId before mutating the part', () => {
			const vh = addLatticeVh(part, 1, 1);
			const existingSegment = [...[...part.oligos][0].segments][0];
			const beforeOligos = part.oligos.size;
			const beforeSegments = vh.strandSets[0].segmentIds.size + vh.strandSets[1].segmentIds.size;

			expect(() =>
				runLog(part, [
					{
						op: 'create_segment',
						vhId: vh.id,
						fiveIndex: 0,
						threeIndex: 7,
						color: '#cc6633',
						isScaffold: false,
						name: null,
						newOligoId: 'py-oligo-new',
						newSegmentId: existingSegment.id,
					},
				])
			).toThrow(/already exists/);
			expect(part.oligos.size).toBe(beforeOligos);
			expect(vh.strandSets[0].segmentIds.size + vh.strandSets[1].segmentIds.size).toBe(
				beforeSegments
			);
			expect([...part.oligos].find((o) => o.id === 'py-oligo-new')).toBeUndefined();
		});
	});

	it('region instance is the expected lattice kind', () => {
		// sanity — guards against a refactor breaking the addVhAtCoords path.
		expect(part.getDefaultRegion()).toBeInstanceOf(LatticedDesignRegion);
	});
});
