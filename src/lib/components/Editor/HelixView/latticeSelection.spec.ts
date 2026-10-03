import { describe, expect, it } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import { addLatticeVh } from '$lib/model/test/testHelpers';
import type { Part } from '$lib/model/Part/Part.svelte';
import { LatticedDesignRegion } from '$lib/model/Part/DesignRegion';
import { expandConstrainedLatticeSelection, previewLatticeMove } from './latticeSelection';

function createHoneycombPart(): { part: Part; region: LatticedDesignRegion } {
	const doc = new FoldnanoDocument();
	const part = doc.addNewPart('HONEYCOMB');
	return { part, region: part.getDefaultRegion() as LatticedDesignRegion };
}

function addConstrainedCrossover(
	part: Part,
	fromCol: number,
	fromRow: number,
	toCol: number,
	toRow: number
) {
	const fromVh = addLatticeVh(part, fromCol, fromRow);
	const toVh = addLatticeVh(part, toCol, toRow);

	const strandIndex = ([0, 1] as const).find((candidate) =>
		part.potentialXoverSites(fromVh.index)[candidate].some((site) => site.toVhIdx === toVh.index)
	);
	if (strandIndex == null) {
		throw new Error('Expected a potential crossover site between adjacent lattice VHs');
	}
	const site = part
		.potentialXoverSites(fromVh.index)
		[strandIndex].find((candidate) => candidate.toVhIdx === toVh.index)!;

	if (strandIndex === 0) {
		const oligo1 = part.createOligo(fromVh, 0, site.bpIdx, '#ff0000');
		const oligo2 = part.createOligo(toVh, site.bpIdx, 0, '#00ff00');
		const segment1 = oligo1.segments.values().next().value!;
		const segment2 = oligo2.segments.values().next().value!;
		segment1.threePrime.connectTo(segment2.fivePrime);
	} else {
		const hi = Math.min(site.bpIdx + 10, fromVh.length - 1);
		const oligo1 = part.createOligo(fromVh, hi, site.bpIdx, '#ff0000');
		const oligo2 = part.createOligo(toVh, site.bpIdx, hi, '#00ff00');
		const segment1 = oligo1.segments.values().next().value!;
		const segment2 = oligo2.segments.values().next().value!;
		segment1.threePrime.connectTo(segment2.fivePrime);
	}
	return { fromVh, toVh, strandIndex };
}

describe('latticeSelection', () => {
	it('expands to the full constrained crossover group', () => {
		const { part, region } = createHoneycombPart();
		const { fromVh, toVh } = addConstrainedCrossover(part, 0, 0, 1, 0);

		expect(
			expandConstrainedLatticeSelection(part, region, [fromVh.index]).sort((a, b) => a - b)
		).toEqual([fromVh.index, toVh.index].sort((a, b) => a - b));
	});

	it('does not expand across unconstrained neighboring VHs', () => {
		const { part, region } = createHoneycombPart();
		const vh0 = addLatticeVh(part, 0, 0);
		const vh1 = addLatticeVh(part, 1, 0);

		part.createOligo(vh0, 0, 20, '#ff0000');
		part.createOligo(vh1, 20, 0, '#00ff00');

		expect(expandConstrainedLatticeSelection(part, region, [vh0.index])).toEqual([vh0.index]);
	});

	it('expands transitively across chained constrained groups', () => {
		const { part, region } = createHoneycombPart();
		const {
			fromVh: vh0,
			toVh: vh1,
			strandIndex: firstStrandIndex,
		} = addConstrainedCrossover(part, 0, 0, 1, 0);
		const vh2 = addLatticeVh(part, 2, 0);
		const strandIndex =
			([0, 1] as const).find(
				(candidate) =>
					candidate !== firstStrandIndex &&
					part.potentialXoverSites(vh1.index)[candidate].some((site) => site.toVhIdx === vh2.index)
			) ??
			([0, 1] as const).find((candidate) =>
				part.potentialXoverSites(vh1.index)[candidate].some((site) => site.toVhIdx === vh2.index)
			);
		if (strandIndex == null) throw new Error('Expected vh1/vh2 crossover site');
		const site = part
			.potentialXoverSites(vh1.index)
			[strandIndex].find((candidate) => candidate.toVhIdx === vh2.index)!;
		if (strandIndex === 0) {
			const oligo3 = part.createOligo(vh1, 0, site.bpIdx, '#0000ff');
			const oligo4 = part.createOligo(vh2, site.bpIdx, 0, '#ff00ff');
			const segment3 = oligo3.segments.values().next().value!;
			const segment4 = oligo4.segments.values().next().value!;
			segment3.threePrime.connectTo(segment4.fivePrime);
		} else {
			const hi = Math.min(site.bpIdx + 10, vh1.length - 1);
			const oligo3 = part.createOligo(vh1, hi, site.bpIdx, '#0000ff');
			const oligo4 = part.createOligo(vh2, site.bpIdx, hi, '#ff00ff');
			const segment3 = oligo3.segments.values().next().value!;
			const segment4 = oligo4.segments.values().next().value!;
			segment3.threePrime.connectTo(segment4.fivePrime);
		}

		expect(
			expandConstrainedLatticeSelection(part, region, [vh0.index]).sort((a, b) => a - b)
		).toEqual([vh0.index, vh1.index, vh2.index].sort((a, b) => a - b));
	});

	it('allows occupied targets when the occupant is inside the moving set', () => {
		const { part, region } = createHoneycombPart();
		const vh0 = addLatticeVh(part, 0, 0);
		const vh1 = addLatticeVh(part, 2, 0);

		const preview = previewLatticeMove(
			part,
			region,
			[vh0.index, vh1.index],
			{ col: 2, row: 0 },
			{ cols: 32, rows: 30 }
		);

		expect(preview.valid).toBe(true);
		expect(preview.moves.map((move) => move.to)).toEqual([
			{ col: 2, row: 0 },
			{ col: 4, row: 0 },
		]);
	});
});
