import listing from './community/listing.json';
import { corePlugins } from './corePlugins';
import { PLUGIN_HTTPS_URL_PATTERN, validateManifest } from './manifestValidation';
import { validatePluginIconSvg } from './pluginIcon';
import type { PluginManifest } from './types';

/**
 * A plugin from the community listing (`XinShiLab/foldnano-plugins`), copied into the app at a
 * pinned commit by `pnpm plugins:sync-listing`. Display fields repeat the zip's fplugin.json; the
 * zip itself is fetched at install and must match `zip.sha256`.
 */
export interface CommunityPluginEntry extends Pick<
	PluginManifest,
	| 'id'
	| 'version'
	| 'name'
	| 'description'
	| 'tags'
	| 'authors'
	| 'maintainers'
	| 'license'
	| 'repository'
	| 'upstream'
> {
	readonly iconSvg?: string;
	readonly zip: { readonly url: string; readonly sha256: string };
	readonly listed: string;
}

export const COMMUNITY_LISTING_SOURCE: { readonly repo: string; readonly commit: string } =
	listing.source;

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Checks an entry with the app's own manifest rules (id, version, tags, credit fields) and the
 * icon rules. Unknown keys are ignored so a newer listing format can add fields.
 */
export function validateCommunityEntry(raw: unknown): CommunityPluginEntry {
	if (!raw || typeof raw !== 'object') throw new Error('Listing entry must be an object');
	const e = raw as Record<string, unknown>;
	const display = validateManifest(
		{
			schemaVersion: 2,
			id: e.id,
			version: e.version,
			name: e.name,
			description: e.description,
			tags: e.tags,
			authors: e.authors,
			maintainers: e.maintainers,
			license: e.license,
			repository: e.repository,
			upstream: e.upstream,
			format: 'foldnano_json',
			applyStrategy: 'previewOnly',
		},
		{ allowNoEntrypoint: true }
	);
	if (!display.repository) throw new Error(`${display.id}: "repository" is required`);
	const zip = e.zip as Record<string, unknown> | undefined;
	if (typeof zip?.url !== 'string' || !PLUGIN_HTTPS_URL_PATTERN.test(zip.url))
		throw new Error(`${display.id}: zip.url must be an https URL`);
	if (typeof zip.sha256 !== 'string' || !SHA256_PATTERN.test(zip.sha256))
		throw new Error(`${display.id}: zip.sha256 must be 64 lowercase hex digits`);
	if (typeof e.listed !== 'string') throw new Error(`${display.id}: "listed" is required`);
	const entry: CommunityPluginEntry = {
		id: display.id,
		version: display.version,
		name: display.name,
		description: display.description,
		tags: display.tags,
		authors: display.authors,
		maintainers: display.maintainers,
		license: display.license,
		repository: display.repository,
		upstream: display.upstream,
		zip: { url: zip.url, sha256: zip.sha256 },
		listed: e.listed,
	};
	if (e.iconSvg === undefined) return entry;
	if (typeof e.iconSvg !== 'string') throw new Error(`${display.id}: iconSvg must be a string`);
	return { ...entry, iconSvg: validatePluginIconSvg(e.iconSvg) };
}

const coreIds = new Set(corePlugins.map((m) => m.id));

// A plugin moving from core to the listing shows once, as core, until it leaves core.
export const communityPlugins: CommunityPluginEntry[] = listing.plugins
	.map(validateCommunityEntry)
	.filter((entry) => !coreIds.has(entry.id));
