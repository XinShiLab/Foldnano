// src/editor/core/capabilities.ts
import type { EditorMode } from './modes';
import type { ViewKind } from './views';

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
