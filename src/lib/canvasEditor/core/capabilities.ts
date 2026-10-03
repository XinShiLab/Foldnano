// src/editor/core/capabilities.ts
import type { EditorMode, LeafTarget } from './modes';
import type { ViewKind } from './views';

type ModeCaps = {
	/** If set, the tool only acts on these leaf kinds. (e.g., PAINT → OLIGO) */
	allowedLeafTargets?: readonly LeafTarget[];
	/** If true, the SELECT tool shows target filter UI (END/XOVER/…) */
	allowsTargetSelectionUI?: boolean;
};

/** Which modes are available per view */
export const VIEW_MODE_ENABLED: Record<ViewKind, Set<EditorMode>> = {
	ROUTING: new Set([
		'SELECT',
		'PAN',
		'DRAW',
		'BREAK',
		'PAINT',
		'INSERT',
		'SKIP',
		'MODIFICATION',
		'SEQUENCE',
		'SPLIT_REGION',
		'DUPLICATE',
	]),
	LATTICE: new Set(['SELECT', 'PAN', 'DRAW']),
};

export function modeAllowedInView(kind: ViewKind, mode: EditorMode) {
	return VIEW_MODE_ENABLED[kind].has(mode);
}

/** Per-mode hard constraints */
export const MODE_CAPS: Record<EditorMode, ModeCaps> = {
	SELECT: { allowsTargetSelectionUI: true },
	PAN: {},
	DRAW: { allowedLeafTargets: ['VH_GRID'] },
	BREAK: { allowedLeafTargets: ['SEGMENT', 'END'] }, // ends preferred if present
	PAINT: { allowedLeafTargets: ['OLIGO', 'SEGMENT'] },
	INSERT: { allowedLeafTargets: ['SEGMENT'] },
	SKIP: { allowedLeafTargets: ['SEGMENT'] },
	MODIFICATION: { allowedLeafTargets: ['END'] },
	SEQUENCE: { allowedLeafTargets: ['OLIGO', 'SEGMENT'] },
	SPLIT_REGION: {},
	DUPLICATE: {},
};

/** Helper: is this leaf kind allowed for the active mode? */
export function isLeafAllowed(mode: EditorMode, leaf: LeafTarget) {
	const caps = MODE_CAPS[mode];
	return !caps.allowedLeafTargets || caps.allowedLeafTargets.includes(leaf);
}
