/**
 * Pyodide Web Worker
 *
 * Handles three message types from the main thread:
 *   INIT_RUNTIME   — loads Pyodide from CDN, writes foldnano package to VFS
 *   INSTALL_PLUGIN — installs micropip requirements for a plugin
 *   RUN_PLUGIN     — executes a plugin's run(ctx) function, returns artifacts
 *
 * Runs as a data: module worker inside the opaque-origin plugin sandbox
 * (sandboxHost.ts); it is imported as a string via `?sandbox-worker`, never
 * through Vite's worker pipeline. Every module of the foldnano Python packages is inlined
 * from `virtual:foldnano-python-packages` and written into Pyodide's virtual
 * filesystem at init time.
 */

import {
	SANDBOX_PORT_HANDOFF,
	type SandboxPortHandoff,
	type WorkerRequest,
	type WorkerResponse,
} from './protocol';
import { loadedPackageLogs, missingModuleHint } from './scriptImports';
import { connectSourcesFromCsp, isConnectAllowed } from './connectSources';

// ---------------------------------------------------------------------------
// The foldnano and foldnano_mini packages, every module, inlined at bundle time
// (scripts/vite-sandbox-worker.ts)
// ---------------------------------------------------------------------------
import pythonPackageFiles from 'virtual:foldnano-python-packages';

// ---------------------------------------------------------------------------
// Minimal Pyodide type surface (the worker loads Pyodide at run time, not from the npm package)
// ---------------------------------------------------------------------------
interface PyodideFS {
	mkdir(path: string): void;
	writeFile(path: string, data: string | Uint8Array, opts?: { encoding?: string }): void;
}

interface PyodideGlobals {
	get(name: string): unknown;
	set(name: string, value: unknown): void;
	delete(name: string): void;
}

interface PyodideInterface {
	runPython(code: string): unknown;
	runPythonAsync(code: string): Promise<unknown>;
	loadPackage(names: string | string[]): Promise<void>;
	/** Loads distribution packages the code imports; returns only packages newly loaded. */
	loadPackagesFromImports(code: string): Promise<Array<{ name: string; version: string }>>;
	readonly lockfile: { packages: Record<string, { name: string; imports: string[] }> };
	globals: PyodideGlobals;
	FS: PyodideFS;
}

// ---------------------------------------------------------------------------
// Worker context
// ---------------------------------------------------------------------------
const workerCtx = self as unknown as {
	postMessage(msg: WorkerResponse): void;
	onmessage: ((event: MessageEvent<WorkerRequest | SandboxPortHandoff>) => void) | null;
};

// The sandbox host hands over a MessagePort; protocol traffic then bypasses the iframe.
let channel: { postMessage(msg: WorkerResponse): void } = workerCtx;

function post(msg: WorkerResponse): void {
	channel.postMessage(msg);
}

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------
let pyodide: PyodideInterface | null = null;

// Hosts the sandbox CSP blocked during the current run, reported in its logs so a
// plugin that needs undeclared network access fails with an explanation.
let blockedHosts: Set<string> | null = null;

(self as unknown as EventTarget).addEventListener('securitypolicyviolation', (event) => {
	const e = event as SecurityPolicyViolationEvent;
	if (!blockedHosts || !e.violatedDirective.startsWith('connect-src')) return;
	try {
		blockedHosts.add(new URL(e.blockedURI).host);
	} catch {
		blockedHosts.add(e.blockedURI);
	}
});

/**
 * Safari/WebKit enforces the CSP but fires no `securitypolicyviolation` in the worker. So failed
 * requests to hosts outside `connect-src` are recorded too; the Set dedupes hosts that browsers
 * with the event report twice.
 */
function noteFailedRequest(url: string | URL | undefined, connectSources: readonly string[]): void {
	if (!blockedHosts || url === undefined) return;
	let parsed: URL;
	try {
		parsed = new URL(url, self.location.href);
	} catch {
		return;
	}
	if (!isConnectAllowed(connectSources, parsed)) blockedHosts.add(parsed.host);
}

function requestUrl(input: RequestInfo | URL): string {
	return input instanceof Request ? input.url : String(input);
}

function explainFailedRequests(connectSources: readonly string[]): void {
	const nativeFetch = self.fetch.bind(self);
	self.fetch = (input, init) =>
		nativeFetch(input, init).catch((error: unknown) => {
			noteFailedRequest(requestUrl(input), connectSources);
			throw error;
		});

	const requestUrls = new WeakMap<XMLHttpRequest, string | URL>();
	const nativeOpen = XMLHttpRequest.prototype.open;
	const nativeSend = XMLHttpRequest.prototype.send;
	XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: unknown[]) {
		requestUrls.set(this, args[1] as string | URL);
		return (nativeOpen as (...a: unknown[]) => void).apply(this, args);
	};
	XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body) {
		const url = requestUrls.get(this);
		this.addEventListener('error', () => noteFailedRequest(url, connectSources));
		try {
			nativeSend.call(this, body);
		} catch (error) {
			// Synchronous XHR (pyodide.http.open_url) throws instead of firing 'error'.
			noteFailedRequest(url, connectSources);
			throw error;
		}
	};
}

/** Ends violation collection for a run and returns its log lines. */
async function takeBlockedRequestLogs(): Promise<string[]> {
	// Violation events are queued as tasks; let those raised during a synchronous run arrive.
	await new Promise((resolve) => setTimeout(resolve, 0));
	const hosts = [...(blockedHosts ?? [])];
	blockedHosts = null;
	return hosts.map(
		(host) =>
			`[sandbox] Blocked a request to ${host}: this plugin has no network access to it. ` +
			`Plugin authors: add "${host}" to "network" in fplugin.json.`
	);
}

// ---------------------------------------------------------------------------
// Python harness run inside Pyodide for each plugin execution
// ---------------------------------------------------------------------------
const INIT_HARNESS = `
import sys
sys.path.insert(0, '/')

from foldnano._log_capture import LogCapture as _LogCapture

_log_capture = _LogCapture()
sys.stdout = _log_capture
sys.stderr = _log_capture

# Snapshot of modules present after runtime init — used to clean up zip plugin
# modules between runs so the second run always imports fresh code.
_base_modules = set(sys.modules.keys())
`;

/**
 * The run harness is executed inside Pyodide for each RUN_PLUGIN call.
 *
 * Expects these globals to be set before running (via pyodide.globals.set):
 *   _plugin_code    — Python source string
 *   _format         — "cadnano_json" | "foldnano_json" | "live"
 *   _cadnano_json_in  — str | None
 *   _foldnano_json_in — str | None
 *
 * After running, reads back:
 *   _run_success    — bool
 *   _run_error      — str | None
 *   _run_traceback  — str | None
 *   _result_payload — JSON string with {primary_artifact, artifacts, plugin_result, logs}
 *   _run_logs_json  — JSON-encoded failure logs, avoiding a PyProxy crossing postMessage.
 */
const RUN_HARNESS = `
import traceback as _traceback
import types as _types
import json as _json
import base64 as _b64

_log_capture.clear()

_ns = None
_run_success = False
_run_error = None
_run_traceback = None
_result_payload = None
_run_logs_json = '[]'

try:
    if _plugin_zip:
        import zipfile as _zf, sys as _zsys, importlib.util as _ilu, shutil as _shutil
        # Remove any modules loaded by a previous zip run so the second run
        # always imports fresh code (avoids stale sys.modules cache).
        for _k in list(_zsys.modules.keys()):
            if _k not in _base_modules:
                del _zsys.modules[_k]
        import os as _os
        _plugin_run = '/plugin_run'
        while _plugin_run in _zsys.path:
            _zsys.path.remove(_plugin_run)
        # Clear stale files so a removed/renamed module can't still be imported.
        if _os.path.exists(_plugin_run):
            _shutil.rmtree(_plugin_run)
        _zf_obj = _zf.ZipFile('/plugin.zip')
        _plugin_run_real = _os.path.realpath(_plugin_run)
        for _member in _zf_obj.infolist():
            _target = _os.path.realpath(_os.path.join(_plugin_run, _member.filename))
            if not _target.startswith(_plugin_run_real + '/') and _target != _plugin_run_real:
                raise RuntimeError(f'Zip path traversal blocked: {_member.filename}')
            _zf_obj.extract(_member, _plugin_run)
        _zsys.path.insert(0, _plugin_run)
        _spec = _ilu.spec_from_file_location('_plugin', _plugin_run + '/plugin.py')
        _ns = _ilu.module_from_spec(_spec)
        _spec.loader.exec_module(_ns)
    else:
        _ns = _types.ModuleType('_plugin')
        # Restrict builtins for inline scripts (ScriptLab / codeEditor entrypoint).
        # Zip-based plugins keep full builtins — users explicitly installed those.
        _BLOCKED = frozenset(('open', 'eval', 'exec', 'compile',
                               'breakpoint', 'input', 'memoryview'))
        _ns.__dict__['__builtins__'] = {
            k: v for k, v in __builtins__.__dict__.items() if k not in _BLOCKED
        }
        exec(compile(_plugin_code, '<plugin>', 'exec'), _ns.__dict__)
    from foldnano.plugin import PluginContext as _PluginContext
    _ctx = _PluginContext(
        format=_format,
        cadnano_json_in=_cadnano_json_in,
        foldnano_json_in=_foldnano_json_in,
        params_json=_params_json,
        side_panel_input_json=_side_panel_input_json,
        active_region_id=_active_region_id,
    )
    _ns.run(_ctx)
    # Artifacts written directly into ctx.artifacts bypass write_artifact's check.
    from foldnano.plugin import MAX_ARTIFACT_BYTES as _MAX_ARTIFACT_BYTES, artifact_size as _artifact_size
    _artifact_sizes = sorted(((_artifact_size(v), k) for k, v in _ctx.artifacts.items()), reverse=True)
    if sum(size for size, _ in _artifact_sizes) > _MAX_ARTIFACT_BYTES:
        _largest = ', '.join(f'{k} ({size // (1024 * 1024)} MB)' for size, k in _artifact_sizes[:3])
        raise RuntimeError(
            f"This run's artifacts exceed the {_MAX_ARTIFACT_BYTES // (1024 * 1024)} MB limit "
            f"(largest: {_largest}). Write smaller artifacts."
        )
    _run_success = True

    def _encode_artifact(v):
        if isinstance(v, (bytes, bytearray)):
            return {'__bytes_b64': _b64.b64encode(bytes(v)).decode()}
        return v

    _result_payload = _json.dumps({
        'primary_artifact': _ctx.primary_artifact,
        'artifacts': {k: _encode_artifact(v) for k, v in _ctx.artifacts.items()},
        'plugin_result': _ctx.plugin_result,
        'mutation_log': _ctx.mutation_log if _ctx.mutation_log is not None else [],
        'logs': _log_capture.get_lines(),
    })
# BaseException: plugins written as CLI tools call sys.exit(), and an uncaught SystemExit
# shuts the whole Pyodide runtime down with no error message.
except BaseException as _exc:
    _run_success = False
    # str(exc) is empty for e.g. a bare assert or IndexError(); the summary line never is.
    _run_error = ''.join(_traceback.format_exception_only(type(_exc), _exc)).strip()
    _run_traceback = _traceback.format_exc()
    try:
        _run_logs_json = _json.dumps(_log_capture.get_lines())
    except Exception:
        _run_logs_json = '[]'
`;

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** Emscripten throws non-Error objects (e.g. `ExitStatus`); never report "[object Object]" or "". */
function describeError(e: unknown): string {
	if (e instanceof Error) return e.message || e.name;
	if (e && typeof e === 'object' && 'message' in e && typeof e.message === 'string' && e.message)
		return e.message;
	return String(e) || 'Unknown error';
}

async function initRuntime(indexUrl: string, packageBaseUrl: string): Promise<void> {
	try {
		// A non-literal specifier stays a runtime import of the pinned core.
		const { loadPyodide } = (await import(`${indexUrl}pyodide.mjs`)) as {
			loadPyodide: (opts: {
				indexURL: string;
				packageBaseUrl: string;
			}) => Promise<PyodideInterface>;
		};

		pyodide = await loadPyodide({ indexURL: indexUrl, packageBaseUrl });

		// Load micropip so plugins can install packages at activation time
		await pyodide.loadPackage(['micropip']);

		// Write the foldnano and foldnano_mini packages into the virtual filesystem
		const packageDirs = new Set<string>();
		for (const [file, source] of Object.entries(pythonPackageFiles)) {
			const dir = `/${file.split('/')[0]}`;
			if (!packageDirs.has(dir)) {
				pyodide.FS.mkdir(dir);
				packageDirs.add(dir);
			}
			pyodide.FS.writeFile(`/${file}`, source);
		}

		// Add '/' to sys.path and install the stdout capture helper
		await pyodide.runPythonAsync(INIT_HARNESS);

		post({ type: 'RUNTIME_READY' });
	} catch (e) {
		post({ type: 'RUNTIME_ERROR', error: e instanceof Error ? e.message : String(e) });
	}
}

async function installPlugin(
	requestId: string,
	micropipPackages: string[],
	preloadedWheels: Array<{ filename: string; data: ArrayBuffer }>
): Promise<void> {
	if (!pyodide) {
		post({ type: 'INSTALL_ERROR', requestId, error: 'Runtime not initialized' });
		return;
	}
	if (micropipPackages.length === 0 && preloadedWheels.length === 0) {
		post({ type: 'INSTALL_DONE', requestId });
		return;
	}
	try {
		// Write pre-fetched wheel bytes directly to Pyodide VFS.
		// Wheels are ZIP archives — zipimport handles them when added to sys.path,
		// bypassing micropip (avoids transitive dep resolution issues).
		const wheelPaths: string[] = [];

		for (const { filename, data } of preloadedWheels) {
			const fsPath = `/${filename}`;
			pyodide.FS.writeFile(fsPath, new Uint8Array(data));
			wheelPaths.push(fsPath);
		}

		const micropipPkgs = micropipPackages;

		// Add wheel paths to sys.path so Python can import from them directly.
		if (wheelPaths.length > 0) {
			pyodide.globals.set('_wheel_paths', wheelPaths);
			await pyodide.runPythonAsync(`
import sys as _sys
for _p in _wheel_paths:
    if _p not in _sys.path:
        _sys.path.insert(0, _p)
`);
		}

		// Install remaining (non-wheel) packages via micropip.
		if (micropipPkgs.length > 0) {
			pyodide.globals.set('_micropip_pkgs', micropipPkgs);
			await pyodide.runPythonAsync(`
import micropip as _micropip
for _pkg in _micropip_pkgs:
    await _micropip.install(_pkg)
`);
		}

		post({ type: 'INSTALL_DONE', requestId });
	} catch (e) {
		const msg = e instanceof Error ? e.message || e.toString() : String(e);
		console.error('[worker] installPlugin error:', msg, e);
		post({
			type: 'INSTALL_ERROR',
			requestId,
			error: msg || 'Unknown install error (see worker console)',
		});
	}
}

const RUN_GLOBALS = [
	'_plugin_code',
	'_plugin_zip',
	'_format',
	'_cadnano_json_in',
	'_foldnano_json_in',
	'_params_json',
	'_side_panel_input_json',
	'_active_region_id',
	'_run_success',
	'_run_error',
	'_run_traceback',
	'_result_payload',
	'_run_logs_json',
] as const;

async function runPlugin(
	requestId: string,
	pluginCode: string,
	isZip: boolean,
	format: string,
	cadnanoJsonIn: string | null,
	foldnanoJsonIn: string | null,
	paramsJson: string | null,
	sidePanelInputJson: string | null,
	activeRegionId: string | null,
	loadImports: boolean
): Promise<void> {
	if (!pyodide) {
		post({
			type: 'PLUGIN_ERROR',
			requestId,
			error: 'Runtime not initialized',
			traceback: '',
			logs: [],
		});
		return;
	}
	let envLogs: string[] = [];
	if (loadImports) {
		try {
			envLogs = loadedPackageLogs(await pyodide.loadPackagesFromImports(pluginCode));
		} catch (e) {
			post({
				type: 'PLUGIN_ERROR',
				requestId,
				error: `Couldn't load packages the script imports: ${e instanceof Error ? e.message : String(e)}`,
				traceback: '',
				logs: [],
			});
			return;
		}
	}
	try {
		pyodide.globals.set('_plugin_code', pluginCode);
		pyodide.globals.set('_plugin_zip', isZip);
		pyodide.globals.set('_format', format);
		// Since Pyodide 0.28 JS null arrives as jsnull; undefined still becomes None.
		pyodide.globals.set('_cadnano_json_in', cadnanoJsonIn ?? undefined);
		pyodide.globals.set('_foldnano_json_in', foldnanoJsonIn ?? undefined);
		pyodide.globals.set('_params_json', paramsJson ?? undefined);
		pyodide.globals.set('_side_panel_input_json', sidePanelInputJson ?? undefined);
		pyodide.globals.set('_active_region_id', activeRegionId ?? undefined);

		blockedHosts = new Set();
		await pyodide.runPythonAsync(RUN_HARNESS);
		const sandboxLogs = await takeBlockedRequestLogs();

		const success = pyodide.globals.get('_run_success') as boolean;

		if (!success) {
			const error = pyodide.globals.get('_run_error') as string;
			const traceback = pyodide.globals.get('_run_traceback') as string;
			// Keep the original plugin error if captured logs cannot be decoded.
			let logs: string[] = [];
			try {
				const logsJson = pyodide.globals.get('_run_logs_json') as string | undefined;
				const parsed: unknown = logsJson ? JSON.parse(logsJson) : [];
				if (Array.isArray(parsed) && parsed.every((line) => typeof line === 'string')) {
					logs = parsed;
				}
			} catch {
				// logs stays []
			}
			const hint = loadImports ? missingModuleHint(error) : null;
			post({
				type: 'PLUGIN_ERROR',
				requestId,
				error,
				traceback,
				logs: [...envLogs, ...logs, ...sandboxLogs, ...(hint ? [hint] : [])],
			});
			return;
		}

		const payloadJson = pyodide.globals.get('_result_payload') as string;
		const payload = JSON.parse(payloadJson) as {
			primary_artifact: string | null;
			artifacts: Record<string, string | { __bytes_b64: string }>;
			plugin_result: Record<string, unknown> | null;
			mutation_log: Record<string, unknown>[] | null;
			logs: string[];
		};

		// Decode base64-encoded binary artifacts back to Uint8Array
		const artifacts: Record<string, string | Uint8Array> = {};
		for (const [k, v] of Object.entries(payload.artifacts)) {
			if (v && typeof v === 'object' && '__bytes_b64' in v) {
				const binaryStr = atob(v.__bytes_b64);
				artifacts[k] = Uint8Array.from(binaryStr, (c) => c.charCodeAt(0));
			} else {
				artifacts[k] = v as string;
			}
		}

		post({
			type: 'PLUGIN_RESULT',
			requestId,
			primaryArtifact: payload.primary_artifact,
			artifacts,
			pluginResult: payload.plugin_result,
			mutationLog: payload.mutation_log ?? null,
			logs: [...envLogs, ...payload.logs, ...sandboxLogs],
		});
	} catch (e) {
		post({
			type: 'PLUGIN_ERROR',
			requestId,
			error: describeError(e),
			traceback: e instanceof Error ? (e.stack ?? '') : '',
			logs: [...envLogs, ...(blockedHosts ? await takeBlockedRequestLogs() : [])],
		});
	} finally {
		// Release large globals (JSON strings, zip buffers) so they can be GC'd
		// between runs, especially important for large designs.
		for (const key of RUN_GLOBALS) {
			pyodide?.globals.delete(key);
		}
	}
}

// ---------------------------------------------------------------------------
// Message dispatch
// ---------------------------------------------------------------------------

// Serialize all RUN_PLUGIN executions so concurrent requests cannot overwrite
// shared Pyodide globals while a run is in progress.
let runQueue: Promise<void> = Promise.resolve();

workerCtx.onmessage = (event) => {
	const msg = event.data;
	if (msg.type === SANDBOX_PORT_HANDOFF) {
		const port = event.ports[0];
		channel = port;
		const connectSources = connectSourcesFromCsp((msg as SandboxPortHandoff).csp ?? '');
		if (connectSources) explainFailedRequests(connectSources);
		port.onmessage = (portEvent: MessageEvent<WorkerRequest>) => handleRequest(portEvent.data);
		return;
	}
	handleRequest(msg);
};

/** Same lookup `loadPackagesFromImports` does, without loading anything. */
function resolveImports(requestId: string, code: string): void {
	if (!pyodide) {
		post({ type: 'IMPORTS_ERROR', requestId, error: 'Runtime not initialized' });
		return;
	}
	try {
		pyodide.globals.set('_resolve_imports_code', code);
		const found = pyodide.runPython(
			'from pyodide.code import find_imports\nfind_imports(_resolve_imports_code)'
		) as { toJs(): string[]; destroy(): void };
		const imports = found.toJs();
		found.destroy();
		pyodide.globals.delete('_resolve_imports_code');
		const byImport = new Map<string, string>();
		for (const pkg of Object.values(pyodide.lockfile.packages)) {
			for (const name of pkg.imports) byImport.set(name, pkg.name);
		}
		const packages = new Set<string>();
		for (const name of imports) {
			const pkg = byImport.get(name.split('.')[0]);
			if (pkg) packages.add(pkg);
		}
		post({ type: 'IMPORTS_RESOLVED', requestId, packages: [...packages].sort() });
	} catch (e) {
		post({
			type: 'IMPORTS_ERROR',
			requestId,
			error: e instanceof Error ? e.message : String(e),
		});
	}
}

function handleRequest(msg: WorkerRequest): void {
	switch (msg.type) {
		case 'INIT_RUNTIME':
			void initRuntime(msg.indexUrl, msg.packageBaseUrl);
			break;
		case 'INSTALL_PLUGIN':
			void installPlugin(msg.requestId, msg.micropipPackages, msg.preloadedWheels);
			break;
		case 'RESOLVE_IMPORTS':
			resolveImports(msg.requestId, msg.code);
			break;
		case 'RUN_PLUGIN': {
			const task = () => {
				if (msg.pluginZipData && pyodide) {
					pyodide.FS.writeFile('/plugin.zip', new Uint8Array(msg.pluginZipData));
				}
				return runPlugin(
					msg.requestId,
					msg.pluginCode ?? '',
					msg.pluginZipData != null,
					msg.format,
					msg.cadnanoJsonIn ?? null,
					msg.foldnanoJsonIn ?? null,
					msg.paramsJson ?? null,
					msg.sidePanelInputJson ?? null,
					msg.activeRegionId ?? null,
					msg.loadImports ?? false
				);
			};
			// Append to the queue; errors from a previous run do not block the next.
			runQueue = runQueue.then(task, task);
			break;
		}
	}
}
