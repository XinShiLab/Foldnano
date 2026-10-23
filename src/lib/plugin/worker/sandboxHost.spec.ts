import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkerResponse } from './protocol';
import { pyodideUrls } from './pyodideConfig';
import { PYPI_CONNECT_SOURCES } from '../networkPolicy';
import { buildSandboxCsp, SandboxedWorker } from './sandboxHost';

const { indexUrl: CORE_URL, packageBaseUrl: PACKAGE_URL } = pyodideUrls(location.href);

function sandboxIframes(): HTMLIFrameElement[] {
	return [...document.querySelectorAll('iframe')];
}

function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Starts a SandboxedWorker and captures the boot message it posts into the iframe. */
async function bootWorker(loadSource = () => Promise.resolve('/* worker */')) {
	const worker = new SandboxedWorker(buildSandboxCsp([]), { loadSource });
	const iframe = sandboxIframes().at(-1)!;
	const postToIframe = vi.spyOn(iframe.contentWindow!, 'postMessage');
	iframe.dispatchEvent(new Event('load'));
	await flush();
	const call = postToIframe.mock.calls[0] as unknown as
		[{ type: string; source: string }, string, Transferable[]] | undefined;
	return { worker, iframe, boot: call };
}

afterEach(() => {
	for (const iframe of sandboxIframes()) iframe.remove();
});

describe('buildSandboxCsp', () => {
	it('denies by default and allows only the Pyodide paths plus the given hosts', () => {
		const csp = buildSandboxCsp(PYPI_CONNECT_SOURCES);
		expect(csp).toContain("default-src 'none'");
		expect(csp).toContain('worker-src data:');
		expect(csp).toContain(`connect-src ${CORE_URL}`);
		expect(csp).toContain(PACKAGE_URL);
		expect(csp).toContain(PYPI_CONNECT_SOURCES.join(' '));
	});

	it('runs scripts only from the Pyodide core path', () => {
		const scriptSrc = buildSandboxCsp([])
			.split('; ')
			.find((d) => d.startsWith('script-src'));
		expect(scriptSrc).toBe(`script-src 'unsafe-inline' ${CORE_URL} 'wasm-unsafe-eval'`);
	});

	it('never grants string eval, only WebAssembly compilation', () => {
		const csp = buildSandboxCsp([]);
		expect(csp).not.toContain("'unsafe-eval'");
		expect(csp).toContain("'wasm-unsafe-eval'");
	});

	it('does not repeat the Pyodide paths', () => {
		const connect = buildSandboxCsp([CORE_URL, PACKAGE_URL])
			.split('; ')
			.find((d) => d.startsWith('connect-src'))!
			.split(' ');
		expect(new Set(connect).size).toBe(connect.length);
	});
});

describe('SandboxedWorker', () => {
	it('hosts the worker in a hidden iframe with an opaque origin and the CSP', () => {
		const csp = buildSandboxCsp([]);
		new SandboxedWorker(csp, { loadSource: () => Promise.resolve('') });
		const iframe = sandboxIframes().at(-1)!;
		expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
		expect(iframe.style.display).toBe('none');
		expect(iframe.srcdoc).toContain(`content="${csp}"`);
	});

	it('starts a module worker from a data: URL, which Pyodide 314+ needs', () => {
		new SandboxedWorker(buildSandboxCsp([]), { loadSource: () => Promise.resolve('') });
		const srcdoc = sandboxIframes().at(-1)!.srcdoc;
		expect(srcdoc).toContain("'data:text/javascript;charset=utf-8,'");
		expect(srcdoc).toContain("new Worker(url, { type: 'module' })");
		expect(srcdoc).not.toContain('createObjectURL');
	});

	it('boots by posting the worker source and a MessagePort into the iframe', async () => {
		const { boot } = await bootWorker(() => Promise.resolve('WORKER_SOURCE'));
		expect(boot).toBeDefined();
		const [data, targetOrigin, transfer] = boot!;
		expect(data).toEqual({ type: 'foldnano-sandbox-boot', source: 'WORKER_SOURCE' });
		expect(targetOrigin).toBe('*');
		expect(transfer[0]).toBeInstanceOf(MessagePort);
	});

	it('forwards messages both ways over the handed-off port', async () => {
		const { worker, boot } = await bootWorker();
		const workerPort = boot![2][0] as MessagePort;

		const received = new Promise<unknown>((resolve) => {
			workerPort.onmessage = (e) => resolve(e.data);
		});
		const init = { type: 'INIT_RUNTIME', indexUrl: CORE_URL, packageBaseUrl: CORE_URL } as const;
		worker.postMessage(init);
		expect(await received).toEqual(init);

		const response = new Promise<WorkerResponse>((resolve) => {
			worker.onmessage = (e) => resolve(e.data);
		});
		workerPort.postMessage({ type: 'RUNTIME_READY' } satisfies WorkerResponse);
		expect(await response).toEqual({ type: 'RUNTIME_READY' });

		worker.terminate();
		workerPort.close();
	});

	it('reports errors posted by its own iframe and ignores other windows', async () => {
		const { worker, iframe } = await bootWorker();
		const onerror = vi.fn();
		worker.onerror = onerror;
		const data = { type: 'foldnano-sandbox-error', message: 'boom' };

		window.dispatchEvent(new MessageEvent('message', { data, source: window }));
		expect(onerror).not.toHaveBeenCalled();

		window.dispatchEvent(new MessageEvent('message', { data, source: iframe.contentWindow }));
		expect(onerror).toHaveBeenCalledOnce();
		expect((onerror.mock.calls[0][0] as ErrorEvent).message).toBe('boom');
		worker.terminate();
	});

	it('reports a failure to load the worker source', async () => {
		const worker = new SandboxedWorker(buildSandboxCsp([]), {
			loadSource: () => Promise.reject(new Error('offline')),
		});
		const onerror = vi.fn();
		worker.onerror = onerror;
		sandboxIframes().at(-1)!.dispatchEvent(new Event('load'));
		await flush();
		expect((onerror.mock.calls[0][0] as ErrorEvent).message).toContain('offline');
		worker.terminate();
	});

	it('terminate removes the iframe and silences later errors', async () => {
		const { worker, iframe } = await bootWorker();
		const contentWindow = iframe.contentWindow;
		const onerror = vi.fn();
		worker.onerror = onerror;
		worker.terminate();
		expect(iframe.isConnected).toBe(false);
		window.dispatchEvent(
			new MessageEvent('message', {
				data: { type: 'foldnano-sandbox-error', message: 'late' },
				source: contentWindow,
			})
		);
		expect(onerror).not.toHaveBeenCalled();
	});

	it('does not boot if terminated before the iframe loads', async () => {
		const worker = new SandboxedWorker(buildSandboxCsp([]), {
			loadSource: () => Promise.resolve(''),
		});
		const iframe = sandboxIframes().at(-1)!;
		const postToIframe = vi.spyOn(iframe.contentWindow!, 'postMessage');
		worker.terminate();
		iframe.dispatchEvent(new Event('load'));
		await flush();
		expect(postToIframe).not.toHaveBeenCalled();
	});
});
