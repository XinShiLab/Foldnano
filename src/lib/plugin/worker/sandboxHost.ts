/**
 * Plugin sandbox host.
 *
 * Runs the Pyodide worker inside a hidden `<iframe sandbox="allow-scripts">`
 * (no `allow-same-origin`, so its origin is opaque). Plugin code therefore
 * cannot reach the app's origin: no `/api/*` with the user's cookies, no
 * IndexedDB, Web Locks or BroadcastChannel. A CSP in the iframe (inherited by
 * its blob: worker) enforces the network allowlist.
 *
 * Boot: the host posts the worker source and one end of a MessageChannel into
 * the iframe; the iframe starts a classic blob: worker and hands it the port.
 * After that, protocol traffic flows host ↔ worker directly over the port.
 *
 * See docs/python-plugin-system.md § Sandbox and
 * docs/explorations/plugin-sandbox-spike-2026-09-29.md.
 */

import { SANDBOX_PORT_HANDOFF, type WorkerRequest, type WorkerResponse } from './protocol';
import { pyodideUrls } from './pyodideConfig';

const BOOT_MESSAGE = 'foldnano-sandbox-boot';
const ERROR_MESSAGE = 'foldnano-sandbox-error';

/** The subset of `Worker` the bridge uses; satisfied by `Worker` and `SandboxedWorker`. */
export interface WorkerLike {
	postMessage(message: WorkerRequest, transfer?: Transferable[]): void;
	terminate(): void;
	onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
}

/**
 * CSP for the sandbox document. `connectSources` is the plugin's network
 * allowlist (networkPolicy.connectSourcesFor). Scripts may load only from the
 * self-hosted Pyodide core path; the core and package paths are always
 * connectable so the runtime can load.
 */
export function buildSandboxCsp(connectSources: readonly string[]): string {
	const { indexUrl, packageBaseUrl } = pyodideUrls(location.href);
	const connect = [...new Set([indexUrl, packageBaseUrl, ...connectSources])];
	return [
		"default-src 'none'",
		`script-src 'unsafe-inline' ${indexUrl} 'wasm-unsafe-eval'`,
		'worker-src blob:',
		`connect-src ${connect.join(' ')}`,
	].join('; ');
}

function bootstrapDocument(csp: string): string {
	// Runs inside the opaque-origin iframe. Accepts exactly one boot message from its parent.
	const script = `
onmessage = (e) => {
	if (e.source !== parent || !e.data || e.data.type !== '${BOOT_MESSAGE}') return;
	onmessage = null;
	const report = (message) => parent.postMessage({ type: '${ERROR_MESSAGE}', message }, '*');
	try {
		const url = URL.createObjectURL(new Blob([e.data.source], { type: 'text/javascript' }));
		const worker = new Worker(url);
		worker.onerror = (ev) => {
			ev.preventDefault();
			report(ev.message || 'Plugin worker failed to start');
		};
		worker.postMessage({ type: '${SANDBOX_PORT_HANDOFF}', csp: ${JSON.stringify(csp)} }, [e.ports[0]]);
	} catch (err) {
		report(String(err));
	}
};`;
	return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}"><script>${script}</script>`;
}

async function loadWorkerSource(): Promise<string> {
	return (await import('./pyodide.worker.ts?sandbox-worker')).default;
}

export interface SandboxedWorkerOptions {
	/** Override the worker source loader (tests). */
	loadSource?: () => Promise<string>;
}

/** A Pyodide worker running in an opaque-origin iframe, exposed with a Worker-like API. */
export class SandboxedWorker implements WorkerLike {
	onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;

	private readonly iframe: HTMLIFrameElement;
	private readonly port: MessagePort;
	private readonly onWindowMessage: (event: MessageEvent) => void;
	private terminated = false;

	constructor(csp: string, options: SandboxedWorkerOptions = {}) {
		const channel = new MessageChannel();
		this.port = channel.port1;
		// Messages posted before the worker adopts the port queue on port2 and travel with it.
		this.port.onmessage = (event: MessageEvent<WorkerResponse>) => this.onmessage?.(event);

		this.iframe = document.createElement('iframe');
		this.iframe.setAttribute('sandbox', 'allow-scripts');
		this.iframe.setAttribute('aria-hidden', 'true');
		this.iframe.tabIndex = -1;
		this.iframe.style.display = 'none';
		this.iframe.srcdoc = bootstrapDocument(csp);

		this.onWindowMessage = (event) => {
			if (event.source !== this.iframe.contentWindow) return;
			const data = event.data as { type?: unknown; message?: unknown } | null;
			if (data?.type === ERROR_MESSAGE) this.fail(String(data.message));
		};
		window.addEventListener('message', this.onWindowMessage);

		const loaded = new Promise<void>((resolve) =>
			this.iframe.addEventListener('load', () => resolve(), { once: true })
		);
		document.body.appendChild(this.iframe);

		const loadSource = options.loadSource ?? loadWorkerSource;
		Promise.all([loadSource(), loaded]).then(
			([source]) => {
				if (this.terminated) return;
				// An opaque origin can only be addressed with '*'.
				this.iframe.contentWindow?.postMessage({ type: BOOT_MESSAGE, source }, '*', [
					channel.port2,
				]);
			},
			(err: unknown) => this.fail(`Failed to load the plugin worker: ${String(err)}`)
		);
	}

	postMessage(message: WorkerRequest, transfer: Transferable[] = []): void {
		this.port.postMessage(message, transfer);
	}

	terminate(): void {
		if (this.terminated) return;
		this.terminated = true;
		window.removeEventListener('message', this.onWindowMessage);
		this.port.close();
		// Removing the iframe destroys its worker, stopping any running Python.
		this.iframe.remove();
	}

	private fail(message: string): void {
		if (this.terminated) return;
		this.onerror?.(new ErrorEvent('error', { message }));
	}
}
