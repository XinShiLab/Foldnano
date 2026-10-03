import FoldnanoDocument from '$lib/model/document.svelte';
import type { Part } from '$lib/model/Part';
import { LatticedDesignRegion } from '$lib/model/Part';

export type TutorialDesign = {
	doc: FoldnanoDocument;
	part: Part;
	region: LatticedDesignRegion;
};

export function createTutorialDesign(): TutorialDesign {
	const doc = new FoldnanoDocument('tutorial-doc', 'Tutorial Design');
	const part = doc.addNewPart('HONEYCOMB');
	const region = part.getDefaultRegion();
	if (!(region instanceof LatticedDesignRegion)) {
		throw new Error('Tutorial design expected a latticed default region.');
	}

	const vh0 = region.addVhAtCoords(part, 0, 0);
	const vh1 = region.addVhAtCoords(part, 1, 1);

	part.createOligo(vh0, 0, 15, '#2563eb');
	part.createOligo(vh0, 28, 16, '#dc2626');
	part.createOligo(vh1, 4, 22, '#16a34a');

	return { doc, part, region };
}
