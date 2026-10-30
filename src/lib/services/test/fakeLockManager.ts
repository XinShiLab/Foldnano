/**
 * In-memory stand-in for `navigator.locks` (jsdom has none), modelling the parts of the Web Locks
 * spec that TabSync and agent runs rely on: exclusive grant, FIFO queue, `ifAvailable`, `steal`
 * (the previous holder's request rejects with AbortError and the stealer is granted at once), and
 * `signal` aborting a queued request. Instances in one test behave like separate tabs sharing the manager.
 */

interface LockRequest {
	name: string;
	callback: (lock: { name: string; mode: 'exclusive' }) => unknown;
	resolve: (value: unknown) => void;
	reject: (reason: unknown) => void;
}

const abortError = () => new DOMException('The lock request was aborted', 'AbortError');

export class FakeLockManager {
	readonly #held = new Map<string, LockRequest>();
	readonly #queues = new Map<string, LockRequest[]>();

	request(
		name: string,
		optionsOrCallback: LockOptions | LockRequest['callback'],
		maybeCallback?: LockRequest['callback']
	): Promise<unknown> {
		const options = typeof optionsOrCallback === 'function' ? {} : optionsOrCallback;
		const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback!;
		return new Promise((resolve, reject) => {
			const request: LockRequest = { name, callback, resolve, reject };
			if (options.signal?.aborted) return reject(abortError());
			if (options.ifAvailable && (this.#held.has(name) || this.#queues.get(name)?.length)) {
				Promise.resolve()
					.then(() => (callback as unknown as (lock: null) => unknown)(null))
					.then(resolve, reject);
				return;
			}
			if (options.steal) {
				const holder = this.#held.get(name);
				this.#held.delete(name);
				holder?.reject(abortError());
				this.#grant(request);
				return;
			}
			const queue = this.#queues.get(name) ?? [];
			this.#queues.set(name, queue);
			queue.push(request);
			options.signal?.addEventListener('abort', () => {
				const index = queue.indexOf(request);
				if (index < 0) return;
				queue.splice(index, 1);
				reject(abortError());
			});
			this.#grantNext(name);
		});
	}

	/** Names of the locks currently held. */
	heldNames(): string[] {
		return [...this.#held.keys()];
	}

	#grantNext(name: string) {
		if (this.#held.has(name)) return;
		const next = this.#queues.get(name)?.shift();
		if (next) this.#grant(next);
	}

	#grant(request: LockRequest) {
		this.#held.set(request.name, request);
		const release = (settle: () => void) => {
			// A stolen holder was already rejected; its callback finishing later changes nothing.
			if (this.#held.get(request.name) !== request) return;
			this.#held.delete(request.name);
			settle();
			this.#grantNext(request.name);
		};
		Promise.resolve()
			.then(() => request.callback({ name: request.name, mode: 'exclusive' }))
			.then(
				(value) => release(() => request.resolve(value)),
				(err) => release(() => request.reject(err))
			);
	}
}

/** Installs a fresh FakeLockManager as `navigator.locks`; call the returned function to remove it. */
export function installFakeLocks(): { locks: FakeLockManager; uninstall: () => void } {
	const locks = new FakeLockManager();
	Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });
	return {
		locks,
		uninstall: () => {
			delete (navigator as { locks?: unknown }).locks;
		},
	};
}

/** Lets queued lock grants, rejections and their follow-up callbacks run. */
export async function flushLocks(): Promise<void> {
	for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}
