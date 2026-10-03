/**
 * Debounced, awaited persistence for a code-editor side panel's buffer (Script Lab).
 *
 * Edits are saved 500 ms after typing stops; `flush()` saves a pending edit at once (panel
 * close, page hide), so closing within the debounce window no longer drops it. A failed write
 * sets `state` to 'error' until a later save succeeds, so the panel can show that the code is
 * not saved instead of losing it silently.
 */

export type EditorSaveState = 'saved' | 'pending' | 'saving' | 'error';

export const EDITOR_SAVE_DELAY_MS = 500;

export class EditorCodeSaver {
	state: EditorSaveState = $state('saved');
	/** Message of the last failed write, while `state` is 'error'. */
	errorMessage: string | null = $state(null);

	#write: (code: string) => Promise<void>;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#pendingCode: string | null = null;

	constructor(write: (code: string) => Promise<void>) {
		this.#write = write;
	}

	/** Records an edit; it is written after the debounce delay unless flushed sooner. */
	schedule(code: string): void {
		this.#pendingCode = code;
		if (this.state !== 'error') this.state = 'pending';
		clearTimeout(this.#timer);
		this.#timer = setTimeout(() => void this.flush(), EDITOR_SAVE_DELAY_MS);
	}

	/** Writes the pending edit now, if any. Resolves once it has been attempted. */
	async flush(): Promise<void> {
		clearTimeout(this.#timer);
		this.#timer = undefined;
		const code = this.#pendingCode;
		if (code === null) return;
		this.#pendingCode = null;
		this.state = 'saving';
		try {
			await this.#write(code);
			// A newer edit may have arrived while this write was in flight.
			if (this.#pendingCode === null) {
				this.state = 'saved';
				this.errorMessage = null;
			} else {
				this.state = 'pending';
			}
		} catch (e) {
			// Keep the code so a retry (or the next edit) writes it again.
			this.#pendingCode ??= code;
			this.state = 'error';
			this.errorMessage = e instanceof Error ? e.message : String(e);
		}
	}

	/** Retries a failed write with the latest code. */
	retry(): Promise<void> {
		return this.flush();
	}
}
