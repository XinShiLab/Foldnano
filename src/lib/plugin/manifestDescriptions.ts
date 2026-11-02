/** Plain-language notes for manifest fields, shared by the install review and My Plugins details. */

import { PYODIDE_VERSION } from './worker/pyodideConfig';
import type { PluginEnvTier } from './envClassification';

export const FORMAT_DESCRIPTIONS: Readonly<Record<string, string>> = {
	cadnano_json:
		'Plugin receives your active Design Region as cadnano JSON. Lossy — only topology and colors are passed.',
	foldnano_json: 'Plugin receives the entire Part as Foldnano JSON (lossless).',
	foldnano_edit:
		'Plugin uses the mutable Python API and emits a mutation log replayed against the Part under one undo step.',
	live: 'Reserved (not currently installable).',
};

export const APPLY_STRATEGY_DESCRIPTIONS: Readonly<Record<string, string>> = {
	previewOnly: 'Read-only — shows a diff but never writes back to your design.',
	replacePart: 'Replaces the entire Part with the plugin output. Annotations are dropped.',
	replacePartKeepAnnotationsWhereMatched:
		'Replaces the entire Part. Annotations are re-grafted where coordinates match — double-check after apply.',
	replaceRegion: 'Replaces only the active region. Annotations in that region are dropped.',
	replaceRegionKeepAnnotationsWhereMatched:
		'Replaces only the active region. Annotations are re-grafted where coordinates match — double-check after apply.',
	replayMutationLog:
		'Replays a stream of mutation operations against the existing Part (whole-part scope).',
	replayMutationLogInRegion: 'Replays mutation operations restricted to the active region.',
};

export function envTierDescription(tier: PluginEnvTier): string {
	return tier === 'standard'
		? `shared pyodide-${PYODIDE_VERSION} runtime — runs alongside other standard plugins`
		: 'dedicated runtime — only one custom-environment plugin can be active at a time';
}
