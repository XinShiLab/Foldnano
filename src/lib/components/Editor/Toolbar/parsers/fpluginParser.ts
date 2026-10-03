import type { DesignFileParser, FileMeta } from './index';
import { looksLikePluginManifest } from '$lib/plugin/manifestValidation';

/** Shown when a bare manifest is opened: only zips (or the Hub) install plugins. */
export const STANDALONE_MANIFEST_MESSAGE =
	"Plugin manifests (.fplugin.json) can't be installed on their own. Install the plugin's .zip " +
	'with Import zip in the Plugins panel, or install it from the Hub.';

/**
 * Recognizes plugin manifests only to refuse them clearly, instead of letting a
 * design parser fail on them with a confusing error.
 */
export const fpluginParser: DesignFileParser = {
	id: 'fplugin',
	priority: 20,

	canParse(raw: Record<string, unknown>, meta: FileMeta): boolean {
		if (meta.secondaryExtension === 'fplugin') return true;
		return looksLikePluginManifest(raw);
	},

	parse(): never {
		throw new Error(STANDALONE_MANIFEST_MESSAGE);
	},
};
