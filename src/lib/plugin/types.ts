/**
 * Plugin format: what JSON the plugin receives and returns.
 * - cadnano_json: classic cadnano format (lossy — topology + colors; scaffold by parity)
 * - foldnano_json: Part-level JSON via Part.toJSON() (lossless)
 * - foldnano_mini: mutable Python API; the plugin emits a structured mutation log
 *   that is replayed against the real Part on the JS side under one undo step.
 * - live: Python proxy objects (deferred — Phase 6)
 */
export type PluginFormat = 'cadnano_json' | 'foldnano_json' | 'foldnano_mini' | 'live';

/**
 * How the host applies the plugin result to the model.
 * - replacePartKeepAnnotationsWhereMatched: replace topology; re-graft annotations at matching coordinates
 * - replacePart: full part replacement, no annotation re-grafting
 * - replaceRegionKeepAnnotationsWhereMatched: replace only the active region; re-graft annotations
 * - replaceRegion: replace only the active region, no annotation re-grafting
 * - replayMutationLog: replay a foldnano_mini mutation log against the existing part (whole-part scope)
 * - replayMutationLogInRegion: as above, but each op's target VH must belong to the active region
 * - previewOnly: show diff, never apply
 */
export type ApplyStrategy =
	| 'replacePartKeepAnnotationsWhereMatched'
	| 'replacePart'
	| 'replaceRegionKeepAnnotationsWhereMatched'
	| 'replaceRegion'
	| 'replayMutationLog'
	| 'replayMutationLogInRegion'
	| 'previewOnly';

/**
 * Plugin lifecycle state.
 * 'needs-reinstall' marks records installed under the pre-zip plugin format
 * (inline entrypoint / raw .py URL); they must be re-imported as a plugin zip.
 */
export type PluginStatus =
	'registered' | 'activating' | 'active' | 'running' | 'error' | 'deactivated' | 'needs-reinstall';

/**
 * Shared schema for host-rendered plugin inputs.
 */
export interface PluginFieldDef {
	/** Key the Python plugin receives in ctx.params */
	id: string;
	/** Label shown in the run dialog */
	label: string;
	type: 'string' | 'number' | 'boolean' | 'select';
	default?: string | number | boolean;
	/** Hint text shown below the input */
	description?: string;
	/** If true, an empty/NaN value prevents the dialog from submitting */
	required?: boolean;
	// number only
	min?: number;
	max?: number;
	step?: number;
	// select only
	options?: Array<string | { value: string; label: string }>;
}

/**
 * A single user-configurable parameter declared in a plugin manifest.
 */
export type PluginParamDef = PluginFieldDef;

export type PluginSidePanelType = 'form' | 'codeEditor';
export type PluginSidePanelIcon = 'form' | 'code' | 'analysis';

export type PluginSidePanelFieldDef = PluginFieldDef;

export interface PluginSidePanelFormConfig {
	fields: PluginSidePanelFieldDef[];
	submitLabel?: string;
}

export interface PluginSidePanelCodeEditorConfig {
	filename?: string;
	initialCode?: string;
	execution?: 'input' | 'entrypoint';
}

export interface PluginSidePanelManifest {
	type: PluginSidePanelType;
	title?: string;
	icon?: PluginSidePanelIcon;
	form?: PluginSidePanelFormConfig;
	codeEditor?: PluginSidePanelCodeEditorConfig;
}

export interface PluginSidePanelInput {
	type: PluginSidePanelType;
	code?: string;
	filename?: string;
}

/**
 * The manifest schema for a .fplugin.json file.
 */
export interface PluginManifest {
	/** Manifest schema version (MANIFEST_SCHEMA_VERSION); not the plugin's own version. */
	schemaVersion: 1;
	/** Optional JSON Schema reference for editors; ignored by the app. */
	$schema?: string;
	/** Author-owned metadata; ignored by the app. */
	[extension: `x-${string}`]: unknown;
	/** Unique plugin identifier */
	id: string;
	/** Human-readable display name */
	name: string;
	/** Semver version string */
	version: string;
	/** Input/output format the plugin uses */
	format: PluginFormat;
	/** How the host applies the result to the model */
	applyStrategy: ApplyStrategy;
	/** Placeholder inline code — only valid for sidePanel.codeEditor plugins with execution "entrypoint" */
	entrypoint?: string;
	/** URL of the plugin .zip bundle (fplugin.json + plugin.py + assets). Mutually exclusive with entrypoint. */
	entrypointUrl?: string;
	/** micropip packages to install at activation time */
	requirements?: string[];
	/**
	 * Hosts the plugin may contact (e.g. "api.example.org"), or ["*"] for any
	 * HTTPS host. Omitted or empty = no network. Enforced by the sandbox CSP.
	 */
	network?: string[];
	/** Optional human-readable description */
	description?: string;
	/** User-configurable parameters shown in the run dialog */
	parameters?: PluginParamDef[];
	/** Host-rendered side panel requested by the plugin */
	sidePanel?: PluginSidePanelManifest;
}

/**
 * A registered plugin instance with runtime state.
 */
export interface PythonPlugin {
	manifest: PluginManifest;
	/** Whether the plugin ships with the app or was installed by the user. */
	origin: 'builtin' | 'user';
	/** Whether the user has opted in to this plugin. Builtin plugins default to false (opt-in). */
	enabled: boolean;
	status: PluginStatus;
	/** Resolved Python code (either from manifest.entrypoint or fetched from manifest.entrypointUrl) */
	resolvedCode: string | null;
	/** Resolved zip bundle (set when entrypointUrl ends in .zip; mutually exclusive with resolvedCode) */
	resolvedZipData?: ArrayBuffer;
	/** Error message if status === 'error' */
	errorMessage: string | null;
	/** Python traceback if status === 'error' (run errors only) */
	errorTraceback: string | null;
	/** Log lines captured from the most recent run */
	logs: string[];
	/** Secondary artifacts from the most recent run */
	artifacts: Record<string, string | Uint8Array>;
	/** Structured result dict from ctx.set_result() in the most recent run */
	pluginResult: Record<string, unknown> | null;
	/** Current parameter values; initialized from manifest defaults, updated after each run dialog confirm */
	paramValues: Record<string, unknown>;
	/** Current side panel form values; initialized from sidePanel.form defaults, updated after each panel run */
	sidePanelValues: Record<string, unknown>;
	/** Current side panel code editor contents; initialized from sidePanel.codeEditor.initialCode */
	sidePanelCode: string;
	/** Count of foldnano_mini ops produced by the most recent run, if known. */
	lastRunMutationLogLength: number | null;
}

/**
 * Serializable form of a plugin for persistence.
 * Only the manifest is persisted; runtime state is ephemeral.
 */
export interface PersistedPlugin {
	manifest: PluginManifest;
}
