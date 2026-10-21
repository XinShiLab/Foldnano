import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import FoldnanoDocument from '$lib/model/document.svelte';
import { Plane } from '$lib/model/Part/Plane.svelte';
import { HoneycombRegion, LatticedDesignRegion } from '$lib/model/Part/DesignRegion';
import type Oligo from '$lib/model/Oligo';
import type OligoSegment from '$lib/model/Oligo/OligoSegment.svelte';
import type { Part } from '$lib/model/Part';
import { addFreeformVh, addLatticeVh } from '$lib/model/test/testHelpers';
import type { HistoryStack } from './history.svelte';
import { canonicalSnapshot, firstDifference } from './historyVerification';
import { createTestHistory, expectUndoRoundTrip } from './test/undoRoundTrip';
import * as overlays from './overlays';
import * as planes from './planes';
import * as regions from './regions';
import * as repeatGroups from './repeatGroups';
import * as strands from './strands';
import * as virtualHelices from './virtualHelices';
import * as virtualHelix from './virtualHelix';

const COMMAND_MODULES = [
	strands,
	virtualHelix,
	virtualHelices,
	regions,
	planes,
	overlays,
	repeatGroups,
];

const firstSegment = (oligo: Oligo): OligoSegment => [...oligo.segments][0];

/** Two adjacent honeycomb VHs, each with a full-length duplex (four single-segment oligos). */
function latticeScene() {
	const doc = new FoldnanoDocument('doc', 'round-trip');
	const part = doc.addNewPart('HONEYCOMB');
	const region = part.getDefaultRegion() as LatticedDesignRegion;
	const vh0 = addLatticeVh(part, 0, 0);
	const vh1 = addLatticeVh(part, 1, 0);
	const end = vh0.length - 1;
	const up0 = part.createOligo(vh0, 0, end);
	const down0 = part.createOligo(vh0, end, 0);
	const up1 = part.createOligo(vh1, 0, end);
	const down1 = part.createOligo(vh1, end, 0);
	return { doc, part, region, vh0, vh1, up0, down0, up1, down1, history: createTestHistory(doc) };
}

/** Two adjacent honeycomb VHs with nothing on them. */
function emptyLatticeScene() {
	const doc = new FoldnanoDocument('doc', 'round-trip');
	const part = doc.addNewPart('HONEYCOMB');
	const region = part.getDefaultRegion() as LatticedDesignRegion;
	const vh0 = addLatticeVh(part, 0, 0);
	const vh1 = addLatticeVh(part, 1, 0);
	return { doc, part, region, vh0, vh1, history: createTestHistory(doc) };
}

function freeformScene() {
	const doc = new FoldnanoDocument('doc', 'round-trip');
	const part = doc.addNewPart('FREEFORM');
	const vh0 = addFreeformVh(part, [0, 0, 0], [0, 0, 1]);
	const vh1 = addFreeformVh(part, [3, 0, 0], [0, 0, 1]);
	return { doc, part, vh0, vh1, history: createTestHistory(doc) };
}

function repeatScene() {
	const { doc, part, vh0, history } = freeformScene();
	const src = part.createOligo(vh0, 0, 9);
	const group = repeatGroups.createRepeatGroupCmd({ part, oligos: [src], bpOffset: 21 }, history);
	return { doc, history, part: () => doc.parts[0], groupId: group.id };
}

type Case = () => void;

/** One round-trip per exported command. The coverage test below fails when a command is added
 * without a case here. */
const CASES: Record<string, Case> = {
	// --- strands.ts ---
	drawStrandCmd: () => {
		const { doc, part, vh0, history } = emptyLatticeScene();
		expectUndoRoundTrip(doc, history, () =>
			strands.drawStrandCmd(
				{ part, vhIdx: vh0.index, startIdx: 3, endIdx: 12, color: '#123456' },
				history
			)
		);
	},
	createCrossoverCmd: () => {
		const { doc, part, vh0, vh1, history } = emptyLatticeScene();
		const fromOligo = part.createOligo(vh0, 0, 20);
		const toOligo = part.createOligo(vh1, 20, 0);
		expectUndoRoundTrip(doc, history, () =>
			strands.createCrossoverCmd(
				{ part, fromOligo, toOligo, toSegment: firstSegment(toOligo), atIndexTarget: 20 },
				history
			)
		);
	},
	breakOligoCmd: () => {
		const { doc, part, up0, history } = latticeScene();
		expectUndoRoundTrip(doc, history, () =>
			strands.breakOligoCmd({ part, oligo: up0, segment: firstSegment(up0), atIndex: 15 }, history)
		);
	},
	addSkipOrInsertionCmd: () => {
		const { doc, up0, history } = latticeScene();
		expectUndoRoundTrip(doc, history, () =>
			strands.addSkipOrInsertionCmd({ segment: firstSegment(up0), atIndex: 10, count: -1 }, history)
		);
	},
	removeSkipOrInsertionCmd: () => {
		const { doc, up0, history } = latticeScene();
		firstSegment(up0).addSkipOrInsertion(10, 2);
		expectUndoRoundTrip(doc, history, () =>
			strands.removeSkipOrInsertionCmd({ segment: firstSegment(up0), atIndex: 10 }, history)
		);
	},
	removeAllSkipsInRegionCmd: () => {
		const { doc, part, region, up0, up1, history } = latticeScene();
		firstSegment(up0).addSkipOrInsertion(10, -1);
		firstSegment(up1).addSkipOrInsertion(12, -1);
		expectUndoRoundTrip(doc, history, () =>
			strands.removeAllSkipsInRegionCmd({ part, regionId: region.id }, history)
		);
	},
	removeAllInsertsInRegionCmd: () => {
		const { doc, part, region, up0, history } = latticeScene();
		firstSegment(up0).addSkipOrInsertion(10, 2);
		expectUndoRoundTrip(doc, history, () =>
			strands.removeAllInsertsInRegionCmd({ part, regionId: region.id }, history)
		);
	},
	moveOligoEndCmd: () => {
		const { doc, part, up0, history } = latticeScene();
		const segment = firstSegment(up0);
		segment.addSkipOrInsertion(segment.threePrime.index - 2, -1);
		// Resizing past the skip clears its mirror on the complementary strand too.
		expectUndoRoundTrip(doc, history, () =>
			strands.moveOligoEndCmd(
				{ part, end: segment.threePrime, toIdx: segment.threePrime.index - 5 },
				history
			)
		);
	},
	duplicateOligosCmd: () => {
		const { doc, part, vh0, history } = emptyLatticeScene();
		const oligo = part.createOligo(vh0, 0, 9);
		expectUndoRoundTrip(doc, history, () =>
			strands.duplicateOligosCmd({ part, oligos: [oligo], delta: 21 }, history)
		);
	},
	removeOligoCmd: () => {
		const { doc, part, up0, history } = latticeScene();
		expectUndoRoundTrip(doc, history, () => strands.removeOligoCmd({ part, oligo: up0 }, history));
	},
	removeSegmentFromOligoCmd: () => {
		const { doc, part, vh0, vh1, history } = emptyLatticeScene();
		const fromOligo = part.createOligo(vh0, 0, 20);
		const toOligo = part.createOligo(vh1, 20, 0);
		part.createCrossover(fromOligo, toOligo, firstSegment(toOligo), 20);
		const segment = [...fromOligo.segments].find((s) => s.inVirtualHelix === vh1)!;
		expectUndoRoundTrip(doc, history, () =>
			strands.removeSegmentFromOligoCmd({ part, oligo: fromOligo, segment }, history)
		);
	},
	makeCrossoverCmd: () => {
		const { doc, part, vh0, history } = latticeScene();
		const site = part.potentialXoverSites(vh0.index)[0].find((s) => s.bpIdx > 10 && s.bpIdx < 30)!;
		expectUndoRoundTrip(doc, history, () =>
			strands.makeCrossoverCmd(
				{
					part,
					fromVhIdx: vh0.index,
					strandIdx: 0,
					bpIdx: site.bpIdx,
					toVhIdx: site.toVhIdx,
					right: site.right,
				},
				history
			)
		);
	},
	fillEmptyVhCmd: () => {
		const { doc, part, vh0, history } = emptyLatticeScene();
		expectUndoRoundTrip(doc, history, () =>
			strands.fillEmptyVhCmd({ part, vhIdx: vh0.index, strandIdx: 1 }, history)
		);
	},
	autoStapleCmd: () => {
		const { doc, part, region, vh0, vh1, history } = emptyLatticeScene();
		for (const vh of [vh0, vh1])
			part.fillEmptyStrandSet(vh, vh.scaffoldStrandIndex)!.isScaffold = true;
		expectUndoRoundTrip(doc, history, () => strands.autoStapleCmd({ part, region }, history));
	},
	paintOligoCmd: () => {
		const { doc, up0, history } = latticeScene();
		expectUndoRoundTrip(doc, history, () =>
			strands.paintOligoCmd({ oligo: up0, color: '#abcdef' }, history)
		);
	},
	setModificationCmd: () => {
		const { doc, up0, history } = latticeScene();
		expectUndoRoundTrip(doc, history, () =>
			strands.setModificationCmd({ end: up0.fivePrime!, modification: 'Biotin' }, history)
		);
	},
	setCustomModificationsCmd: () => {
		const { doc, part, history } = latticeScene();
		expectUndoRoundTrip(doc, history, () =>
			strands.setCustomModificationsCmd(part, [{ name: 'Alexa488', color: '#00ff00' }], history)
		);
	},
	removeCustomModificationCmd: () => {
		const { doc, part, up0, history } = latticeScene();
		part.customModifications = [{ name: 'Alexa488', color: '#00ff00' }];
		up0.fivePrime!.modification = 'Alexa488';
		expectUndoRoundTrip(doc, history, () =>
			strands.removeCustomModificationCmd(part, 'Alexa488', history)
		);
	},
	fillRandomSequenceToOligoCmd: () => {
		const { doc, up0, history } = latticeScene();
		expectUndoRoundTrip(doc, history, () =>
			strands.fillRandomSequenceToOligoCmd({ oligo: up0 }, history)
		);
	},
	fillRandomSequenceToSegmentCmd: () => {
		const { doc, up0, history } = latticeScene();
		expectUndoRoundTrip(doc, history, () =>
			strands.fillRandomSequenceToSegmentCmd({ segment: firstSegment(up0) }, history)
		);
	},
	fillSequenceToOligoCmd: () => {
		const { doc, up0, history } = latticeScene();
		expectUndoRoundTrip(doc, history, () =>
			strands.fillSequenceToOligoCmd(
				{ oligo: up0, sequence: 'ACGT'.repeat(20), lockSequence: true },
				history
			)
		);
	},
	fillSequenceToSegmentCmd: () => {
		const { doc, up0, history } = latticeScene();
		expectUndoRoundTrip(doc, history, () =>
			strands.fillSequenceToSegmentCmd(
				{ segment: firstSegment(up0), sequence: 'ACGT'.repeat(20) },
				history
			)
		);
	},
	clearOligoSequenceCmd: () => {
		const { doc, up0, history } = latticeScene();
		up0.fillSequence('ACGT'.repeat(20));
		expectUndoRoundTrip(doc, history, () => strands.clearOligoSequenceCmd({ oligo: up0 }, history));
	},
	clearSegmentSequenceCmd: () => {
		const { doc, up0, history } = latticeScene();
		up0.fillSequence('ACGT'.repeat(20));
		expectUndoRoundTrip(doc, history, () =>
			strands.clearSegmentSequenceCmd({ segment: firstSegment(up0) }, history)
		);
	},
	clearPartSequenceCmd: () => {
		const { doc, part, up0, history } = latticeScene();
		up0.fillSequence('ACGT'.repeat(20));
		expectUndoRoundTrip(doc, history, () => strands.clearPartSequenceCmd({ part }, history));
	},
	toggleOligoAsScaffoldCmd: () => {
		const { doc, up0, history } = latticeScene();
		expectUndoRoundTrip(doc, history, () =>
			strands.toggleOligoAsScaffoldCmd({ oligo: up0 }, history)
		);
	},

	// --- virtualHelix.ts / virtualHelices.ts ---
	addNewVirtualHelixCmd: () => {
		const { doc, part, region, history } = emptyLatticeScene();
		expectUndoRoundTrip(doc, history, () =>
			virtualHelix.addNewVirtualHelixCmd({ part, region, col: 2, row: 0 }, history)
		);
	},
	addFreeformVirtualHelixCmd: () => {
		const { doc, part, history } = freeformScene();
		expectUndoRoundTrip(doc, history, () =>
			virtualHelix.addFreeformVirtualHelixCmd({ part, x: 6, y: 0 }, history)
		);
	},
	fillFreeformVirtualHelixCmd: () => {
		const { doc, part, vh0, history } = freeformScene();
		expectUndoRoundTrip(doc, history, () =>
			virtualHelix.fillFreeformVirtualHelixCmd({ part, vh: vh0 }, history)
		);
	},
	addInPlaneFreeformVirtualHelixCmd: () => {
		const { doc, part, history } = freeformScene();
		expectUndoRoundTrip(doc, history, () =>
			virtualHelix.addInPlaneFreeformVirtualHelixCmd(
				{ part, start: { x: 0, y: 5 }, end: { x: 5, y: 5 } },
				history
			)
		);
	},
	moveFreeformVirtualHelixCmd: () => {
		const { doc, vh0, history } = freeformScene();
		const from = plainCopy(vh0.localFrame!);
		const to = { ...from, origin: { x: 1, y: 1, z: 0 } };
		expectUndoRoundTrip(doc, history, () =>
			virtualHelix.moveFreeformVirtualHelixCmd({ vh: vh0, from, to }, history)
		);
	},
	moveFreeformVirtualHelicesCmd: () => {
		const { doc, vh0, vh1, history } = freeformScene();
		const moves = [vh0, vh1].map((vh, i) => {
			const from = plainCopy(vh.localFrame!);
			return { vh, from, to: { ...from, origin: { x: i * 3, y: 2, z: 0 } } };
		});
		expectUndoRoundTrip(doc, history, () =>
			virtualHelix.moveFreeformVirtualHelicesCmd({ moves }, history)
		);
	},
	moveLatticeVirtualHelicesCmd: () => {
		const { doc, part, region, vh0, history } = emptyLatticeScene();
		expectUndoRoundTrip(doc, history, () =>
			virtualHelix.moveLatticeVirtualHelicesCmd(
				{
					part,
					region,
					vhIndices: [vh0.index],
					fromTo: [{ vh: vh0, from: { col: 0, row: 0 }, to: { col: 2, row: 2 } }],
					bounds: { cols: 32, rows: 30 },
				},
				history
			)
		);
	},
	deleteLatticeVirtualHelicesCmd: () => {
		const { doc, part, vh1, history } = emptyLatticeScene();
		expectUndoRoundTrip(doc, history, () =>
			virtualHelix.deleteLatticeVirtualHelicesCmd({ part, vhIndices: [vh1.index] }, history)
		);
	},
	deleteFreeformVirtualHelicesCmd: () => {
		const { doc, part, vh0, vh1, history } = freeformScene();
		const a = part.createOligo(vh0, 0, 20);
		const b = part.createOligo(vh1, 20, 0);
		part.createCrossover(a, b, firstSegment(b), 20);
		expectUndoRoundTrip(doc, history, () =>
			virtualHelix.deleteFreeformVirtualHelicesCmd({ part, vhIndices: [vh1.index] }, history)
		);
	},
	reorderVirtualHelixCmd: () => {
		const { doc, part, vh1, history } = latticeScene();
		expectUndoRoundTrip(doc, history, () =>
			virtualHelices.reorderVirtualHelixCmd({ part, history } as never, vh1.index, 0)
		);
	},

	// --- regions.ts / planes.ts ---
	addRegionAndPlaneCmd: () => {
		const { doc, part, history } = emptyLatticeScene();
		const plane = new Plane('Plane B', undefined, { x: 0, y: 0, z: 10 });
		const region = new HoneycombRegion('Honeycomb 2', plane.id);
		expectUndoRoundTrip(doc, history, () =>
			regions.addRegionAndPlaneCmd(history, part, plane, region)
		);
	},
	removeRegionAndPlaneCmd: () => {
		const { doc, part, history } = emptyLatticeScene();
		const plane = new Plane('Plane B', undefined, { x: 0, y: 0, z: 10 });
		const region = new HoneycombRegion('Honeycomb 2', plane.id);
		part.addPlane(plane);
		part.addRegion(region);
		expectUndoRoundTrip(doc, history, () =>
			regions.removeRegionAndPlaneCmd(history, part, region.id)
		);
	},
	splitRegionCmd: () => {
		const { doc, part, region, vh0, history } = latticeScene();
		expectUndoRoundTrip(doc, history, () =>
			regions.splitRegionCmd(history, part, region.id, vh0.id)
		);
	},
	changeRegionLengthCmd: () => {
		const { doc, region, history } = latticeScene();
		expectUndoRoundTrip(doc, history, () => regions.changeRegionLengthCmd(history, region, 21));
	},
	addPlaneCmd: () => {
		const { doc, part, history } = emptyLatticeScene();
		expectUndoRoundTrip(doc, history, () =>
			planes.addPlaneCmd(history, part, new Plane('Plane B'))
		);
	},
	removePlaneCmd: () => {
		const { doc, part, history } = emptyLatticeScene();
		const plane = new Plane('Plane B');
		part.addPlane(plane);
		expectUndoRoundTrip(doc, history, () => planes.removePlaneCmd(history, part, plane));
	},
	transformPlaneCmd: () => {
		const { doc, part, history } = emptyLatticeScene();
		const { id, origin, u, v, normal } = part.planes[0].toJSON();
		const before = plainCopy({ origin, u, v, normal });
		const after = { ...before, origin: { x: 5, y: 0, z: 0 } };
		expectUndoRoundTrip(doc, history, () => {
			// The gizmo moves the plane live while dragging and records one command on release.
			part.setPlaneTransform(id, after);
			planes.transformPlaneCmd(history, part, id, before, after);
		});
	},

	// --- overlays.ts ---
	setOverlayPlacementCmd: () => {
		const { doc, part, history } = emptyLatticeScene();
		expectUndoRoundTrip(doc, history, () =>
			overlays.setOverlayPlacementCmd(history, part, 'i1', '6J6J', {
				position: { x: 1, y: 0, z: 0 },
				quaternion: [0, 0, 0, 1],
			})
		);
	},
	clearOverlayPlacementCmd: () => {
		const { doc, part, history } = emptyLatticeScene();
		part.setOverlayPlacement('i1', '6J6J', {
			position: { x: 1, y: 0, z: 0 },
			quaternion: [0, 0, 0, 1],
		});
		expectUndoRoundTrip(doc, history, () => overlays.clearOverlayPlacementCmd(history, part, 'i1'));
	},

	// --- repeatGroups.ts ---
	createRepeatGroupCmd: () => {
		const { doc, part, vh0, history } = freeformScene();
		const src = part.createOligo(vh0, 0, 9);
		expectUndoRoundTrip(doc, history, () =>
			repeatGroups.createRepeatGroupCmd({ part, oligos: [src], bpOffset: 21 }, history)
		);
	},
	addRepeatInstanceCmd: () => {
		const { doc, history, part, groupId } = repeatScene();
		expectUndoRoundTrip(doc, history, () =>
			repeatGroups.addRepeatInstanceCmd({ part: part(), groupId, bpOffset: 42 }, history)
		);
	},
	removeRepeatInstanceCmd: () => {
		const { doc, history, part, groupId } = repeatScene();
		const instanceId = part().getRepeatGroup(groupId)!.instances[0].id;
		expectUndoRoundTrip(doc, history, () =>
			repeatGroups.removeRepeatInstanceCmd({ part: part(), groupId, instanceId }, history)
		);
	},
	detachRepeatGroupCmd: () => {
		const { doc, history, part, groupId } = repeatScene();
		expectUndoRoundTrip(doc, history, () =>
			repeatGroups.detachRepeatGroupCmd({ part: part(), groupId }, history)
		);
	},
	deleteRepeatGroupCmd: () => {
		const { doc, history, part, groupId } = repeatScene();
		expectUndoRoundTrip(doc, history, () =>
			repeatGroups.deleteRepeatGroupCmd({ part: part(), groupId }, history)
		);
	},
};

/** Plain-object copy of a frame (a `$state` object in the live model). */
function plainCopy<T>(value: T): T {
	return JSON.parse(JSON.stringify(value));
}

describe('undo round-trip: every command', () => {
	it('has a round-trip case for every exported command', () => {
		const commands = COMMAND_MODULES.flatMap((module) =>
			Object.entries(module)
				.filter(([name, value]) => name.endsWith('Cmd') && typeof value === 'function')
				.map(([name]) => name)
		);
		expect(
			commands.filter((name) => !(name in CASES)),
			'commands without a round-trip case'
		).toEqual([]);
		expect(
			Object.keys(CASES).filter((name) => !commands.includes(name)),
			'stale cases'
		).toEqual([]);
	});

	for (const [name, run] of Object.entries(CASES)) {
		it(name, run);
	}
});

describe('undo round-trip: adjacent-end merge', () => {
	it('merging into an oligo that continues through a crossover round-trips', () => {
		const { doc, part, vh0, vh1, history } = emptyLatticeScene();
		const a = part.createOligo(vh0, 0, 9);
		const b = part.createOligo(vh0, 10, 11);
		part.connectTwoOligos(b, part.createOligo(vh1, 11, 0));
		expectUndoRoundTrip(doc, history, () =>
			strands.createCrossoverCmd(
				{ part, fromOligo: a, toOligo: b, toSegment: firstSegment(b), atIndexTarget: 10 },
				history
			)
		);
	});
});

describe('undo round-trip: history verifier', () => {
	it('rejects an edit whose capture scope misses what it mutates', () => {
		const { doc, part, up0, history } = latticeScene();
		expect(() =>
			history.tx('Under-seeded removal', (rec) => {
				const scope = rec.capturePartScope(part, { vhIndices: [] });
				part.removeOligo(up0);
				scope.commit();
			})
		).toThrow(/does not round-trip/);
		expect(doc.parts[0].oligos.has(up0)).toBe(false);
	});

	it('rejects an edit that leaves the spatial index stale', () => {
		const { part, up0, history } = latticeScene();
		expect(() =>
			history.tx('Removal that skips the index', (rec) => {
				const scope = rec.capturePartScope(part, { oligoIds: [up0.id] });
				// Bypasses Part.removeOligo, so the spatial index still maps up0's positions.
				part.oligos.delete(up0);
				scope.commit();
			})
		).toThrow(/Derived state is stale/);
	});
});

// --- Randomised edits on real designs ---

const DESIGNS = [
	'test_files/fn_designs/10hb_tube.fn.json',
	'test_files/fn_designs/repeat_test.fn.json',
	'test_files/fn_designs/nontrivial_uiuc.fn.json',
	'test_files/fn_designs/minitest3.fn.json',
	'test_files/fn_designs/move skip bug test.fn.json',
];
const EDITS_PER_DESIGN = 36;

type RandomEdit = (
	part: Part,
	history: HistoryStack,
	pick: <T>(items: readonly T[]) => T,
	random: () => number
) => void;

const RANDOM_EDITS: Record<string, RandomEdit> = {
	break: (part, history, pick, random) => {
		const oligo = pick([...part.realOligos]);
		const segment = pick([...oligo.segments]);
		const lo = Math.min(segment.fivePrime.index, segment.threePrime.index);
		const hi = Math.max(segment.fivePrime.index, segment.threePrime.index);
		const atIndex = lo + 2 + Math.floor(random() * Math.max(1, hi - lo - 3));
		strands.breakOligoCmd({ part, oligo, segment, atIndex }, history);
	},
	removeOligo: (part, history, pick) =>
		strands.removeOligoCmd({ part, oligo: pick([...part.realOligos]) }, history),
	removeSegment: (part, history, pick) => {
		const oligo = pick([...part.realOligos]);
		strands.removeSegmentFromOligoCmd({ part, oligo, segment: pick([...oligo.segments]) }, history);
	},
	resizeEnd: (part, history, pick, random) => {
		const segment = pick([...pick([...part.realOligos]).segments]);
		const end = random() < 0.5 ? segment.fivePrime : segment.threePrime;
		strands.moveOligoEndCmd({ part, end, toIdx: end.index + (random() < 0.5 ? -2 : 2) }, history);
	},
	slide: (part, history, pick, random) => {
		const segment = pick([...pick([...part.realOligos]).segments]);
		const delta = random() < 0.5 ? -1 : 1;
		strands.moveOligoEndCmd(
			[
				{ part, end: segment.fivePrime, toIdx: segment.fivePrime.index + delta },
				{ part, end: segment.threePrime, toIdx: segment.threePrime.index + delta },
			],
			history
		);
	},
	skipOrInsert: (part, history, pick, random) => {
		const segment = pick([...pick([...part.realOligos]).segments]);
		const atIndex = pick([...segment.slots]).bpIndex;
		strands.addSkipOrInsertionCmd({ segment, atIndex, count: random() < 0.5 ? -1 : 2 }, history);
	},
	fillSequence: (part, history, pick) =>
		strands.fillRandomSequenceToOligoCmd({ oligo: pick([...part.realOligos]) }, history),
	clearSequence: (part, history, pick) =>
		strands.clearOligoSequenceCmd({ oligo: pick([...part.realOligos]) }, history),
	drawStrand: (part, history, pick, random) => {
		const vh = pick(part.virtualHelices);
		const start = Math.floor(random() * (vh.length - 12));
		const [startIdx, endIdx] = random() < 0.5 ? [start, start + 10] : [start + 10, start];
		strands.drawStrandCmd({ part, vhIdx: vh.index, startIdx, endIdx, color: '#123456' }, history);
	},
	fillEmptyStrand: (part, history, pick, random) =>
		strands.fillEmptyVhCmd(
			{ part, vhIdx: pick(part.virtualHelices).index, strandIdx: random() < 0.5 ? 0 : 1 },
			history
		),
	crossover: (part, history, pick, random) => {
		const vh = pick(part.virtualHelices);
		const strandIdx = random() < 0.5 ? 0 : 1;
		const site = pick(part.potentialXoverSites(vh.index)[strandIdx]);
		if (!site) return;
		strands.makeCrossoverCmd(
			{
				part,
				fromVhIdx: vh.index,
				strandIdx,
				bpIdx: site.bpIdx,
				toVhIdx: site.toVhIdx,
				right: site.right,
			},
			history
		);
	},
	reorder: (part, history, pick, random) =>
		virtualHelices.reorderVirtualHelixCmd(
			{ part, history } as never,
			pick(part.virtualHelices).index,
			Math.floor(random() * 4)
		),
};

describe('undo round-trip: random edits on real designs', () => {
	for (const file of DESIGNS) {
		it(file, () => {
			// Rejected random edits log why (e.g. an occupied position); that's expected here.
			vi.spyOn(console, 'error').mockImplementation(() => {});
			const doc = FoldnanoDocument.fromJSON(JSON.parse(readFileSync(file, 'utf8')));
			const history = createTestHistory(doc);
			let seed = 12345;
			const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
			const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
			const names = Object.keys(RANDOM_EDITS);
			let applied = 0;

			for (let i = 0; i < EDITS_PER_DESIGN; i++) {
				const name = names[i % names.length];
				const part = doc.parts[0];
				if (part.realOligos.length === 0) break;
				const before = canonicalSnapshot(doc.snapshot());
				const entriesBefore = history.numberOfUndos;
				try {
					RANDOM_EDITS[name](part, history, pick, random);
				} catch (err) {
					if (err instanceof Error && err.message.includes('does not round-trip')) throw err;
					// A rejected edit must leave the document exactly as it was.
					expect(
						firstDifference(canonicalSnapshot(doc.snapshot()), before),
						`rejected ${name}`
					).toBeNull();
					continue;
				}
				if (history.numberOfUndos === entriesBefore) continue;
				applied++;
				const after = canonicalSnapshot(doc.snapshot());
				history.undoOnce();
				expect(
					firstDifference(canonicalSnapshot(doc.snapshot()), before),
					`undo ${name} (#${i})`
				).toBeNull();
				history.redoOnce();
				expect(
					firstDifference(canonicalSnapshot(doc.snapshot()), after),
					`redo ${name} (#${i})`
				).toBeNull();
			}
			expect(applied, 'most random edits should apply').toBeGreaterThan(EDITS_PER_DESIGN / 3);
		});
	}
});
