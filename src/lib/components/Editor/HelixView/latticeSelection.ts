import type { LatticedDesignRegion } from '$lib/model/Part/DesignRegion';
import type { Part } from '$lib/model/Part/Part.svelte';
import type VirtualHelix from '$lib/model/VirtualHelix/VirtualHelix.svelte';

export type LatticeCell = { col: number; row: number };

export type LatticeMovePreview = {
	valid: boolean;
	reason?: 'PARITY' | 'OUT_OF_BOUNDS' | 'OCCUPIED';
	moves: { vh: VirtualHelix; from: LatticeCell; to: LatticeCell }[];
};

function uniqueIndices(indices: Iterable<number>): number[] {
	return Array.from(new Set(indices));
}

function isConstrainedConnectionBetween(vhA: VirtualHelix, vhB: VirtualHelix): boolean {
	for (const strandSet of vhA.strandSets) {
		for (const segmentId of strandSet.segmentIds) {
			const segment = vhA.inPart.getSegmentById(segmentId);
			if (!segment) continue;
			for (const end of [segment.fivePrime, segment.threePrime]) {
				const connectedEnd = end.connectedEnd;
				if (!connectedEnd) continue;
				if (connectedEnd.segment.inVirtualHelix !== vhB) continue;
				if (!end.isConstrained || !connectedEnd.isConstrained) continue;
				return true;
			}
		}
	}
	return false;
}

export function expandConstrainedLatticeSelection(
	part: Part,
	region: LatticedDesignRegion,
	seedIndices: Iterable<number>
): number[] {
	const regionVhs = part.virtualHelices.filter(
		(vh) => vh.regionId === region.id && vh.latticeCoords != null
	);
	const regionIndexSet = new Set(regionVhs.map((vh) => vh.index));
	const adjacency = new Map<number, Set<number>>();
	for (const vh of regionVhs) adjacency.set(vh.index, new Set<number>());

	for (let i = 0; i < regionVhs.length; i++) {
		const vhA = regionVhs[i];
		for (let j = i + 1; j < regionVhs.length; j++) {
			const vhB = regionVhs[j];
			if (!isConstrainedConnectionBetween(vhA, vhB) && !isConstrainedConnectionBetween(vhB, vhA)) {
				continue;
			}
			adjacency.get(vhA.index)?.add(vhB.index);
			adjacency.get(vhB.index)?.add(vhA.index);
		}
	}

	const queue = uniqueIndices(seedIndices).filter((index) => regionIndexSet.has(index));
	const visited = new Set<number>(queue);
	while (queue.length > 0) {
		const current = queue.shift()!;
		for (const neighbor of adjacency.get(current) ?? []) {
			if (visited.has(neighbor)) continue;
			visited.add(neighbor);
			queue.push(neighbor);
		}
	}

	return Array.from(visited);
}

export function previewLatticeMove(
	part: Part,
	region: LatticedDesignRegion,
	vhIndices: Iterable<number>,
	delta: LatticeCell,
	bounds: { cols: number; rows: number }
): LatticeMovePreview {
	const movingIndices = uniqueIndices(vhIndices);
	const movingSet = new Set(movingIndices);
	const moves: LatticeMovePreview['moves'] = [];
	let reason: LatticeMovePreview['reason'];

	for (const vhIndex of movingIndices) {
		const vh = part.getVhByIndex(vhIndex);
		if (!vh?.latticeCoords || vh.regionId !== region.id) continue;
		const from = { ...vh.latticeCoords };
		const to = { col: from.col + delta.col, row: from.row + delta.row };
		moves.push({ vh, from, to });
		if (to.col < 0 || to.col >= bounds.cols || to.row < 0 || to.row >= bounds.rows) {
			reason ??= 'OUT_OF_BOUNDS';
			continue;
		}
		const occupant = region.getVhByLatticeCoords(to.col, to.row);
		if (occupant && !movingSet.has(occupant.index)) {
			reason ??= 'OCCUPIED';
		}
	}

	if ((delta.col - delta.row) % 2 !== 0) {
		reason ??= 'PARITY';
	}

	return { valid: reason == null, reason, moves };
}
