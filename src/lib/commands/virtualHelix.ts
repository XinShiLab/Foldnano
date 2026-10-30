import type { Part } from '$lib/model/Part/Part.svelte';
import { FreeformRegion, LatticedDesignRegion } from '$lib/model/Part/DesignRegion';
import type VirtualHelix from '$lib/model/VirtualHelix/VirtualHelix.svelte';
import {
	BACKBONE_RISE_NM,
	framesEqual,
	withRoll,
	type VirtualHelixFrame,
} from '$lib/model/geometry3d/dnaGeometry';
import type { HistoryStack } from './history.svelte';
import { vhRef } from './historyChanges';
import {
	previewLatticeMove,
	type LatticeCell,
} from '$lib/components/Editor/HelixView/latticeSelection';

function nextStepMultiple(value: number, step: number): number {
	return Math.ceil(value / step) * step;
}

function fillStrandSetRange(
	part: Part,
	vh: VirtualHelix,
	strandIdx: 0 | 1,
	startIdx: number,
	endIdx: number
): void {
	const lo = Math.max(0, Math.min(startIdx, endIdx));
	const hi = Math.min(vh.length - 1, Math.max(startIdx, endIdx));
	if (hi - lo < 1) return;

	const occupied = vh.strandSets[strandIdx].mergedIntervals
		.map(([a, b]) => [Math.max(lo, a), Math.min(hi, b)] as [number, number])
		.filter(([a, b]) => a <= b)
		.sort((a, b) => a[0] - b[0]);

	let cursor = lo;
	for (const [occLo, occHi] of occupied) {
		if (occLo - cursor >= 2) {
			const fivePrime = strandIdx === 0 ? cursor : occLo - 1;
			const threePrime = strandIdx === 0 ? occLo - 1 : cursor;
			part.createOligo(vh, fivePrime, threePrime);
		}
		cursor = Math.max(cursor, occHi + 1);
	}

	if (hi - cursor >= 1) {
		const fivePrime = strandIdx === 0 ? cursor : hi;
		const threePrime = strandIdx === 0 ? hi : cursor;
		part.createOligo(vh, fivePrime, threePrime);
	}
}

function fillBothStrandSets(part: Part, vh: VirtualHelix, fillLengthBp = vh.length): void {
	fillStrandSetRange(part, vh, 0, 0, fillLengthBp - 1);
	fillStrandSetRange(part, vh, 1, 0, fillLengthBp - 1);
}

export const addNewVirtualHelixCmd = (
	para: {
		part: Part;
		region: LatticedDesignRegion;
		col: number;
		row: number;
	},
	history: HistoryStack
) => {
	history.snapshotTx('Add virtual helix', () => {
		const { part, region, col, row } = para;
		region.addVhAtCoords(part, col, row);
	});
};

export const addFreeformVirtualHelixCmd = (
	para: {
		part: Part;
		x: number;
		y: number;
		z?: number;
		regionId?: string;
	},
	history: HistoryStack
) => {
	history.snapshotTx('Add virtual helix', () => {
		const { part, x, y, z = 0, regionId } = para;
		const region = regionId ? part.getRegionById(regionId) : part.getDefaultRegion();
		if (!(region instanceof FreeformRegion)) {
			throw new Error('addFreeformVirtualHelixCmd requires a FreeformRegion');
		}
		region.addVhAt(part, [x, y, z], [0, 0, 1]);
	});
};

export const fillFreeformVirtualHelixCmd = (
	para: {
		part: Part;
		vh: VirtualHelix;
		fillLengthBp?: number;
	},
	history: HistoryStack
) => {
	history.snapshotTx('Fill virtual helix', () => {
		const { part, vh, fillLengthBp = vh.length } = para;
		fillBothStrandSets(part, vh, fillLengthBp);
	});
};

export const addInPlaneFreeformVirtualHelixCmd = (
	para: {
		part: Part;
		start: { x: number; y: number };
		end: { x: number; y: number };
		regionId?: string;
	},
	history: HistoryStack
): VirtualHelix | null => {
	let created: VirtualHelix | null = null;
	history.snapshotTx('Add in-plane virtual helix', () => {
		const { part, start, end, regionId } = para;
		const dx = end.x - start.x;
		const dy = end.y - start.y;
		const distanceNm = Math.hypot(dx, dy);
		if (distanceNm < 1e-9) return;

		const fillLengthBp = Math.max(2, Math.round(distanceNm / BACKBONE_RISE_NM));
		const axis = { x: dx / distanceNm, y: dy / distanceNm, z: 0 };
		const region = regionId ? part.getRegionById(regionId) : part.getDefaultRegion();
		if (!(region instanceof FreeformRegion)) {
			throw new Error('addInPlaneFreeformVirtualHelixCmd requires a FreeformRegion');
		}
		if (fillLengthBp > region.maxBase) {
			const targetLength = nextStepMultiple(fillLengthBp, region.step);
			region.increaseVhsLengthBy(targetLength - region.maxBase);
		}
		const vh = region.addVhAt(part, [start.x, start.y, 0], [axis.x, axis.y, axis.z]);
		fillBothStrandSets(part, vh, fillLengthBp);
		created = vh;
	});
	return created;
};

export const moveFreeformVirtualHelixCmd = (
	para: { vh: VirtualHelix; from: VirtualHelixFrame; to: VirtualHelixFrame },
	history: HistoryStack
) => {
	if (framesEqual(para.from, para.to)) return;
	history.tx('Move virtual helix', (rec) => {
		rec.field(vhRef(para.vh), 'localFrame', para.from, para.to);
		para.vh.localFrame = para.to;
	});
};

export const moveFreeformVirtualHelicesCmd = (
	para: { moves: { vh: VirtualHelix; from: VirtualHelixFrame; to: VirtualHelixFrame }[] },
	history: HistoryStack
) => {
	const moves = para.moves.filter(({ from, to }) => !framesEqual(from, to));
	if (moves.length === 0) return;

	history.tx('Move virtual helices', (rec) => {
		for (const { vh, from, to } of moves) {
			rec.field(vhRef(vh), 'localFrame', from, to);
			vh.localFrame = to;
		}
	});
};

export const setFreeformVhRollCmd = (
	para: { vhs: VirtualHelix[]; rollDeg: number },
	history: HistoryStack
) => {
	const changes = para.vhs
		.filter((vh): vh is VirtualHelix & { localFrame: VirtualHelixFrame } => !!vh.localFrame)
		.map((vh) => ({ vh, from: vh.localFrame, to: withRoll(vh.localFrame, para.rollDeg) }))
		.filter(({ from, to }) => !framesEqual(from, to));
	if (changes.length === 0) return;

	history.tx(changes.length === 1 ? 'Set helix roll' : 'Set helices roll', (rec) => {
		for (const { vh, from, to } of changes) {
			rec.field(vhRef(vh), 'localFrame', from, to);
			vh.localFrame = to;
		}
	});
};

export const moveLatticeVirtualHelicesCmd = (
	para: {
		part: Part;
		region: LatticedDesignRegion;
		vhIndices: Iterable<number>;
		fromTo: { vh: VirtualHelix; from: LatticeCell; to: LatticeCell }[];
		bounds: { cols: number; rows: number };
	},
	history: HistoryStack
) => {
	const vhIndices = Array.from(new Set(para.vhIndices));
	if (vhIndices.length === 0) return;

	const delta = para.fromTo[0]
		? {
				col: para.fromTo[0].to.col - para.fromTo[0].from.col,
				row: para.fromTo[0].to.row - para.fromTo[0].from.row,
			}
		: { col: 0, row: 0 };
	for (const move of para.fromTo) {
		const moveDelta = {
			col: move.to.col - move.from.col,
			row: move.to.row - move.from.row,
		};
		if (moveDelta.col !== delta.col || moveDelta.row !== delta.row) {
			throw new Error('Invalid lattice move: inconsistent deltas');
		}
	}
	const preview = previewLatticeMove(para.part, para.region, vhIndices, delta, para.bounds);
	if (!preview.valid) {
		throw new Error(`Invalid lattice move: ${preview.reason ?? 'UNKNOWN'}`);
	}

	const moves = para.fromTo.filter(({ from, to }) => from.col !== to.col || from.row !== to.row);
	if (moves.length === 0) return;

	history.tx('Move lattice virtual helices', (rec) => {
		for (const { vh, from, to } of moves) {
			rec.field(vhRef(vh), 'latticeCoords', from, to);
			vh.latticeCoords = { ...to };
		}
		para.region.invalidateDerivedCaches();
	});
};

export const deleteLatticeVirtualHelicesCmd = (
	para: { part: Part; vhIndices: Iterable<number> },
	history: HistoryStack
) => {
	const { part } = para;
	// Only empty VHs are eligible (no segments in either strand set)
	const vhIndices = Array.from(new Set(para.vhIndices)).filter((vhIdx) => {
		const vh = part.getVhByIndex(vhIdx);
		return vh && vh.strandSets.every((ss) => ss.segmentIds.size === 0);
	});
	if (vhIndices.length === 0) return;

	history.snapshotTx('Delete virtual helices', () => {
		part.removeVirtualHelicesByIndex(vhIndices);
	});
};

export const deleteFreeformVirtualHelicesCmd = (
	para: { part: Part; vhIndices: Iterable<number> },
	history: HistoryStack
) => {
	const { part } = para;
	const vhIndices = Array.from(new Set(para.vhIndices)).filter((vhIdx) => part.getVhByIndex(vhIdx));
	if (vhIndices.length === 0) return;

	const affectedOligoIds = new Set<string>();
	for (const vhIdx of vhIndices) {
		const vh = part.getVhByIndex(vhIdx);
		if (!vh) continue;
		for (const strandSet of vh.strandSets) {
			for (const segmentId of strandSet.segmentIds) {
				const segment = part.getSegmentById(segmentId);
				const oligo = segment?.oligo;
				if (oligo) affectedOligoIds.add(oligo.id);
				for (const connected of [
					segment?.fivePrime.connectedSegment,
					segment?.threePrime.connectedSegment,
				]) {
					const connectedOligo = connected?.oligo;
					if (connectedOligo) affectedOligoIds.add(connectedOligo.id);
				}
			}
		}
	}

	history.tx('Delete virtual helices', (rec) => {
		const scope = rec.capturePartScope(part, {
			vhIndices: part.virtualHelices.map((vh) => vh.index),
			oligoIds: Array.from(affectedOligoIds),
		});
		part.removeVirtualHelicesByIndex(vhIndices);
		scope.commit();
	});
};
