import { describe, expect, it } from 'vitest';
import { createTutorialDesign } from './TutorialPartFactory';
import { TutorialState } from './tutorialContext.svelte';

describe('interactive docs tutorial helpers', () => {
	it('tracks active mode, highlight target, and panel metadata', () => {
		const tutorial = new TutorialState('SELECT');

		expect(tutorial.activeMode).toBe('SELECT');
		expect(tutorial.highlightedTarget).toBe('mode-select');
		expect(tutorial.activePanel).toBe('select');

		tutorial.setActiveMode('PAINT');

		expect(tutorial.activeMode).toBe('PAINT');
		expect(tutorial.highlightedTarget).toBe('mode-paint');
		expect(tutorial.activePanel).toBe('paint');
	});

	it('locks and unlocks tutorial steps without losing the selected mode', () => {
		const tutorial = new TutorialState('SELECT');
		const step = {
			id: 'sequence-step',
			target: 'mode-sequence',
			mode: 'SEQUENCE' as const,
			panel: 'sequence' as const,
			caption: 'Sequence mode tutorial caption.',
		};

		tutorial.lockStep(step);

		expect(tutorial.lockedStepId).toBe('sequence-step');
		expect(tutorial.activeMode).toBe('SEQUENCE');
		expect(tutorial.highlightedTarget).toBe('mode-sequence');

		tutorial.lockStep(step);

		expect(tutorial.lockedStepId).toBeNull();
		expect(tutorial.activeMode).toBe('SEQUENCE');
	});

	it('creates an isolated demo document with a latticed part and sample oligos', () => {
		const { doc, part, region } = createTutorialDesign();

		expect(doc.parts).toEqual([part]);
		expect(region.kind).toBe('HONEYCOMB');
		expect(part.virtualHelices).toHaveLength(2);
		expect(part.oligos.size).toBe(3);
		expect(part.virtualHelices.every((vh) => vh.regionId === region.id)).toBe(true);
	});
});
