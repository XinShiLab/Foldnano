/**
 * Multi-tab ownership coordination via the Web Locks API.
 *
 * Each editor tab that opens a document creates a TabSync for that docId, which takes the
 * document's lock. Only the lock holder is the "owner" and may save or commit. The browser
 * guarantees a single holder and releases the lock when the holder's tab closes or crashes, so
 * there is no heartbeat to time out and no window where two tabs both believe they own the doc.
 *
 * Opening a document takes the lock over (`steal`), so the newest tab wins, as before. The tab it
 * was taken from turns read-only and queues for the lock; when the owner goes away it gets the
 * lock back and calls `onRegained` (the session reloads the saved copy first, since the other
 * tab may have saved newer work).
 */

export interface TabSyncOptions {
	/** Called when this tab gets the lock back after losing it. Resolve true once the caller has
	 * taken over (e.g. reloaded and replaced this TabSync); false makes this tab the owner as-is. */
	onRegained?: () => Promise<boolean>;
}

/** Web Locks need a secure context; without them each tab edits as if it were alone. */
export function isTabSyncSupported(): boolean {
	return typeof navigator !== 'undefined' && !!navigator.locks;
}

export class TabSync {
	readonly #lockName: string;
	readonly #onRegained: TabSyncOptions['onRegained'];
	/** Aborts a queued (not yet granted) lock request on destroy. */
	readonly #queued = new AbortController();
	/** Resolving it ends the held lock's callback, releasing the lock. */
	#releaseHeld: (() => void) | null = null;
	#destroyed = false;

	/** True when this tab currently owns the document (may save/commit). */
	isOwner: boolean = $state(true);

	constructor(docId: string, options: TabSyncOptions = {}) {
		this.#lockName = `foldnano-editor-${docId}`;
		this.#onRegained = options.onRegained;
		this.#request('steal');
	}

	#request(mode: 'steal' | 'queue') {
		const options: LockOptions =
			mode === 'steal' ? { steal: true } : { signal: this.#queued.signal };
		navigator.locks
			.request(this.#lockName, options, () => {
				if (this.#destroyed) return;
				if (mode === 'queue') void this.#regain();
				else this.isOwner = true;
				return new Promise<void>((resolve) => (this.#releaseHeld = resolve));
			})
			.catch((err: unknown) => {
				if (this.#destroyed) return;
				// Another tab stole the lock we held: yield, and wait for it to come back.
				if (err instanceof DOMException && err.name === 'AbortError') {
					this.#releaseHeld = null;
					this.isOwner = false;
					this.#request('queue');
					return;
				}
				console.error('[TabSync] lock request failed', err);
			});
	}

	async #regain() {
		const takenOver = this.#onRegained ? await this.#onRegained().catch(() => false) : false;
		if (!takenOver && !this.#destroyed) this.isOwner = true;
	}

	/** Release ownership (or stop waiting for it). Call this on component destroy or doc switch. */
	destroy() {
		this.#destroyed = true;
		this.#queued.abort();
		this.#releaseHeld?.();
		this.#releaseHeld = null;
	}
}
