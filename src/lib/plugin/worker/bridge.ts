/**
 * PyodideWorkerBridge
 *
 * Typed wrapper around the Pyodide Web Worker. Key design goals:
 *
 *   - Isolation: by default the worker runs in the opaque-origin plugin
 *     sandbox (sandboxHost.ts), never as a same-origin Worker.
 *   - Lazy creation: the Worker is not spawned until the first call.
 *   - Single runtime: `initRuntime()` is idempotent — multiple callers
 *     all await the same Promise.
 *   - Promise map: each in-flight request is tracked by `requestId` so
 *     concurrent installs and runs can proceed independently.
 *   - Timeout: every request times out if the worker doesn't respond.
 *   - Testability: an optional `workerFactory` lets tests inject a
 *     MockWorker without touching the real Worker constructor.
 */

import type {
	WorkerRequest,
	WorkerResponse,
	RunPluginRequest,
	PluginResultResponse,
} from './protocol';
import { pyodideUrls } from './pyodideConfig';
import { buildSandboxCsp, SandboxedWorker, type WorkerLike } from './sandboxHost';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type LogCallback = (requestId: string, message: string) => void;

/**
 * A run exceeded its timeout. Python is still executing in the worker (it
 * can't be interrupted), so the owner must terminate the worker.
 */
export class RunTimeoutError extends Error {
	override readonly name = 'RunTimeoutError';
}

export interface PyodideWorkerBridgeTimeouts {
	/** Override the init timeout (default: 120 000 ms). */
	initMs?: number;
	/** Override the install/misc timeout (default: 30 000 ms). */
	defaultMs?: number;
	/** Override the run timeout (default: 300 000 ms). */
	runMs?: number;
}

export interface PyodideWorkerBridgeOptions {
	/** Called for each PLUGIN_LOG message streamed during a run. */
	onLog?: LogCallback;
	/** Override the worker constructor for testing. */
	workerFactory?: () => WorkerLike;
	/** Override individual timeout values (useful in tests). */
	timeouts?: PyodideWorkerBridgeTimeouts;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** How long to wait for install/misc requests before rejecting. */
const DEFAULT_TIMEOUT_MS = 30_000;
/** Pyodide init downloads ~13 MB, so allow more time. */
const INIT_TIMEOUT_MS = 120_000;
/** Run timeout — plugins on large designs can take several minutes. */
const RUN_TIMEOUT_MS = 300_000;

interface PendingRequest {
	resolve: (response: WorkerResponse) => void;
	reject: (error: Error) => void;
	timeoutId: ReturnType<typeof setTimeout>;
}

function defaultWorkerFactory(): WorkerLike {
	// Pyodide origin only; PluginCoordinator passes each plugin's network policy.
	return new SandboxedWorker(buildSandboxCsp([]));
}

// ---------------------------------------------------------------------------
// PyodideWorkerBridge
// ---------------------------------------------------------------------------

export class PyodideWorkerBridge {
	private worker: WorkerLike | null = null;
	private readonly pending = new Map<string, PendingRequest>();
	private readyPromise: Promise<void> | null = null;
	private readyResolve: (() => void) | null = null;
	private readyReject: ((e: Error) => void) | null = null;
	private readonly onLog: LogCallback;
	private readonly workerFactory: () => WorkerLike;
	private readonly timeoutInit: number;
	private readonly timeoutDefault: number;
	private readonly timeoutRun: number;

	constructor(options?: PyodideWorkerBridgeOptions) {
		this.onLog = options?.onLog ?? (() => {});
		this.workerFactory = options?.workerFactory ?? defaultWorkerFactory;
		this.timeoutInit = options?.timeouts?.initMs ?? INIT_TIMEOUT_MS;
		this.timeoutDefault = options?.timeouts?.defaultMs ?? DEFAULT_TIMEOUT_MS;
		this.timeoutRun = options?.timeouts?.runMs ?? RUN_TIMEOUT_MS;
	}

	// -------------------------------------------------------------------------
	// Public API
	// -------------------------------------------------------------------------

	/**
	 * Initialize the Pyodide runtime. Spawns the worker if needed and waits
	 * for RUNTIME_READY. Safe to call multiple times — always returns the
	 * same Promise after the first call.
	 */
	initRuntime(): Promise<void> {
		if (this.readyPromise) return this.readyPromise;

		this.readyPromise = new Promise<void>((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				this.readyPromise = null; // allow retry after timeout
				reject(new Error(`Pyodide runtime init timed out after ${this.timeoutInit} ms`));
			}, this.timeoutInit);

			this.readyResolve = () => {
				clearTimeout(timeoutId);
				resolve();
			};
			this.readyReject = (e) => {
				clearTimeout(timeoutId);
				this.readyPromise = null; // allow retry after error
				reject(e);
			};

			const worker = this.ensureWorker();
			worker.postMessage({
				type: 'INIT_RUNTIME',
				...pyodideUrls(location.href),
			} satisfies WorkerRequest);
		});

		return this.readyPromise;
	}

	/**
	 * Install plugin dependencies in the Pyodide worker.
	 * - `micropipPackages`: package names resolved by micropip (e.g. 'numpy').
	 * - `preloadedWheels`: wheel bytes pre-fetched on the main thread; the worker
	 *   writes them directly to Pyodide VFS without an additional network request.
	 */
	installPlugin(
		requestId: string,
		micropipPackages: string[],
		preloadedWheels: Array<{ filename: string; data: ArrayBuffer }>
	): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				this.pending.delete(requestId);
				reject(new Error(`installPlugin timed out (requestId=${requestId})`));
			}, this.timeoutDefault);

			this.pending.set(requestId, {
				resolve: (response) => {
					if (response.type === 'INSTALL_DONE') {
						resolve();
					} else if (response.type === 'INSTALL_ERROR') {
						console.error('[bridge] INSTALL_ERROR:', response.error);
						reject(new Error(response.error));
					}
				},
				reject,
				timeoutId,
			});

			// Transfer wheel ArrayBuffers to the worker (zero-copy).
			// Each ArrayBuffer is detached after transfer, so callers must pass copies.
			const transfer: Transferable[] = preloadedWheels.map((w) => w.data);
			this.ensureWorker().postMessage(
				{
					type: 'INSTALL_PLUGIN',
					requestId,
					micropipPackages,
					preloadedWheels,
				} satisfies WorkerRequest,
				transfer
			);
		});
	}

	/**
	 * Run a plugin. Resolves with the PLUGIN_RESULT response on success.
	 * Rejects with an Error (with `.traceback` and `.logs` properties) on plugin error.
	 */
	runPlugin(options: Omit<RunPluginRequest, 'type'>): Promise<PluginResultResponse> {
		const { requestId } = options;

		return new Promise<PluginResultResponse>((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				this.pending.delete(requestId);
				reject(
					new RunTimeoutError(
						`The plugin run timed out after ${Math.round(this.timeoutRun / 1000)} s ` +
							`(requestId=${requestId})`
					)
				);
			}, this.timeoutRun);

			this.pending.set(requestId, {
				resolve: (response) => {
					if (response.type === 'PLUGIN_RESULT') {
						resolve(response);
					} else if (response.type === 'PLUGIN_ERROR') {
						const err = new Error(response.error) as Error & {
							traceback: string;
							logs: string[];
						};
						err.traceback = response.traceback;
						err.logs = response.logs;
						reject(err);
					}
				},
				reject,
				timeoutId,
			});

			// Slice the zip buffer before transferring so the original ArrayBuffer
			// in plugin.resolvedZipData stays intact for subsequent runs.
			// Transferring without slicing detaches the buffer on the main thread.
			const zipCopy = options.pluginZipData ? options.pluginZipData.slice(0) : undefined;
			const msg = {
				type: 'RUN_PLUGIN' as const,
				...options,
				pluginZipData: zipCopy,
			} satisfies WorkerRequest;
			const transfer: Transferable[] = [];
			if (zipCopy) transfer.push(zipCopy);
			this.ensureWorker().postMessage(msg, transfer);
		});
	}

	/**
	 * Terminate the underlying Worker, stopping any running Python. After this,
	 * `initRuntime()` must be called again before any further operations.
	 */
	terminate(): void {
		this.worker?.terminate();
		this.worker = null;

		// Reject any in-flight initRuntime() awaiter before nulling the callbacks
		const readyReject = this.readyReject;
		this.readyPromise = null;
		this.readyResolve = null;
		this.readyReject = null;
		readyReject?.(new Error('Worker terminated'));

		// Reject all in-flight runPlugin / installPlugin calls so their awaiting
		// promises settle immediately rather than hanging forever
		const error = new Error('Worker terminated');
		for (const [, pending] of this.pending) {
			clearTimeout(pending.timeoutId);
			pending.reject(error);
		}
		this.pending.clear();
	}

	// -------------------------------------------------------------------------
	// Private helpers
	// -------------------------------------------------------------------------

	private ensureWorker(): WorkerLike {
		if (!this.worker) {
			this.worker = this.workerFactory();
			this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
				this.handleMessage(event.data);
			};
			this.worker.onerror = (event) => {
				const error = new Error(event.message ?? 'Worker error');
				this.readyReject?.(error);
				for (const [, pending] of this.pending) {
					clearTimeout(pending.timeoutId);
					pending.reject(error);
				}
				this.pending.clear();
			};
		}
		return this.worker;
	}

	private handleMessage(msg: WorkerResponse): void {
		switch (msg.type) {
			case 'RUNTIME_READY':
				this.readyResolve?.();
				break;

			case 'RUNTIME_ERROR':
				this.readyReject?.(new Error(msg.error));
				break;

			case 'INSTALL_DONE':
			case 'INSTALL_ERROR': {
				const pending = this.pending.get(msg.requestId);
				if (pending) {
					clearTimeout(pending.timeoutId);
					this.pending.delete(msg.requestId);
					pending.resolve(msg);
				}
				break;
			}

			case 'PLUGIN_RESULT':
			case 'PLUGIN_ERROR': {
				const pending = this.pending.get(msg.requestId);
				if (pending) {
					clearTimeout(pending.timeoutId);
					this.pending.delete(msg.requestId);
					pending.resolve(msg);
				}
				break;
			}

			case 'PLUGIN_LOG':
				// Deliver to the streaming log callback but do NOT resolve the pending
				// request — it still waits for PLUGIN_RESULT / PLUGIN_ERROR.
				this.onLog(msg.requestId, msg.message);
				break;
		}
	}
}
