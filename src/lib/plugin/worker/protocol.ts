import type { PluginFormat } from '../types';

// ---------------------------------------------------------------------------
// Requests: main thread → worker
// ---------------------------------------------------------------------------

export interface InitRuntimeRequest {
	type: 'INIT_RUNTIME';
	/** Absolute Pyodide URLs; the sandboxed worker can't resolve app-relative paths. */
	indexUrl: string;
	packageBaseUrl: string;
}

export interface InstallPluginRequest {
	type: 'INSTALL_PLUGIN';
	requestId: string;
	/** Package names passed to micropip (e.g. 'numpy'). Does not include .whl files. */
	micropipPackages: string[];
	/** Pre-fetched wheel bytes. The coordinator fetches and caches these on the main
	 *  thread so the worker writes them to VFS directly without an extra network request. */
	preloadedWheels: Array<{ filename: string; data: ArrayBuffer }>;
}

export interface RunPluginRequest {
	type: 'RUN_PLUGIN';
	requestId: string;
	/** Resolved Python source code to execute (mutually exclusive with pluginZipData) */
	pluginCode?: string;
	/** Zip bundle to extract and execute (mutually exclusive with pluginCode) */
	pluginZipData?: ArrayBuffer;
	/** Human-readable label for logs and error messages */
	pluginLabel: string;
	format: PluginFormat;
	/** Provided when format === 'cadnano_json' */
	cadnanoJsonIn?: string;
	/** Provided when format === 'foldnano_json' or 'live' */
	foldnanoJsonIn?: string;
	/** Index of the active Part in the document */
	activePartIndex: number;
	/** JSON-encoded Record<string, unknown> of user-supplied parameter values; omitted when the plugin declares no parameters */
	paramsJson?: string;
	/** JSON-encoded host-owned side panel input payload. */
	sidePanelInputJson?: string;
	/**
	 * UUID of the DesignRegion the host considered "active" when launching the
	 * plugin. Region-scoped plugins (cadnano_json + replaceRegion strategies,
	 * or foldnano_json plugins that want to operate on one region) read this
	 * from `ctx.active_region_id` on the Python side.
	 */
	activeRegionId?: string | null;
	/**
	 * Load the Pyodide distribution packages `pluginCode` imports before running it. Set for
	 * code-editor source, which has no manifest `requirements` to install at activation. With
	 * `pluginZipData` too (an owned plugin's draft), the zip runs and `pluginCode` is only scanned.
	 */
	loadImports?: boolean;
}

/** Map a script's imports to the Pyodide distribution packages that provide them. */
export interface ResolveImportsRequest {
	type: 'RESOLVE_IMPORTS';
	requestId: string;
	code: string;
}

export type WorkerRequest =
	InitRuntimeRequest | InstallPluginRequest | RunPluginRequest | ResolveImportsRequest;

/** Sandbox bootstrap → worker: carries the MessagePort all protocol traffic then uses. */
export const SANDBOX_PORT_HANDOFF = 'SANDBOX_PORT_HANDOFF';

export interface SandboxPortHandoff {
	type: typeof SANDBOX_PORT_HANDOFF;
	/** The sandbox's CSP, so the worker can explain blocked requests where no event reports them. */
	csp: string;
}

// ---------------------------------------------------------------------------
// Responses: worker → main thread
// ---------------------------------------------------------------------------

export interface RuntimeReadyResponse {
	type: 'RUNTIME_READY';
}

export interface RuntimeErrorResponse {
	type: 'RUNTIME_ERROR';
	error: string;
}

export interface InstallDoneResponse {
	type: 'INSTALL_DONE';
	requestId: string;
}

export interface InstallErrorResponse {
	type: 'INSTALL_ERROR';
	requestId: string;
	error: string;
}

export interface PluginResultResponse {
	type: 'PLUGIN_RESULT';
	requestId: string;
	/** cadnanoJsonOut or foldnanoJsonOut — the primary transformed artifact */
	primaryArtifact: string | null;
	/** Additional artifacts written via ctx.write_artifact() */
	artifacts: Record<string, string | Uint8Array>;
	/** Structured result from ctx.set_result() */
	pluginResult: Record<string, unknown> | null;
	/**
	 * Foldnano_mini mutation log set via ctx.set_result_mutation_log(...).
	 * Present only when the plugin format is foldnano_mini.
	 */
	mutationLog: Record<string, unknown>[] | null;
	/** All log lines captured during the run */
	logs: string[];
}

export interface PluginErrorResponse {
	type: 'PLUGIN_ERROR';
	requestId: string;
	error: string;
	traceback: string;
	/** Log lines captured before the crash, if any. */
	logs: string[];
}

export interface ImportsResolvedResponse {
	type: 'IMPORTS_RESOLVED';
	requestId: string;
	/** Distribution package names, sorted; imports no package provides are left out. */
	packages: string[];
}

export interface ImportsErrorResponse {
	type: 'IMPORTS_ERROR';
	requestId: string;
	error: string;
}

/** Streaming log line emitted during plugin execution */
export interface PluginLogResponse {
	type: 'PLUGIN_LOG';
	requestId: string;
	message: string;
}

export type WorkerResponse =
	| RuntimeReadyResponse
	| RuntimeErrorResponse
	| InstallDoneResponse
	| InstallErrorResponse
	| PluginResultResponse
	| PluginErrorResponse
	| ImportsResolvedResponse
	| ImportsErrorResponse
	| PluginLogResponse;
