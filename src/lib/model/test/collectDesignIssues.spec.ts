import { describe, it, expect } from 'vitest';
import { collectDesignIssues } from '../checks/collect';
import type { Part } from '../Part';
import { makeHoneycombPart, addLatticeVh } from './testHelpers';

const ALL = { integrity: true, simulation: true, cadnano: true };

/** A per-strand insert mismatch (integrity, simulation and cadnano all flag it) plus a lone skip. */
function partWithIssues(): Part {
	const part = makeHoneycombPart();
	const vh = addLatticeVh(part, 0, 0);
	const forward = part.createOligo(vh, 0, 30);
	part.createOligo(vh, 30, 0);
	const seg = [...forward.segments][0];
	seg.slots.find((slot) => slot.bpIndex === 10)!.seq = 'NN';
	const lone = part.createOligo(addLatticeVh(part, 1, 0), 0, 9);
	[...lone.segments][0].slots.find((slot) => slot.bpIndex === 4)!.seq = '';
	return part;
}

describe('collectDesignIssues', () => {
	it('returns nothing without a part or with every check off', () => {
		expect(collectDesignIssues(undefined, null, ALL)).toEqual([]);
		const part = partWithIssues();
		expect(
			collectDesignIssues(part, part.getDefaultRegion(), {
				integrity: false,
				simulation: false,
				cadnano: false,
			})
		).toEqual([]);
	});

	it('runs only the selected checks', () => {
		const part = partWithIssues();
		const rules = (selection: typeof ALL) =>
			collectDesignIssues(part, part.getDefaultRegion(), selection).map((i) => i.rule);

		expect(rules({ integrity: true, simulation: false, cadnano: false })).toEqual([
			'asymmetric-skip-insert',
		]);
		expect(rules({ integrity: false, simulation: true, cadnano: false })).toEqual([
			'asymmetric-skip-insert',
			'unpaired-skip-insert',
		]);
	});

	it('reports an issue several checks share only once, errors first', () => {
		const part = partWithIssues();
		const oligo = [...part.oligos][0];
		oligo.name = 'named';

		const issues = collectDesignIssues(part, part.getDefaultRegion(), ALL);

		expect(issues.filter((i) => i.rule === 'asymmetric-skip-insert')).toHaveLength(1);
		expect(issues.map((i) => i.severity)).toEqual(['error', 'error', 'info']);
	});

	it('runs the cadnano check on the active region only', () => {
		const part = partWithIssues();
		expect(
			collectDesignIssues(part, null, { integrity: false, simulation: false, cadnano: true })
		).toEqual([]);
	});
});
