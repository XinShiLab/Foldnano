import { describe, it, expect, afterEach } from 'vitest';
import { Part } from '$lib/model/Part';
import { EditorViewContext } from '$lib/components/Editor/context/EditorViewContext.svelte';
import FoldnanoDocument from '$lib/model/document.svelte';
import { addLatticeVh } from './testHelpers';
import { renamePartCmd } from '$lib/commands/assembly';

const contexts: EditorViewContext[] = [];

function twoPartContext(): { ctx: EditorViewContext; partA: Part; partB: Part } {
	const ctx = new EditorViewContext();
	contexts.push(ctx);
	const doc = new FoldnanoDocument(undefined, 'Two parts');
	const partA = Part.forType('HONEYCOMB', 'A');
	const partB = Part.forType('FREEFORM', 'B');
	addLatticeVh(partA, 0, 0);
	doc.parts.push(partA, partB);
	ctx.session.replaceCurrentDocumentForTesting(doc);
	return { ctx, partA, partB };
}

afterEach(() => {
	for (const ctx of contexts.splice(0)) ctx.destroy();
});

describe('EditorViewContext active Part', () => {
	it('defaults to the first Part', () => {
		const { ctx, partA } = twoPartContext();
		expect(ctx.activePartId).toBeNull();
		expect(ctx.activePart).toBe(partA);
		expect(ctx.activeRegion?.id).toBe(partA.getDefaultRegion().id);
	});

	it('a linked Part can be viewed and selected but not edited', () => {
		const { ctx, partA, partB } = twoPartContext();
		partB.source = { docId: 'elsewhere', partId: 'p', contentHash: 'h', linkedAt: '' };
		ctx.editorMode = 'DRAW';
		expect(ctx.canEditActivePart).toBe(true);
		ctx.setActivePart(partB.id);
		expect(ctx.canEditActivePart).toBe(false);
		expect(ctx.editorMode).toBe('SELECT');
		expect(ctx.isModeEnabled('SELECT')).toBe(true);
		expect(ctx.isModeEnabled('PAN')).toBe(true);
		expect(ctx.isModeEnabled('DRAW')).toBe(false);
		ctx.setActivePart(partA.id);
		expect(ctx.isModeEnabled('DRAW')).toBe(true);
	});

	it('switches Part and moves the active region into it', () => {
		const { ctx, partB } = twoPartContext();
		ctx.setActivePart(partB.id);
		expect(ctx.activePart).toBe(partB);
		expect(ctx.activeRegion?.id).toBe(partB.getDefaultRegion().id);
		expect(ctx.activePlane?.id).toBe(partB.getDefaultRegion().planeId);
	});

	it("drops the old Part's selections when switching", () => {
		const { ctx, partA, partB } = twoPartContext();
		const vh = partA.virtualHelices[0];
		ctx.setSelectedLatticeVhs([vh.index]);
		ctx.setSelectedFreeformVhs([7]);
		ctx.strandViewContext.recentFill = {} as never;

		ctx.setActivePart(partB.id);

		expect(ctx.selectedLatticeVhIndices.size).toBe(0);
		expect(ctx.selectedFreeformVhIndices.size).toBe(0);
		expect(ctx.strandViewContext.selected.ends.size).toBe(0);
		expect(ctx.strandViewContext.recentFill).toBeNull();
		expect(ctx.pluginCoordinator.pendingApply).toBeNull();
	});

	it('keeps selections when the Part does not change', () => {
		const { ctx, partA } = twoPartContext();
		ctx.setSelectedLatticeVhs([partA.virtualHelices[0].index]);
		ctx.setActivePart(partA.id);
		expect(ctx.selectedLatticeVhIndices.size).toBe(1);
	});

	it('falls back to the first Part for an unknown id', () => {
		const { ctx, partA, partB } = twoPartContext();
		ctx.setActivePart(partB.id);
		ctx.setActivePart('missing');
		expect(ctx.activePartId).toBeNull();
		expect(ctx.activePart).toBe(partA);
	});

	it('repairs a stale id when the active Part is removed', () => {
		const { ctx, partA, partB } = twoPartContext();
		ctx.setActivePart(partB.id);
		ctx.currentDoc.parts.splice(1, 1);
		ctx.repairActiveRegion();
		expect(ctx.activePartId).toBeNull();
		expect(ctx.activePart).toBe(partA);
		expect(ctx.activeRegion?.id).toBe(partA.getDefaultRegion().id);
	});

	it('resets to the first Part when another document is adopted', () => {
		const { ctx, partB } = twoPartContext();
		ctx.setActivePart(partB.id);
		const other = new FoldnanoDocument(undefined, 'Other');
		const otherPart = Part.forType('SQUARE', 'C');
		other.parts.push(otherPart);
		ctx.session.replaceCurrentDocumentForTesting(other);
		expect(ctx.activePartId).toBeNull();
		expect(ctx.activePart).toBe(otherPart);
	});

	it('drops an open Add Region picker when another document is adopted', () => {
		const { ctx } = twoPartContext();
		ctx.enterPlaneSelectionMode('SQUARE');
		expect(ctx.planeSelectionMode).toBe(true);
		const other = new FoldnanoDocument(undefined, 'Other');
		const otherPart = Part.forType('HONEYCOMB', 'C');
		other.parts.push(otherPart);
		ctx.session.replaceCurrentDocumentForTesting(other);
		expect(ctx.planeSelectionMode).toBe(false);
		ctx.confirmRegionCreation();
		expect(otherPart.regions).toHaveLength(1);
	});

	it('after a Part is replaced, drops its old selection and fixes a missing active region', () => {
		const { ctx, partA } = twoPartContext();
		const doc = ctx.currentDoc;
		const oligo = partA.createOligo(partA.virtualHelices[0], 0, 10);
		ctx.strandViewContext.selected.set([...oligo.allEnds]);
		const json = partA.toJSON();
		const regionId = 'replacement-region';
		json.regions = json.regions.map((r) => ({ ...r, id: regionId }));
		json.virtualHelices = json.virtualHelices.map((vh) => ({ ...vh, regionId }));
		const replacement = doc.replacePartFromJSON(partA.id, json);

		ctx.afterPartReplaced(partA.id);
		expect(ctx.strandViewContext.selected.ends.size).toBe(0);
		expect(ctx.activeRegion?.id).toBe(regionId);
		expect(ctx.activePart).toBe(replacement);
	});

	it('runs plugins against the active Part', () => {
		const { ctx, partB } = twoPartContext();
		ctx.setActivePart(partB.id);
		// The coordinator reads the Part through the getter the context installs.
		expect(
			(ctx.pluginCoordinator as unknown as { getActivePart: () => Part | null }).getActivePart()
		).toBe(partB);
	});
});

describe('EditorViewContext.startNewPart', () => {
	it('adds a Part, edits it and opens the plane picker for its first region', () => {
		const { ctx } = twoPartContext();
		ctx.startNewPart('SQUARE');
		const parts = ctx.currentDoc.parts;
		expect(parts).toHaveLength(3);
		expect(ctx.activePart).toBe(parts[2]);
		expect(ctx.currentDoc.assembly.occurrencesOf(parts[2].id)).toHaveLength(1);
		expect(ctx.planeSelectionMode).toBe(true);

		ctx.confirmRegionCreation();
		expect(ctx.planeSelectionMode).toBe(false);
		const confirmed = ctx.currentDoc.parts;
		expect(confirmed).toHaveLength(3);
		expect(ctx.activePart).toBe(confirmed[2]);
		expect(ctx.activeRegion?.id).toBe(confirmed[2].getDefaultRegion().id);
	});

	it('cancelling removes the new Part and goes back to the previous one', () => {
		const { ctx, partB } = twoPartContext();
		ctx.setActivePart(partB.id);
		ctx.startNewPart('HONEYCOMB');
		ctx.cancelRegionCreation();
		expect(ctx.currentDoc.parts.map((p) => p.name)).toEqual(['A', 'B']);
		expect(ctx.activePart?.id).toBe(partB.id);
	});
});

describe('EditorViewContext instances', () => {
	function placedContext() {
		const ctx = new EditorViewContext();
		contexts.push(ctx);
		const doc = new FoldnanoDocument(undefined, 'Placed');
		const partA = doc.addPart(Part.forType('HONEYCOMB', 'A'));
		const partB = doc.addPart(Part.forType('SQUARE', 'B'));
		const extraA = doc.assembly.add(partA.id, 'A 2');
		ctx.session.replaceCurrentDocumentForTesting(doc);
		return { ctx, doc, partA, partB, extraA };
	}

	it('edits the active Part in its first instance unless another is picked', () => {
		const { ctx, doc, partA, extraA } = placedContext();
		expect(ctx.activeOccurrence?.id).toBe(doc.assembly.occurrencesOf(partA.id)[0].id);
		ctx.editOccurrence(extraA.id);
		expect(ctx.activeOccurrence?.id).toBe(extraA.id);
	});

	it('editing an instance of another Part switches to that Part', () => {
		const { ctx, doc, partB } = placedContext();
		const [instanceB] = doc.assembly.occurrencesOf(partB.id);
		ctx.editOccurrence(instanceB.id);
		expect(ctx.activePart).toBe(partB);
		expect(ctx.activeOccurrence?.id).toBe(instanceB.id);
	});

	it('switching Part forgets the picked instance', () => {
		const { ctx, partB, extraA, partA } = placedContext();
		ctx.editOccurrence(extraA.id);
		ctx.setActivePart(partB.id);
		ctx.setActivePart(partA.id);
		expect(ctx.activeOccurrence?.id).not.toBe(extraA.id);
	});

	it('ignores a broken instance', () => {
		const { ctx, doc, partA } = placedContext();
		const broken = doc.assembly.add('missing', 'Orphan');
		ctx.editOccurrence(broken.id);
		expect(ctx.activePart).toBe(partA);
	});

	it('moving an instance opens the 3D view', () => {
		const { ctx, extraA } = placedContext();
		ctx.startMovingOccurrence(extraA.id);
		expect(ctx.movingOccurrenceId).toBe(extraA.id);
		expect(ctx.show3D).toBe(true);
		ctx.stopMovingOccurrence();
		expect(ctx.movingOccurrenceId).toBeNull();
	});
});

describe('New Part plane picker', () => {
	const planeOf = (part: Part) => {
		const { origin, u, v, normal } = part.getDefaultPlane();
		return JSON.stringify({ origin, u, v, normal });
	};

	it('previews only on the new Part, even after switching to a linked Part', () => {
		const { ctx, partA, partB } = twoPartContext();
		partB.source = { docId: 'elsewhere', partId: 'p', contentHash: 'h', linkedAt: '' };
		const linkedPlane = planeOf(partB);
		ctx.startNewPart('SQUARE');
		ctx.setActivePart(partB.id);
		expect(ctx.planeSelectionMode).toBe(false);
		expect(ctx.currentDoc.parts.map((p) => p.id)).toEqual([partA.id, partB.id]);
		ctx.selectPendingBasePlane('YZ');
		ctx.confirmRegionCreation();
		expect(planeOf(partB)).toBe(linkedPlane);
	});

	it('confirm adds the Part with its chosen plane as one undo step, and redo keeps the plane', () => {
		const { ctx } = twoPartContext();
		const undos = ctx.historyStack.numberOfUndos;
		ctx.startNewPart('SQUARE');
		ctx.selectPendingBasePlane('YZ');
		ctx.confirmRegionCreation();
		const added = ctx.activePart!;
		const chosen = planeOf(added);
		expect(ctx.currentDoc.parts).toHaveLength(3);
		expect(ctx.historyStack.numberOfUndos).toBe(undos + 1);
		ctx.historyStack.undoOnce();
		expect(ctx.currentDoc.parts).toHaveLength(2);
		ctx.historyStack.redoOnce();
		expect(planeOf(ctx.currentDoc.parts[2])).toBe(chosen);
	});

	it('cancel removes the new Part without undoing an edit made meanwhile', () => {
		const { ctx, partA } = twoPartContext();
		ctx.startNewPart('SQUARE');
		renamePartCmd(ctx.historyStack, partA, 'Renamed');
		ctx.cancelRegionCreation();
		expect(ctx.currentDoc.parts).toHaveLength(2);
		expect(partA.name).toBe('Renamed');
		expect(ctx.activePart).toBe(partA);
	});
});
