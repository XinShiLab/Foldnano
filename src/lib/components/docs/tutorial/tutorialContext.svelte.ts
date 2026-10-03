import { createContext } from 'svelte';
import type { EditorMode } from '$lib/canvasEditor/core/modes';
import { getTutorialModeInfo } from './tutorialData';

export type TutorialPanelId = 'select' | 'paint' | 'modification' | 'sequence' | null;

export type TutorialStepState = {
	id: string;
	target: string;
	mode: EditorMode;
	panel: TutorialPanelId;
	caption: string;
};

export class TutorialState {
	activeMode: EditorMode = $state('SELECT');
	highlightedTarget: string = $state('mode-select');
	activeStepId: string | null = $state(null);
	lockedStepId: string | null = $state(null);
	activeCaption: string = $state(getTutorialModeInfo('SELECT').purpose);
	activePanel: TutorialPanelId = $state('select');

	constructor(initialMode: EditorMode = 'SELECT') {
		this.setActiveMode(initialMode);
	}

	setActiveMode(mode: EditorMode): void {
		const info = getTutorialModeInfo(mode);
		this.activeMode = mode;
		this.highlightedTarget = info.id;
		this.activePanel = info.panel;
		this.activeCaption = info.purpose;
	}

	focusStep(step: TutorialStepState): void {
		if (this.lockedStepId && this.lockedStepId !== step.id) return;
		this.applyStep(step);
	}

	lockStep(step: TutorialStepState): void {
		if (this.lockedStepId === step.id) {
			this.lockedStepId = null;
			return;
		}
		this.lockedStepId = step.id;
		this.applyStep(step);
	}

	private applyStep(step: TutorialStepState): void {
		this.activeStepId = step.id;
		this.activeMode = step.mode;
		this.highlightedTarget = step.target;
		this.activePanel = step.panel;
		this.activeCaption = step.caption || getTutorialModeInfo(step.mode).purpose;
	}
}

export const [getTutorialState, setTutorialState] = createContext<TutorialState>();
