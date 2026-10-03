import type { EditorMode } from '$lib/canvasEditor/core/modes';

export type TutorialModeInfo = {
	mode: EditorMode;
	id: string;
	label: string;
	shortcut: string;
	purpose: string;
	panel: 'select' | 'paint' | 'modification' | 'sequence' | null;
};

export const STRAND_TUTORIAL_MODES: EditorMode[] = [
	'PAN',
	'SELECT',
	'DRAW',
	'BREAK',
	'SKIP',
	'INSERT',
	'PAINT',
	'MODIFICATION',
	'SEQUENCE',
];

export const MODE_TUTORIAL_INFO: Record<EditorMode, TutorialModeInfo> = {
	PAN: {
		mode: 'PAN',
		id: 'mode-pan',
		label: 'Pan',
		shortcut: 'Cmd/Ctrl',
		purpose: 'Move around the active canvas without changing the design.',
		panel: null,
	},
	SELECT: {
		mode: 'SELECT',
		id: 'mode-select',
		label: 'Select',
		shortcut: 'v',
		purpose: 'Select ends, segments, oligos, crossovers, region headers, and virtual helix tags.',
		panel: 'select',
	},
	DRAW: {
		mode: 'DRAW',
		id: 'mode-draw',
		label: 'Draw',
		shortcut: 'n',
		purpose: 'Create strands, extend free ends, and connect compatible crossover sites.',
		panel: null,
	},
	BREAK: {
		mode: 'BREAK',
		id: 'mode-break',
		label: 'Break',
		shortcut: 'b',
		purpose: 'Split a strand segment at the clicked base position.',
		panel: null,
	},
	SKIP: {
		mode: 'SKIP',
		id: 'mode-skip',
		label: 'Skip',
		shortcut: 's',
		purpose: 'Toggle skipped bases on clicked strand positions.',
		panel: null,
	},
	INSERT: {
		mode: 'INSERT',
		id: 'mode-insert',
		label: 'Insert',
		shortcut: 'i',
		purpose: 'Add or edit inserted bases at clicked strand positions.',
		panel: null,
	},
	PAINT: {
		mode: 'PAINT',
		id: 'mode-paint',
		label: 'Paint',
		shortcut: 'p',
		purpose: 'Choose an active color, then click oligos to recolor them.',
		panel: 'paint',
	},
	MODIFICATION: {
		mode: 'MODIFICATION',
		id: 'mode-modification',
		label: 'Modification',
		shortcut: 'm',
		purpose: 'Choose a terminal modification or remove mode, then apply it to free ends.',
		panel: 'modification',
	},
	SEQUENCE: {
		mode: 'SEQUENCE',
		id: 'mode-sequence',
		label: 'Sequence',
		shortcut: 'a',
		purpose: 'Assign random, preset, custom, or clearing sequence actions to strands.',
		panel: 'sequence',
	},
	SPLIT_REGION: {
		mode: 'SPLIT_REGION',
		id: 'mode-split-region',
		label: 'Split region',
		shortcut: 'r',
		purpose: 'Split a region at a chosen virtual helix boundary.',
		panel: null,
	},
	DUPLICATE: {
		mode: 'DUPLICATE',
		id: 'mode-duplicate',
		label: 'Duplicate',
		shortcut: 'Cmd/Ctrl+D',
		purpose: 'Place a copy of the selected oligos further along the same helices.',
		panel: null,
	},
};

export function getTutorialModeInfo(mode: EditorMode): TutorialModeInfo {
	return MODE_TUTORIAL_INFO[mode];
}
