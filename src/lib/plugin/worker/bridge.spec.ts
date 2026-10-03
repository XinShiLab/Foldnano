import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PyodideWorkerBridge, RunTimeoutError } from './bridge';
import { pyodideUrls } from './pyodideConfig';
import type { WorkerResponse } from './protocol';

// ---------------------------------------------------------------------------
// MockWorker — simulates the Pyodide web worker
// ---------------------------------------------------------------------------

class MockWorker {
	onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	postMessage = vi.fn();
	terminate = vi.fn();

	/** Push a response from the worker to the bridge's onmessage handler. */
	respond(msg: WorkerResponse): void {
		this.onmessage?.({ data: msg } as MessageEvent<WorkerResponse>);
	}

	/** Simulate a fatal worker error (e.g. syntax error in the worker script). */
	fatalError(message: string): void {
		this.onerror?.({ message } as ErrorEvent);
	}
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let mockWorker: MockWorker;
let bridge: PyodideWorkerBridge;

beforeEach(() => {
	mockWorker = new MockWorker();
	bridge = new PyodideWorkerBridge({
		workerFactory: () => mockWorker as unknown as Worker,
	});
});

// ---------------------------------------------------------------------------
// INIT_RUNTIME
// ---------------------------------------------------------------------------

describe('initRuntime', () => {
	it('sends INIT_RUNTIME with absolute Pyodide URLs to the worker', async () => {
		const p = bridge.initRuntime();
		mockWorker.respond({ type: 'RUNTIME_READY' });
		await p;
		expect(mockWorker.postMessage).toHaveBeenCalledWith({
			type: 'INIT_RUNTIME',
			...pyodideUrls(location.href),
		});
	});

	it('resolves when the worker sends RUNTIME_READY', async () => {
		const p = bridge.initRuntime();
		mockWorker.respond({ type: 'RUNTIME_READY' });
		await expect(p).resolves.toBeUndefined();
	});

	it('rejects when the worker sends RUNTIME_ERROR', async () => {
		const p = bridge.initRuntime();
		mockWorker.respond({ type: 'RUNTIME_ERROR', error: 'WASM load failed' });
		await expect(p).rejects.toThrow('WASM load failed');
	});

	it('returns the same Promise on repeated calls (idempotent)', () => {
		const p1 = bridge.initRuntime();
		const p2 = bridge.initRuntime();
		expect(p1).toBe(p2);
		mockWorker.respond({ type: 'RUNTIME_READY' });
	});

	it('spawns the Worker lazily on the first call', () => {
		// Before any call the factory must not have been invoked
		const factory = vi.fn(() => mockWorker as unknown as Worker);
		const b = new PyodideWorkerBridge({ workerFactory: factory });
		expect(factory).not.toHaveBeenCalled();
		b.initRuntime();
		expect(factory).toHaveBeenCalledOnce();
	});

	it('allows retry after RUNTIME_ERROR', async () => {
		const p1 = bridge.initRuntime();
		mockWorker.respond({ type: 'RUNTIME_ERROR', error: 'first attempt failed' });
		await expect(p1).rejects.toThrow();

		// Second attempt should create a new promise
		const p2 = bridge.initRuntime();
		expect(p2).not.toBe(p1);
		mockWorker.respond({ type: 'RUNTIME_READY' });
		await expect(p2).resolves.toBeUndefined();
	});

	it('rejects all pending requests on worker onerror', async () => {
		const initP = bridge.initRuntime();
		mockWorker.respond({ type: 'RUNTIME_READY' });
		await initP;

		const runP = bridge.runPlugin({
			requestId: 'r1',
			pluginCode: 'def run(ctx): pass',
			pluginLabel: 'test',
			format: 'cadnano_json',
			activePartIndex: 0,
		});

		mockWorker.fatalError('worker crashed');
		await expect(runP).rejects.toThrow('worker crashed');
	});
});

// ---------------------------------------------------------------------------
// INSTALL_PLUGIN
// ---------------------------------------------------------------------------

describe('installPlugin', () => {
	beforeEach(async () => {
		const p = bridge.initRuntime();
		mockWorker.respond({ type: 'RUNTIME_READY' });
		await p;
	});

	it('sends INSTALL_PLUGIN with the given requestId and packages', () => {
		bridge.installPlugin('req-1', ['numpy', 'scipy'], []);
		expect(mockWorker.postMessage).toHaveBeenCalledWith(
			{
				type: 'INSTALL_PLUGIN',
				requestId: 'req-1',
				micropipPackages: ['numpy', 'scipy'],
				preloadedWheels: [],
			},
			[]
		);
	});

	it('resolves on INSTALL_DONE', async () => {
		const p = bridge.installPlugin('req-2', ['numpy'], []);
		mockWorker.respond({ type: 'INSTALL_DONE', requestId: 'req-2' });
		await expect(p).resolves.toBeUndefined();
	});

	it('rejects on INSTALL_ERROR', async () => {
		const p = bridge.installPlugin('req-3', ['bad-package'], []);
		mockWorker.respond({
			type: 'INSTALL_ERROR',
			requestId: 'req-3',
			error: 'package not found',
		});
		await expect(p).rejects.toThrow('package not found');
	});

	it('handles concurrent installs independently', async () => {
		const p1 = bridge.installPlugin('req-a', ['numpy'], []);
		const p2 = bridge.installPlugin('req-b', ['scipy'], []);

		mockWorker.respond({ type: 'INSTALL_DONE', requestId: 'req-b' });
		mockWorker.respond({ type: 'INSTALL_DONE', requestId: 'req-a' });

		await expect(p1).resolves.toBeUndefined();
		await expect(p2).resolves.toBeUndefined();
	});

	it('times out if the worker never responds', async () => {
		vi.useFakeTimers();
		const shortBridge = new PyodideWorkerBridge({
			workerFactory: () => mockWorker as unknown as Worker,
			timeouts: { defaultMs: 500 },
		});
		const p = shortBridge.installPlugin('req-timeout', ['slow-package'], []);
		vi.advanceTimersByTime(501);
		await expect(p).rejects.toThrow(/timed out/);
		vi.useRealTimers();
	});
});

// ---------------------------------------------------------------------------
// RUN_PLUGIN
// ---------------------------------------------------------------------------

describe('runPlugin', () => {
	beforeEach(async () => {
		const p = bridge.initRuntime();
		mockWorker.respond({ type: 'RUNTIME_READY' });
		await p;
	});

	it('sends RUN_PLUGIN with all fields', () => {
		bridge.runPlugin({
			requestId: 'run-1',
			pluginCode: 'def run(ctx): ctx.log("hello")',
			pluginLabel: 'Hello World',
			format: 'cadnano_json',
			cadnanoJsonIn: '{"vstrands":[]}',
			activePartIndex: 0,
		});
		expect(mockWorker.postMessage).toHaveBeenCalledWith(
			{
				type: 'RUN_PLUGIN',
				requestId: 'run-1',
				pluginCode: 'def run(ctx): ctx.log("hello")',
				pluginLabel: 'Hello World',
				format: 'cadnano_json',
				cadnanoJsonIn: '{"vstrands":[]}',
				activePartIndex: 0,
			},
			[] // no transferables for a plain-code plugin
		);
	});

	it('resolves with PLUGIN_RESULT on success', async () => {
		const p = bridge.runPlugin({
			requestId: 'run-2',
			pluginCode: 'def run(ctx): ctx.log("done")',
			pluginLabel: 'test',
			format: 'cadnano_json',
			activePartIndex: 0,
		});
		mockWorker.respond({
			type: 'PLUGIN_RESULT',
			requestId: 'run-2',
			primaryArtifact: '{"name":"result"}',
			artifacts: {},
			pluginResult: { count: 3 },
			mutationLog: null,
			logs: ['done'],
		});
		const result = await p;
		expect(result.primaryArtifact).toBe('{"name":"result"}');
		expect(result.logs).toEqual(['done']);
		expect(result.pluginResult).toEqual({ count: 3 });
	});

	it('rejects with the error message on PLUGIN_ERROR', async () => {
		const p = bridge.runPlugin({
			requestId: 'run-3',
			pluginCode: 'def run(ctx): raise ValueError("bad")',
			pluginLabel: 'test',
			format: 'cadnano_json',
			activePartIndex: 0,
		});
		mockWorker.respond({
			type: 'PLUGIN_ERROR',
			requestId: 'run-3',
			error: 'bad',
			traceback: 'Traceback (most recent call last):\n  ...\nValueError: bad',
			logs: [],
		});
		await expect(p).rejects.toThrow('bad');
	});

	it('attaches traceback to the rejected Error', async () => {
		const p = bridge.runPlugin({
			requestId: 'run-4',
			pluginCode: '',
			pluginLabel: 'test',
			format: 'cadnano_json',
			activePartIndex: 0,
		});
		mockWorker.respond({
			type: 'PLUGIN_ERROR',
			requestId: 'run-4',
			error: 'oops',
			traceback: 'the traceback',
			logs: [],
		});
		try {
			await p;
			expect.fail('should have thrown');
		} catch (e) {
			expect((e as Error & { traceback: string }).traceback).toBe('the traceback');
		}
	});

	it('attaches logs captured before the crash to the rejected Error', async () => {
		const p = bridge.runPlugin({
			requestId: 'run-5',
			pluginCode: 'def run(ctx):\n    ctx.log("before crash")\n    raise ValueError("bad")',
			pluginLabel: 'test',
			format: 'cadnano_json',
			activePartIndex: 0,
		});
		mockWorker.respond({
			type: 'PLUGIN_ERROR',
			requestId: 'run-5',
			error: 'bad',
			traceback: 'the traceback',
			logs: ['before crash'],
		});
		try {
			await p;
			expect.fail('should have thrown');
		} catch (e) {
			expect((e as Error & { logs: string[] }).logs).toEqual(['before crash']);
		}
	});

	it('handles concurrent runs independently', async () => {
		const p1 = bridge.runPlugin({
			requestId: 'run-5a',
			pluginCode: '',
			pluginLabel: 'A',
			format: 'cadnano_json',
			activePartIndex: 0,
		});
		const p2 = bridge.runPlugin({
			requestId: 'run-5b',
			pluginCode: '',
			pluginLabel: 'B',
			format: 'foldnano_json',
			activePartIndex: 0,
		});

		mockWorker.respond({
			type: 'PLUGIN_RESULT',
			requestId: 'run-5b',
			primaryArtifact: 'b',
			artifacts: {},
			pluginResult: null,
			mutationLog: null,
			logs: [],
		});
		mockWorker.respond({
			type: 'PLUGIN_RESULT',
			requestId: 'run-5a',
			primaryArtifact: 'a',
			artifacts: {},
			pluginResult: null,
			mutationLog: null,
			logs: [],
		});

		const [r1, r2] = await Promise.all([p1, p2]);
		expect(r1.primaryArtifact).toBe('a');
		expect(r2.primaryArtifact).toBe('b');
	});

	it('times out if the worker never responds', async () => {
		vi.useFakeTimers();
		const shortBridge = new PyodideWorkerBridge({
			workerFactory: () => mockWorker as unknown as Worker,
			timeouts: { runMs: 500 },
		});
		// initRuntime must complete before runPlugin can be called.
		const init = shortBridge.initRuntime();
		mockWorker.respond({ type: 'RUNTIME_READY' });
		await init;
		const p = shortBridge.runPlugin({
			requestId: 'run-timeout',
			pluginCode: '',
			pluginLabel: 'test',
			format: 'cadnano_json',
			activePartIndex: 0,
		});
		vi.advanceTimersByTime(501);
		await expect(p).rejects.toThrow(/timed out/);
		await expect(p).rejects.toBeInstanceOf(RunTimeoutError);
		vi.useRealTimers();
	});
});

// ---------------------------------------------------------------------------
// PLUGIN_LOG (streaming)
// ---------------------------------------------------------------------------

describe('streaming logs via onLog callback', () => {
	it('calls onLog for each PLUGIN_LOG message', async () => {
		const logSpy = vi.fn();
		const b = new PyodideWorkerBridge({
			workerFactory: () => mockWorker as unknown as Worker,
			onLog: logSpy,
		});

		const initP = b.initRuntime();
		mockWorker.respond({ type: 'RUNTIME_READY' });
		await initP;

		b.runPlugin({
			requestId: 'log-1',
			pluginCode: '',
			pluginLabel: 'streaming test',
			format: 'cadnano_json',
			activePartIndex: 0,
		});

		mockWorker.respond({ type: 'PLUGIN_LOG', requestId: 'log-1', message: 'line 1' });
		mockWorker.respond({ type: 'PLUGIN_LOG', requestId: 'log-1', message: 'line 2' });

		expect(logSpy).toHaveBeenNthCalledWith(1, 'log-1', 'line 1');
		expect(logSpy).toHaveBeenNthCalledWith(2, 'log-1', 'line 2');
	});

	it('does not resolve the run promise on PLUGIN_LOG alone', async () => {
		const b = new PyodideWorkerBridge({
			workerFactory: () => mockWorker as unknown as Worker,
		});
		const initP = b.initRuntime();
		mockWorker.respond({ type: 'RUNTIME_READY' });
		await initP;

		let resolved = false;
		const runP = b.runPlugin({
			requestId: 'log-2',
			pluginCode: '',
			pluginLabel: 'test',
			format: 'cadnano_json',
			activePartIndex: 0,
		});
		runP.then(() => (resolved = true));

		mockWorker.respond({ type: 'PLUGIN_LOG', requestId: 'log-2', message: 'step 1' });
		// Flush microtasks
		await Promise.resolve();
		expect(resolved).toBe(false);

		// Now send the actual result
		mockWorker.respond({
			type: 'PLUGIN_RESULT',
			requestId: 'log-2',
			primaryArtifact: null,
			artifacts: {},
			pluginResult: null,
			mutationLog: null,
			logs: ['step 1'],
		});
		await runP;
		expect(resolved).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// terminate
// ---------------------------------------------------------------------------

describe('terminate', () => {
	it('calls Worker.terminate()', () => {
		bridge.initRuntime().catch(() => {}); // expected to reject when terminated
		bridge.terminate();
		expect(mockWorker.terminate).toHaveBeenCalledOnce();
	});

	it('allows a fresh initRuntime() after termination', async () => {
		const p1 = bridge.initRuntime();
		mockWorker.respond({ type: 'RUNTIME_READY' });
		await p1;

		bridge.terminate();

		// Create a fresh mock worker for the second init
		const mockWorker2 = new MockWorker();
		const b2 = new PyodideWorkerBridge({
			workerFactory: () => mockWorker2 as unknown as Worker,
		});
		const p2 = b2.initRuntime();
		mockWorker2.respond({ type: 'RUNTIME_READY' });
		await expect(p2).resolves.toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Hello World integration scenario
// ---------------------------------------------------------------------------

describe('hello_world plugin scenario (bridge-level)', () => {
	it('round-trips a cadnano_json plugin run end-to-end through the bridge', async () => {
		const initP = bridge.initRuntime();
		mockWorker.respond({ type: 'RUNTIME_READY' });
		await initP;

		const helloWorldCode = [
			'from foldnano.plugin import PluginContext',
			'',
			'def run(ctx):',
			'    import json',
			'    data = json.loads(ctx.get_part_as_cadnano_json())',
			'    ctx.log("Hello, Foldnano!")',
			'    ctx.set_result_cadnano_json(json.dumps(data))',
		].join('\n');

		const cadnanoInput = JSON.stringify({ name: 'test', vstrands: [] });

		const runP = bridge.runPlugin({
			requestId: 'hw-1',
			pluginCode: helloWorldCode,
			pluginLabel: 'Hello World',
			format: 'cadnano_json',
			cadnanoJsonIn: cadnanoInput,
			activePartIndex: 0,
		});

		// Simulate the worker completing the run
		mockWorker.respond({
			type: 'PLUGIN_RESULT',
			requestId: 'hw-1',
			primaryArtifact: cadnanoInput,
			artifacts: {},
			pluginResult: null,
			mutationLog: null,
			logs: ['Hello, Foldnano!'],
		});

		const result = await runP;
		expect(result.logs).toEqual(['Hello, Foldnano!']);
		expect(JSON.parse(result.primaryArtifact!)).toEqual({ name: 'test', vstrands: [] });
	});
});
