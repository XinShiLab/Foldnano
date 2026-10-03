/**
 * Shared manifest validation for the Python plugin system.
 *
 * Every install path (Hub pointers, local zips, stored-record checks) calls
 * validateManifest() so validation logic stays in one place.
 */

import type {
	PluginFieldDef,
	PluginManifest,
	PluginParamDef,
	PluginSidePanelFieldDef,
	PluginSidePanelIcon,
	PluginSidePanelManifest,
} from './types';
import { isStepAligned, normalizeSelectOptions, stepBase } from './fieldValidation';
import { validateNetwork } from './networkPolicy';

/**
 * Manifest schema version this app reads and writes. Bump it (and publish
 * static/schemas/fplugin-v<N>.schema.json) whenever a field is added or its
 * meaning changes, so older apps refuse newer manifests instead of ignoring
 * what they don't understand. See docs/python-plugin-system.md § Manifest versioning.
 */
export const MANIFEST_SCHEMA_VERSION = 1;

/** Top-level fields a v1 manifest may contain, besides `x-`-prefixed extensions. */
export const MANIFEST_V1_FIELDS: readonly string[] = [
	'$schema',
	'schemaVersion',
	'id',
	'name',
	'version',
	'format',
	'applyStrategy',
	'entrypoint',
	'entrypointUrl',
	'requirements',
	'network',
	'description',
	'parameters',
	'sidePanel',
];

/** Fields allowed inside nested v1 objects (no `x-` extensions below the top level). */
export const MANIFEST_V1_NESTED_FIELDS = {
	field: [
		'id',
		'label',
		'type',
		'default',
		'description',
		'required',
		'min',
		'max',
		'step',
		'options',
	],
	selectOption: ['value', 'label'],
	sidePanel: ['type', 'title', 'icon', 'form', 'codeEditor'],
	sidePanelForm: ['fields', 'submitLabel'],
	sidePanelCodeEditor: ['filename', 'initialCode', 'execution'],
} as const satisfies Record<string, readonly string[]>;

/** Author-owned metadata that the app ignores, e.g. "x-homepage". Top level only. */
const EXTENSION_FIELD_RE = /^x-/;

/** Throws on the first key of `obj` that isn't in `known`. */
function rejectUnknownFields(
	obj: Record<string, unknown>,
	known: readonly string[],
	where: string,
	allowExtensions = false
): void {
	for (const key of Object.keys(obj)) {
		if (known.includes(key) || (allowExtensions && EXTENSION_FIELD_RE.test(key))) continue;
		throw new Error(
			`Unknown field "${key}" in ${where}. Check the spelling` +
				(allowExtensions ? ', or prefix your own metadata with "x-".' : '.')
		);
	}
}

/**
 * Version a manifest without `schemaVersion` is read as — always 1, never the
 * current version. Safe because unknown fields are rejected (a newer field
 * without its version fails loudly) and field meanings never change.
 */
export const DEFAULT_MANIFEST_SCHEMA_VERSION = 1;

/** A manifest with its `schemaVersion` filled in (DEFAULT_MANIFEST_SCHEMA_VERSION when absent). */
export function withSchemaVersion<T extends { schemaVersion?: unknown }>(
	manifest: T
): T & { schemaVersion: NonNullable<T['schemaVersion']> | 1 } {
	return { ...manifest, schemaVersion: manifest.schemaVersion ?? DEFAULT_MANIFEST_SCHEMA_VERSION };
}

/** Checks `schemaVersion` first, so a too-new manifest is refused before its fields are read. */
function validateSchemaVersion(m: Record<string, unknown>): void {
	const v = m.schemaVersion;
	if (v === undefined) return; // read as DEFAULT_MANIFEST_SCHEMA_VERSION
	if (typeof v !== 'number' || !Number.isInteger(v) || v < 1)
		throw new Error('"schemaVersion" must be a positive integer');
	if (v > MANIFEST_SCHEMA_VERSION)
		throw new Error(
			`This plugin needs a newer version of Foldnano (manifest schema version ${v}; ` +
				`this version supports up to ${MANIFEST_SCHEMA_VERSION}). Reload or update Foldnano, ` +
				'then install the plugin again.'
		);
}

export const INSTALLABLE_FORMATS = ['cadnano_json', 'foldnano_json', 'foldnano_mini'] as const;

/**
 * When non-null, non-wheel requirements must appear in this list.
 * null = permissive (no restriction). Tighten once a supported-packages list is established.
 */
export const SUPPORTED_REQUIREMENTS_ALLOWLIST: readonly string[] | null = null;
export const VALID_STRATEGIES = [
	'replacePartKeepAnnotationsWhereMatched',
	'replacePart',
	'replaceRegionKeepAnnotationsWhereMatched',
	'replaceRegion',
	'replayMutationLog',
	'replayMutationLogInRegion',
	'previewOnly',
] as const;

const REPLAY_STRATEGIES = new Set<string>(['replayMutationLog', 'replayMutationLogInRegion']);
const PART_REPLACE_STRATEGIES = new Set<string>([
	'replacePartKeepAnnotationsWhereMatched',
	'replacePart',
]);
const REGION_REPLACE_STRATEGIES = new Set<string>([
	'replaceRegionKeepAnnotationsWhereMatched',
	'replaceRegion',
]);
const VALID_SIDE_PANEL_TYPES = ['form', 'codeEditor'] as const;
const VALID_SIDE_PANEL_ICONS = ['form', 'code', 'analysis'] as const;
const VALID_CODE_EDITOR_EXECUTION_MODES = ['input', 'entrypoint'] as const;

/**
 * How a plugin's code is delivered.
 * - packaged: a zip bundle (fplugin.json + plugin.py + assets) — the single
 *   file/URL-delivered format. Cached in IndexedDB at install time.
 * - runtime-code: sidePanel.codeEditor plugins with execution "entrypoint"
 *   (e.g. Script Lab) — the editor buffer is the source; the manifest carries
 *   only a placeholder inline entrypoint.
 * - legacy: pre-unification shapes (inline entrypoint on a normal plugin, or a
 *   raw .py entrypointUrl). No longer installable; existing records must be
 *   re-imported as a plugin zip.
 */
export type PluginPackageKind = 'packaged' | 'runtime-code' | 'legacy';

/** True when the manifest's code is supplied at run time from the code editor. */
export function isRuntimeCodeManifest(manifest: {
	sidePanel?: { codeEditor?: { execution?: string } };
}): boolean {
	return manifest.sidePanel?.codeEditor?.execution === 'entrypoint';
}

/**
 * Pathname of an entrypointUrl, tolerating relative URLs and query strings
 * (so `plugin.zip?v=2` is still recognised as a zip). Returns null when the
 * value cannot be parsed as a URL at all.
 */
function entrypointUrlPathname(url: string): string | null {
	try {
		return new URL(url, 'http://relative.invalid').pathname;
	} catch {
		return null;
	}
}

function entrypointUrlIsZip(url: string): boolean {
	return entrypointUrlPathname(url)?.toLowerCase().endsWith('.zip') ?? false;
}

/**
 * True when `url` resolves to the app's own origin. Resolving (rather than
 * pattern-matching "http(s)://") also catches protocol-relative "//host/…" and
 * whitespace-prefixed URLs, which fetch() would send elsewhere. Fails closed
 * without a page location.
 */
export function isSameOriginUrl(url: string): boolean {
	const loc = globalThis.location;
	if (!loc?.origin || loc.origin === 'null') return false;
	try {
		return new URL(url, loc.href).origin === loc.origin;
	} catch {
		return false;
	}
}

/** Shown when a manifest points outside the app: the supported alternative. */
const LOCAL_ZIP_HINT =
	"Installing plugins from other websites isn't supported: download the plugin's .zip " +
	'and use Import zip instead.';

/**
 * Classify an already-validated (or stored) manifest by package kind.
 * Stored manifests from before the zip unification may classify as 'legacy'.
 */
export function classifyManifest(manifest: {
	entrypoint?: string;
	entrypointUrl?: string;
	sidePanel?: { codeEditor?: { execution?: string } };
}): PluginPackageKind {
	if (isRuntimeCodeManifest(manifest)) {
		return manifest.entrypointUrl ? 'legacy' : 'runtime-code';
	}
	if (manifest.entrypoint) return 'legacy';
	if (manifest.entrypointUrl && !entrypointUrlIsZip(manifest.entrypointUrl)) return 'legacy';
	return 'packaged';
}

/**
 * Validate a raw (unknown) manifest object and return it typed as PluginManifest.
 * Throws a descriptive Error on any validation failure.
 *
 * Pass `{ allowNoEntrypoint: true }` for the manifest found inside a plugin
 * zip — the installer verifies plugin.py exists in the zip itself, so that
 * manifest is allowed to omit `entrypointUrl`.
 */
/**
 * Plugin id: a letter, then letters, digits, `.`, `_` or `-` (at most 64). It keys the registry,
 * IndexedDB, worker requests and side-panel tabs. Checked at install only, like the version rule
 * below: plugins installed before these rules keep working.
 */
export const PLUGIN_ID_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;

/** Semantic version (semver.org), e.g. `1.2.3` or `2.0.0-beta.1`. Keys the plugin file cache. */
export const PLUGIN_VERSION_PATTERN =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export function validateManifest(raw: unknown, { allowNoEntrypoint = false } = {}): PluginManifest {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw))
		throw new Error('Manifest must be a JSON object');
	const m = raw as Record<string, unknown>;

	validateSchemaVersion(m);
	rejectUnknownFields(m, MANIFEST_V1_FIELDS, 'the manifest', true);
	if (m.$schema !== undefined && typeof m.$schema !== 'string')
		throw new Error('"$schema" must be a string');

	if (!m.id || typeof m.id !== 'string') throw new Error('Manifest must have a string "id" field');
	if (!PLUGIN_ID_PATTERN.test(m.id))
		throw new Error(
			`"id" ${JSON.stringify(m.id)} must start with a letter and use only letters, digits, ".", "_" or "-" (at most 64 characters), e.g. "my-plugin"`
		);
	if (!m.name || typeof m.name !== 'string')
		throw new Error('Manifest must have a string "name" field');
	if (!m.version || typeof m.version !== 'string')
		throw new Error('Manifest must have a string "version" field');
	if (!PLUGIN_VERSION_PATTERN.test(m.version))
		throw new Error(
			`"version" ${JSON.stringify(m.version)} must be a semantic version such as "1.0.0" or "1.2.0-beta.1"; bump it whenever the plugin's files change`
		);

	if (!(INSTALLABLE_FORMATS as readonly string[]).includes(m.format as string))
		throw new Error(`"format" must be ${INSTALLABLE_FORMATS.join(' or ')}`);

	if (!(VALID_STRATEGIES as readonly string[]).includes(m.applyStrategy as string))
		throw new Error(`"applyStrategy" must be ${VALID_STRATEGIES.join(', ')}`);

	const fmt = m.format as string;
	const strategy = m.applyStrategy as string;
	if (fmt === 'foldnano_mini' && !REPLAY_STRATEGIES.has(strategy) && strategy !== 'previewOnly')
		throw new Error(
			`format "foldnano_mini" requires applyStrategy to be replayMutationLog, replayMutationLogInRegion, or previewOnly (got "${strategy}")`
		);
	if (fmt !== 'foldnano_mini' && REPLAY_STRATEGIES.has(strategy))
		throw new Error(`applyStrategy "${strategy}" requires format "foldnano_mini" (got "${fmt}")`);
	if (
		fmt === 'cadnano_json' &&
		strategy !== 'previewOnly' &&
		!REGION_REPLACE_STRATEGIES.has(strategy)
	) {
		throw new Error(
			`format "cadnano_json" requires applyStrategy to be replaceRegion, replaceRegionKeepAnnotationsWhereMatched, or previewOnly (got "${strategy}")`
		);
	}
	if (
		fmt === 'foldnano_json' &&
		strategy !== 'previewOnly' &&
		!PART_REPLACE_STRATEGIES.has(strategy)
	) {
		throw new Error(
			`format "foldnano_json" requires applyStrategy to be replacePart, replacePartKeepAnnotationsWhereMatched, or previewOnly (got "${strategy}")`
		);
	}

	if (m.entrypoint !== undefined && typeof m.entrypoint !== 'string')
		throw new Error('"entrypoint" must be a string');
	if (m.entrypointUrl !== undefined && typeof m.entrypointUrl !== 'string')
		throw new Error('"entrypointUrl" must be a string');
	const hasInline = typeof m.entrypoint === 'string' && m.entrypoint.length > 0;
	const hasUrl = typeof m.entrypointUrl === 'string' && m.entrypointUrl.length > 0;

	if (hasInline && hasUrl)
		throw new Error(
			'Manifest cannot set both "entrypoint" and "entrypointUrl". Packaged plugins use ' +
				'"entrypointUrl" (a .zip bundle); code-editor plugins use a placeholder "entrypoint".'
		);

	if (isRuntimeCodeManifest(m as { sidePanel?: { codeEditor?: { execution?: string } } })) {
		// Runtime-code plugin (Script-Lab-like): the editor buffer is the source.
		if (hasUrl)
			throw new Error(
				'Plugins with sidePanel.codeEditor.execution "entrypoint" execute the editor ' +
					'buffer — use a placeholder "entrypoint", not "entrypointUrl".'
			);
		if (!hasInline && !allowNoEntrypoint)
			throw new Error(
				'Manifest must have a placeholder "entrypoint" when sidePanel.codeEditor.execution is "entrypoint"'
			);
	} else {
		// Packaged plugin: the only delivery format is a zip bundle.
		if (hasInline)
			throw new Error(
				'Inline "entrypoint" is only supported for sidePanel.codeEditor plugins with ' +
					'execution "entrypoint". Package the plugin as a zip (fplugin.json + plugin.py) ' +
					'and point "entrypointUrl" at it.'
			);
		if (!hasUrl && !allowNoEntrypoint)
			throw new Error('Manifest must have "entrypointUrl" pointing to a plugin .zip bundle');
		if (hasUrl) {
			const eurl = m.entrypointUrl as string;
			if (!entrypointUrlIsZip(eurl))
				throw new Error(
					`entrypointUrl "${eurl}" must point to a plugin .zip bundle — ` +
						'raw .py entrypoints are no longer supported.'
				);
			if (!isSameOriginUrl(eurl))
				throw new Error(`entrypointUrl "${eurl}" is not served by Foldnano. ${LOCAL_ZIP_HINT}`);
		}
	}

	if (m.requirements !== undefined) {
		if (
			!Array.isArray(m.requirements) ||
			!(m.requirements as unknown[]).every((r) => typeof r === 'string')
		)
			throw new Error('"requirements" must be an array of strings');
		for (const req of m.requirements as string[]) {
			if (req !== req.trim())
				throw new Error(`Requirement "${req}" has leading or trailing spaces`);
			if (req.includes('@'))
				throw new Error(
					`Requirement "${req}" is a direct URL reference. List PyPI packages by name; ` +
						'ship other code as a .whl inside the plugin zip.'
				);
			const isLocation = /[/\\]|:\/\//.test(req);
			if (req.endsWith('.whl')) {
				// A bare filename ships in the zip; a path or URL is fetched from Foldnano itself.
				if (isLocation && !isSameOriginUrl(req))
					throw new Error(
						`Wheel "${req}" is not served by Foldnano. Ship it inside the plugin zip ` +
							'and list its bare filename instead.'
					);
			} else if (isLocation) {
				throw new Error(
					`Requirement "${req}" looks like a path or URL. List PyPI packages by name; ` +
						'ship other code as a .whl inside the plugin zip.'
				);
			}
			if (SUPPORTED_REQUIREMENTS_ALLOWLIST !== null && !req.endsWith('.whl')) {
				if (!SUPPORTED_REQUIREMENTS_ALLOWLIST.includes(req)) {
					throw new Error(`Requirement "${req}" is not in the supported packages list.`);
				}
			}
		}
	}

	if (m.network !== undefined) validateNetwork(m.network);

	if (m.parameters !== undefined) {
		if (!Array.isArray(m.parameters)) throw new Error('"parameters" must be an array');
		validateFieldDefs(m.parameters as unknown[], 'Parameter');
	}

	if (m.sidePanel !== undefined) {
		validateSidePanel(m.sidePanel, m.parameters);
	}

	return withSchemaVersion(m) as unknown as PluginManifest;
}

function validateFieldDefs(fields: unknown[], labelPrefix: string): void {
	const ids = new Set<string>();
	for (const field of fields) {
		if (!field || typeof field !== 'object')
			throw new Error(`Each ${labelPrefix.toLowerCase()} must be an object`);
		const p = field as Record<string, unknown>;
		if (!p.id || typeof p.id !== 'string')
			throw new Error(`Each ${labelPrefix.toLowerCase()} must have a string "id" field`);
		rejectUnknownFields(
			p,
			MANIFEST_V1_NESTED_FIELDS.field,
			`${labelPrefix.toLowerCase()} "${p.id}"`
		);
		if (Array.isArray(p.options)) {
			for (const option of p.options as unknown[]) {
				if (option && typeof option === 'object')
					rejectUnknownFields(
						option as Record<string, unknown>,
						MANIFEST_V1_NESTED_FIELDS.selectOption,
						`an option of ${labelPrefix.toLowerCase()} "${p.id}"`
					);
			}
		}
		if (ids.has(p.id)) throw new Error(`Duplicate ${labelPrefix.toLowerCase()} id: "${p.id}"`);
		ids.add(p.id);
		if (!['string', 'number', 'boolean', 'select'].includes(p.type as string))
			throw new Error(`${labelPrefix} "${p.id}" has invalid type "${p.type as string}"`);

		if (p.type === 'number') {
			if (p.min !== undefined && !Number.isFinite(p.min as number))
				throw new Error(`${labelPrefix} "${p.id}" min must be a finite number`);
			if (p.max !== undefined && !Number.isFinite(p.max as number))
				throw new Error(`${labelPrefix} "${p.id}" max must be a finite number`);
			if (p.step !== undefined) {
				if (!Number.isFinite(p.step as number))
					throw new Error(`${labelPrefix} "${p.id}" step must be a finite number`);
				if ((p.step as number) <= 0)
					throw new Error(`${labelPrefix} "${p.id}" step must be greater than 0`);
			}
			if (p.min !== undefined && p.max !== undefined && (p.min as number) > (p.max as number))
				throw new Error(`${labelPrefix} "${p.id}" has min > max`);
		}

		if (p.type === 'select') {
			try {
				normalizeSelectOptions(p.options as PluginFieldDef['options']);
			} catch (e) {
				throw new Error(`${labelPrefix} "${p.id}": ${e instanceof Error ? e.message : String(e)}`);
			}
		}

		if (p.default !== undefined) {
			switch (p.type) {
				case 'number': {
					if (typeof p.default !== 'number' || !Number.isFinite(p.default))
						throw new Error(`${labelPrefix} "${p.id}" default must be a finite number`);
					if (p.min !== undefined && p.default < (p.min as number))
						throw new Error(
							`${labelPrefix} "${p.id}" default ${p.default} is below min ${p.min as number}`
						);
					if (p.max !== undefined && p.default > (p.max as number))
						throw new Error(
							`${labelPrefix} "${p.id}" default ${p.default} is above max ${p.max as number}`
						);
					if (
						p.step !== undefined &&
						!isStepAligned(p.default, stepBase(p as { min?: number }), p.step as number)
					)
						throw new Error(
							`${labelPrefix} "${p.id}" default ${p.default} must be in increments of ` +
								`${p.step as number} from ${stepBase(p as { min?: number })}`
						);
					break;
				}
				case 'string':
					if (typeof p.default !== 'string')
						throw new Error(`${labelPrefix} "${p.id}" default must be a string`);
					break;
				case 'boolean':
					if (typeof p.default !== 'boolean')
						throw new Error(`${labelPrefix} "${p.id}" default must be a boolean`);
					break;
				case 'select': {
					if (typeof p.default !== 'string')
						throw new Error(`${labelPrefix} "${p.id}" default must be a string`);
					const normalized = normalizeSelectOptions(p.options as PluginFieldDef['options']);
					if (!normalized.includes(p.default))
						throw new Error(`${labelPrefix} "${p.id}" default "${p.default}" is not in options`);
					break;
				}
			}
		}
	}
}

function validateSidePanel(rawSidePanel: unknown, rawParameters: unknown): void {
	if (!rawSidePanel || typeof rawSidePanel !== 'object') {
		throw new Error('"sidePanel" must be an object');
	}

	const sidePanel = rawSidePanel as Record<string, unknown>;
	rejectUnknownFields(sidePanel, MANIFEST_V1_NESTED_FIELDS.sidePanel, '"sidePanel"');
	if (!(VALID_SIDE_PANEL_TYPES as readonly string[]).includes(sidePanel.type as string)) {
		throw new Error(`"sidePanel.type" must be ${VALID_SIDE_PANEL_TYPES.join(' or ')}`);
	}
	if (
		sidePanel.icon !== undefined &&
		!(VALID_SIDE_PANEL_ICONS as readonly string[]).includes(sidePanel.icon as string)
	) {
		throw new Error(`"sidePanel.icon" must be ${VALID_SIDE_PANEL_ICONS.join(', ')}`);
	}

	if (sidePanel.type === 'form') {
		if (rawParameters !== undefined) {
			throw new Error('Plugins cannot declare both "parameters" and "sidePanel.form.fields"');
		}
		if (!sidePanel.form || typeof sidePanel.form !== 'object') {
			throw new Error('"sidePanel.form" is required when "sidePanel.type" is "form"');
		}
		const form = sidePanel.form as Record<string, unknown>;
		rejectUnknownFields(form, MANIFEST_V1_NESTED_FIELDS.sidePanelForm, '"sidePanel.form"');
		if (!Array.isArray(form.fields) || form.fields.length === 0) {
			throw new Error('"sidePanel.form.fields" must be a non-empty array');
		}
		validateFieldDefs(form.fields, 'Side panel field');
		if (sidePanel.codeEditor !== undefined) {
			throw new Error('"sidePanel.codeEditor" is only valid when "sidePanel.type" is "codeEditor"');
		}
		return;
	}

	if (sidePanel.form !== undefined) {
		throw new Error('"sidePanel.form" is only valid when "sidePanel.type" is "form"');
	}
	if (sidePanel.codeEditor !== undefined && typeof sidePanel.codeEditor !== 'object') {
		throw new Error('"sidePanel.codeEditor" must be an object');
	}
	const codeEditor = sidePanel.codeEditor as Record<string, unknown> | undefined;
	if (codeEditor) {
		rejectUnknownFields(
			codeEditor,
			MANIFEST_V1_NESTED_FIELDS.sidePanelCodeEditor,
			'"sidePanel.codeEditor"'
		);
	}
	if (
		codeEditor?.execution !== undefined &&
		!(VALID_CODE_EDITOR_EXECUTION_MODES as readonly string[]).includes(
			codeEditor.execution as string
		)
	) {
		throw new Error(
			`"sidePanel.codeEditor.execution" must be ${VALID_CODE_EDITOR_EXECUTION_MODES.join(' or ')}`
		);
	}
}

/**
 * Returns true if the raw object looks like a plugin manifest.
 * Used by the file parser to decide whether to accept a file.
 */
export function looksLikePluginManifest(raw: Record<string, unknown>): boolean {
	return (
		typeof raw.id === 'string' &&
		typeof raw.name === 'string' &&
		typeof raw.version === 'string' &&
		(INSTALLABLE_FORMATS as readonly string[]).includes(raw.format as string) &&
		(VALID_STRATEGIES as readonly string[]).includes(raw.applyStrategy as string)
	);
}

export type {
	PluginFieldDef,
	PluginParamDef,
	PluginSidePanelFieldDef,
	PluginSidePanelIcon,
	PluginSidePanelManifest,
};
