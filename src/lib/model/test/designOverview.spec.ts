// The golden is the overview run.py renders in python/tests/test_agent_cli.py, so both sides
// read the same shape. Regenerate with UPDATE_DESIGN_OVERVIEW_GOLDEN=1.

import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { STAPLE_LENGTH_RANGE, buildDesignOverview } from '../io/designOverview';
import type { Part } from '../Part';
import { FreeformRegion } from '../Part/DesignRegion';
import { Plane } from '../Part/Plane.svelte';
import type VirtualHelix from '../VirtualHelix';
import { addLatticeVh, makeHoneycombPart } from './testHelpers';

const GOLDEN_PATH = path.resolve(
	__dirname,
	'../../plugin/python/tests/fixtures/design_overview.golden.json'
);
const UPDATING = process.env.UPDATE_DESIGN_OVERVIEW_GOLDEN === '1';

/** Two neighbouring helices, a scaffold looping across them, and three staples. */
function twoHelixDesign(): { part: Part; vh0: VirtualHelix; vh1: VirtualHelix } {
	const part = makeHoneycombPart('overview');
	const vh0 = addLatticeVh(part, 0, 0);
	const vh1 = addLatticeVh(part, 1, 0);
	const scaffold = part.createOligo(vh0, 0, 41);
	part.connectTwoOligos(scaffold, part.createOligo(vh1, 41, 0));
	scaffold.isScaffold = true;
	part.createOligo(vh0, 41, 30); // 12 nt: below the range
	part.createOligo(vh0, 25, 0); // leaves bp 26–29 of the scaffold unpaired
	part.createOligo(vh1, 0, 41);
	return { part, vh0, vh1 };
}

describe('buildDesignOverview', () => {
	it('describes the helices, the scaffold route and the staples of the region', () => {
		const { part, vh0, vh1 } = twoHelixDesign();
		const overview = buildDesignOverview(part, null)!;

		expect(overview.region.helixCount).toBe(2);
		expect(overview.region.helices.map((h) => h.number)).toEqual([vh0.index, vh1.index]);
		expect(overview.region.helices[0].cell).toEqual(vh0.latticeCoords);

		expect(overview.scaffoldCount).toBe(1);
		const [scaffold] = overview.scaffolds;
		expect(scaffold).toMatchObject({
			lengthNt: 84,
			circular: false,
			helixOrder: [vh0.index, vh1.index],
			segmentCount: 2,
			crossoverCount: 1,
			route: [
				{ helix: vh0.index, from: 0, to: 41 },
				{ helix: vh1.index, from: 41, to: 0 },
			],
			unpairedNt: 4,
			unpaired: [{ helix: vh0.index, from: 26, to: 29 }],
		});

		expect(overview.staples).toMatchObject({
			count: 3,
			lengthNt: { min: 12, median: 26, max: 42 },
			range: STAPLE_LENGTH_RANGE,
			outsideRangeCount: 1,
			outsideRange: [{ helix: vh0.index, bp: 41, lengthNt: 12 }],
		});
		expect(overview.staples.histogram).toEqual([
			{ from: 10, to: 19, count: 1 },
			{ from: 20, to: 29, count: 1 },
			{ from: 30, to: 39, count: 0 },
			{ from: 40, to: 49, count: 1 },
		]);
	});

	it('lists the helices in the order the scaffold reaches them, whatever their numbers', () => {
		const part = makeHoneycombPart('order');
		const a = addLatticeVh(part, 0, 0);
		const b = addLatticeVh(part, 1, 0);
		const c = addLatticeVh(part, 1, 1);
		const scaffold = part.createOligo(b, 41, 0);
		part.connectTwoOligos(scaffold, part.createOligo(a, 0, 41));
		part.connectTwoOligos(scaffold, part.createOligo(c, 41, 0));
		scaffold.isScaffold = true;

		const [route] = buildDesignOverview(part, null)!.scaffolds;
		expect(route.helixOrder).toEqual([b.index, a.index, c.index]);
		expect(route.crossoverCount).toBe(2);
	});

	it('counts the join that closes a circular scaffold', () => {
		const { part } = twoHelixDesign();
		const scaffold = [...part.oligos].find((o) => o.isScaffold)!;
		part.connectTwoOligos(scaffold, scaffold);

		const [route] = buildDesignOverview(part, null)!.scaffolds;
		expect(route.circular).toBe(true);
		expect(route.segmentCount).toBe(2);
		expect(route.crossoverCount).toBe(2);
	});

	it('never includes sequences, oligo names or colours', () => {
		const { part } = twoHelixDesign();
		const scaffold = [...part.oligos].find((o) => o.isScaffold)!;
		const sequence = 'GATTACA'.repeat(12);
		scaffold.updateOwnSequence(sequence);
		scaffold.name = 'secret-scaffold-name';
		scaffold.color = '#abcdef';

		const text = JSON.stringify(buildDesignOverview(part, null));
		expect(text).not.toContain('GATTACA');
		expect(text).not.toContain('secret-scaffold-name');
		expect(text).not.toContain('#abcdef');
	});

	it('caps long lists', () => {
		const part = makeHoneycombPart('caps');
		const vh = addLatticeVh(part, 0, 0);
		for (let bp = 0; bp + 2 < 42; bp += 3) part.createOligo(vh, bp, bp + 1);

		const { staples } = buildDesignOverview(part, null)!;
		expect(staples.count).toBe(14);
		expect(staples.outsideRangeCount).toBe(14);
		expect(staples.outsideRange).toHaveLength(10);
	});

	it('matches the golden run.py renders', () => {
		const { part } = twoHelixDesign();
		const plane = new Plane('Plane 2');
		part.addPlane(plane);
		part.addRegion(new FreeformRegion('Side arm', plane.id));
		const overview = { ...buildDesignOverview(part, null)! };
		overview.region = { ...overview.region, id: 'region-1' };

		if (UPDATING || !fs.existsSync(GOLDEN_PATH)) {
			fs.writeFileSync(GOLDEN_PATH, JSON.stringify(overview, null, '\t') + '\n');
		}
		expect(overview).toEqual(JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8')));
	});

	it('returns null without a region', () => {
		const part = makeHoneycombPart('empty');
		part.regions.length = 0;
		expect(buildDesignOverview(part, null)).toBeNull();
	});
});
