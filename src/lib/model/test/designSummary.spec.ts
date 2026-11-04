import { describe, expect, it } from 'vitest';
import FoldnanoDocument from '../document.svelte';
import { summarizeDesign } from '../io/designSummary';
import { addLatticeVh, makeHoneycombPart } from './testHelpers';

describe('summarizeDesign', () => {
	it('names the region kind, helices, scaffold length and staples', () => {
		const part = makeHoneycombPart('summary');
		const vh0 = addLatticeVh(part, 0, 0);
		const vh1 = addLatticeVh(part, 1, 0);
		const scaffold = part.createOligo(vh0, 0, 41);
		part.connectTwoOligos(scaffold, part.createOligo(vh1, 41, 0));
		scaffold.isScaffold = true;
		part.createOligo(vh0, 41, 30);
		part.createOligo(vh1, 0, 41);
		const doc = new FoldnanoDocument();
		doc.parts.push(part);

		expect(summarizeDesign(doc)).toBe(
			'1 honeycomb region · 2 helices · scaffold 84 nt · 2 staples'
		);
	});

	it('calls a design with no regions empty', () => {
		expect(summarizeDesign(new FoldnanoDocument())).toBe('Empty design');
	});
});
