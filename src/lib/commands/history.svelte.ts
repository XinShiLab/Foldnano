import type FoldnanoDocument from '../model/document.svelte';
import { reportError } from '../errorReporting';
import type { StorageManager } from '../services/storage';
import { applyAtomicChanges, HistoryRecorder, type HistoryEntry } from './historyChanges';
import { syncRepeatGroups } from '../model/Part/repeatGroups';
import { findDerivedStateMismatch, verifyHistoryEntry } from './historyVerification';

/** Replay every targeted `tx()` entry on a scratch copy right after it commits (see
 * `verifyHistoryEntry`), and check derived state (spatial index, segment lookup) against a
 * fresh reload after every edit, undo and redo. Always on in tests; opt in during dev with
 * `VITE_VERIFY_UNDO=true`. */
const VERIFY_HISTORY =
	import.meta.env.MODE === 'test' || import.meta.env.VITE_VERIFY_UNDO === 'true';

const isWholeDocumentEntry = (entry: HistoryEntry): boolean =>
	entry.redo.every((change) => change.kind === 'documentSnapshot');

/** Oldest undo entries are dropped beyond either limit. `maxBytes` counts the entries' JSON
 * length, a rough proxy for memory: whole-document snapshot entries dominate it. */
export interface HistoryLimits {
	maxEntries: number;
	maxBytes: number;
}

export const DEFAULT_HISTORY_LIMITS: HistoryLimits = {
	maxEntries: 100,
	maxBytes: 50_000_000,
};

export interface AutoSaveConfig {
	enabled: boolean;
	editCountThreshold: number; // Save every N edits
	timeIntervalMs: number; // Save every N milliseconds
}

export interface AutoSaveStatus {
	lastSavedTime: number | null;
	hasUnsavedChanges: boolean;
	editsSinceLastSave: number;
	/** Message from the most recent save failure, cleared on the next successful save. */
	error?: string;
}

/** One quick retry after the first failure of a streak; the regular timer keeps retrying after. */
export const AUTOSAVE_RETRY_DELAY_MS = 3000;

export interface SaveResult {
	success: boolean;
	savedAt: number | null;
}

export class HistoryStack {
	#undo: HistoryEntry[] = $state([]);
	#redo: HistoryEntry[] = $state([]);
	#limits: HistoryLimits = { ...DEFAULT_HISTORY_LIMITS };
	#entryBytes = new WeakMap<HistoryEntry, number>();
	#undoBytes = 0;
	#droppedEntryCount = 0;

	// Auto-save tracking
	#editsSinceLastSave = 0;
	#lastSaveTime: number | null = null;
	#lastAutoSaveError: string | undefined = undefined;
	#autoSaveTimer: number | null = null;
	#retryTimer: number | null = null;
	#autoSaveConfig: AutoSaveConfig = {
		enabled: true,
		editCountThreshold: 10, // Save every 10 edits
		timeIntervalMs: 60 * 1000, // Save every minute
	};

	// Reactive auto-save status
	autoSaveStatus = $state<AutoSaveStatus>({
		lastSavedTime: null,
		hasUnsavedChanges: false,
		editsSinceLastSave: 0,
	});

	constructor(
		private doc: FoldnanoDocument,
		private storageManager: StorageManager,
		private onMutation?: () => void,
		private canPersistSnapshot?: () => boolean,
		private onSaved?: () => void
	) {
		this.#startAutoSaveTimer();
	}

	get numberOfUndos() {
		return this.#undo.length;
	}
	get numberOfRedos() {
		return this.#redo.length;
	}

	/** Undo entries dropped so far to stay within `historyLimits`. */
	get droppedEntryCount(): number {
		return this.#droppedEntryCount;
	}

	get historyLimits(): Readonly<HistoryLimits> {
		return { ...this.#limits };
	}

	setHistoryLimits(limits: Partial<HistoryLimits>) {
		this.#limits = { ...this.#limits, ...limits };
		this.#trimUndo();
	}

	/**
	 * Get current auto-save configuration
	 */
	get autoSaveConfig(): Readonly<AutoSaveConfig> {
		return { ...this.#autoSaveConfig };
	}

	/**
	 * Update auto-save configuration
	 */
	setAutoSaveConfig(config: Partial<AutoSaveConfig>) {
		this.#autoSaveConfig = { ...this.#autoSaveConfig, ...config };
		if (this.#autoSaveConfig.enabled) {
			this.#startAutoSaveTimer();
		} else {
			this.#stopAutoSaveTimer();
		}
	}

	private pushEntry(entry: HistoryEntry | null) {
		if (!entry) return;
		const bytes = JSON.stringify(entry).length;
		this.#entryBytes.set(entry, bytes);
		this.#undo.push(entry);
		this.#undoBytes += bytes;
		this.#redo.length = 0;
		this.#trimUndo();
		this.#markDirty();
	}

	/** Drops the oldest undo entries until within limits, always keeping the newest one. */
	#trimUndo() {
		while (
			this.#undo.length > 1 &&
			(this.#undo.length > this.#limits.maxEntries || this.#undoBytes > this.#limits.maxBytes)
		) {
			const dropped = this.#undo.shift()!;
			this.#undoBytes -= this.#entryBytes.get(dropped) ?? 0;
			this.#droppedEntryCount++;
		}
	}

	#assertDerivedState(step: string) {
		if (!VERIFY_HISTORY) return;
		const mismatch = findDerivedStateMismatch(this.doc);
		if (mismatch) throw new Error(`Derived state is stale after ${step}: ${mismatch}`);
	}

	#markDirty() {
		this.#editsSinceLastSave++;
		this.#updateAutoSaveStatus();
		this.#checkAutoSave();
	}

	/**
	 * Update the reactive auto-save status
	 */
	#updateAutoSaveStatus() {
		this.autoSaveStatus = {
			lastSavedTime: this.#lastSaveTime,
			hasUnsavedChanges: this.#editsSinceLastSave > 0,
			editsSinceLastSave: this.#editsSinceLastSave,
			error: this.#lastAutoSaveError,
		};
	}

	/**
	 * Start the auto-save timer
	 */
	#startAutoSaveTimer() {
		this.#stopAutoSaveTimer();
		if (this.#autoSaveConfig.enabled && typeof window !== 'undefined') {
			this.#autoSaveTimer = window.setInterval(() => {
				this.#performTimedAutoSave();
			}, this.#autoSaveConfig.timeIntervalMs);
		}
	}

	/**
	 * Stop the auto-save timer
	 */
	#stopAutoSaveTimer() {
		if (this.#autoSaveTimer !== null && typeof window !== 'undefined') {
			window.clearInterval(this.#autoSaveTimer);
			this.#autoSaveTimer = null;
		}
	}

	/**
	 * Check if auto-save should be triggered based on edit count
	 */
	#checkAutoSave() {
		if (!this.#autoSaveConfig.enabled) return;
		if (this.#editsSinceLastSave >= this.#autoSaveConfig.editCountThreshold) {
			this.#performAutoSave('edit-count');
		}
	}

	/**
	 * Perform timed auto-save
	 */
	#performTimedAutoSave() {
		// Only save if there have been edits
		if (this.#editsSinceLastSave > 0) {
			const timeSinceLastSave = this.#lastSaveTime ? Date.now() - this.#lastSaveTime : Infinity;
			// Save if enough time has passed or this is the first save
			if (timeSinceLastSave >= this.#autoSaveConfig.timeIntervalMs) {
				this.#performAutoSave('timer');
			}
		}
	}

	/**
	 * Perform the actual auto-save operation
	 */
	async #performAutoSave(
		trigger: 'edit-count' | 'timer' | 'manual' | 'retry'
	): Promise<SaveResult> {
		if (this.canPersistSnapshot && !this.canPersistSnapshot()) {
			return { success: false, savedAt: null };
		}
		try {
			const snapshot = this.doc.snapshot();
			const success = await this.storageManager.saveDocument(this.doc.id, snapshot);
			if (success) {
				const savedAt = Date.now();
				this.#editsSinceLastSave = 0;
				this.#lastSaveTime = savedAt;
				this.#lastAutoSaveError = undefined;
				this.#cancelRetry();
				this.#updateAutoSaveStatus();
				console.log(`[AutoSave] Document saved (trigger: ${trigger})`);
				this.onSaved?.();
				return { success: true, savedAt };
			}
			this.#handleAutoSaveFailure(new Error('Document save returned failure'));
		} catch (e) {
			this.#handleAutoSaveFailure(e);
		}
		return { success: false, savedAt: null };
	}

	/**
	 * Surface an autosave failure: notify once per distinct error (so a retrying timer
	 * doesn't spam identical toasts), always log/persist it via reportError.
	 */
	#handleAutoSaveFailure(err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		const isNewFailure = this.#lastAutoSaveError !== message;
		const isFirstOfStreak = this.#lastAutoSaveError === undefined;
		reportError(err, 'autosave', { notify: isNewFailure });
		this.#lastAutoSaveError = message;
		this.#updateAutoSaveStatus();
		if (isFirstOfStreak) this.#scheduleRetry();
	}

	#scheduleRetry() {
		if (typeof window === 'undefined' || this.#retryTimer !== null) return;
		this.#retryTimer = window.setTimeout(() => {
			this.#retryTimer = null;
			if (this.#lastAutoSaveError !== undefined) void this.#performAutoSave('retry');
		}, AUTOSAVE_RETRY_DELAY_MS);
	}

	#cancelRetry() {
		if (this.#retryTimer !== null && typeof window !== 'undefined') {
			window.clearTimeout(this.#retryTimer);
		}
		this.#retryTimer = null;
	}

	/**
	 * Record a failed save made outside autosave (manual save, persist-before-Git) so the
	 * failure state is shown. The caller reports the error itself.
	 */
	markSaveFailed(message: string): void {
		this.#lastAutoSaveError = message;
		this.#updateAutoSaveStatus();
	}

	/**
	 * Manually trigger an auto-save
	 */
	saveNow(): Promise<SaveResult> {
		return this.#performAutoSave('manual');
	}

	/**
	 * Save only if there are actual unsaved edits (editsSinceLastSave > 0).
	 * Use this instead of saveNow() when saving before a file switch or similar
	 * housekeeping operations, to avoid bumping lastModified and creating a false
	 * "dirty" entry in the GitHub Changes panel.
	 */
	saveNowIfDirty(): Promise<SaveResult> {
		if (this.#editsSinceLastSave > 0) {
			return this.#performAutoSave('manual');
		}
		return Promise.resolve({ success: true, savedAt: this.#lastSaveTime });
	}

	/**
	 * Mark the document as fully saved/synced (e.g. after a GitHub commit or pull).
	 * Resets the dirty counter so the auto-save timer won't fire a redundant save
	 * that would bump lastModified past lastSyncAt and create a false dirty state.
	 */
	markSaved(time?: number): void {
		this.#lastSaveTime = time ?? Date.now();
		this.#editsSinceLastSave = 0;
		this.#lastAutoSaveError = undefined;
		this.#cancelRetry();
		this.#updateAutoSaveStatus();
		this.onSaved?.();
	}

	/**
	 * Restore a previously persisted save timestamp (e.g. when loading from localStorage).
	 * Does not trigger a save — just initialises the status so hasUncommittedChanges is accurate.
	 */
	restoreLastSaveTime(time: number) {
		this.#lastSaveTime = time;
		this.#updateAutoSaveStatus();
	}

	/**
	 * Clean up timer on destruction
	 */
	destroy() {
		this.#stopAutoSaveTimer();
		this.#cancelRetry();
	}

	tx<R>(fn: () => R): R;
	tx<R>(label: string, fn: (recorder: HistoryRecorder) => R): R;
	tx<R>(labelOrFn: string | (() => R), maybeFn?: (recorder: HistoryRecorder) => R): R {
		if (typeof labelOrFn === 'function') {
			return this.snapshotTx('Unnamed edit', labelOrFn);
		}

		const recorder = new HistoryRecorder(this.doc);
		const label = labelOrFn;
		const before = this.doc.snapshot();
		let result: R;
		let entry: HistoryEntry | null;
		try {
			result = maybeFn!(recorder);
			if (this.#syncRepeatGroups()) {
				// Mirror rebuilds aren't expressed as targeted patches; record the whole edit
				// as a document snapshot instead (`before` is already in hand).
				const snapshot = new HistoryRecorder(this.doc);
				snapshot.documentSnapshot(before, this.doc.snapshot());
				entry = snapshot.commit(label);
			} else {
				entry = recorder.commit(label);
			}
		} catch (err) {
			this.doc.restore(before);
			this.onMutation?.();
			throw err;
		}
		this.pushEntry(entry);
		if (entry && VERIFY_HISTORY && !isWholeDocumentEntry(entry)) {
			const mismatch = verifyHistoryEntry(before, this.doc.snapshot(), entry);
			if (mismatch) {
				throw new Error(
					`History entry "${label}" does not round-trip (a capture seed likely misses something the command mutates): ${mismatch}`
				);
			}
		}
		if (entry) this.#assertDerivedState(`"${label}"`);
		return result;
	}

	/** Rebuilds mirror oligos whose originals this edit changed (docs/repeat-units.md). */
	#syncRepeatGroups(): boolean {
		let changed = false;
		for (const part of this.doc.parts) changed = syncRepeatGroups(part) || changed;
		return changed;
	}

	snapshotTx<R>(label: string, fn: () => R): R {
		const before = this.doc.snapshot();
		let result: R;
		try {
			result = fn();
			this.#syncRepeatGroups();
		} catch (err) {
			this.doc.restore(before);
			throw err;
		}
		const after = this.doc.snapshot();
		const recorder = new HistoryRecorder(this.doc);
		recorder.documentSnapshot(before, after);
		const entry = recorder.commit(label);
		this.pushEntry(entry);
		if (entry) this.#assertDerivedState(`"${label}"`);
		return result;
	}

	undoOnce() {
		if (!this.#undo.length) return;
		const entry = this.#undo.pop()!;
		this.#undoBytes -= this.#entryBytes.get(entry) ?? 0;
		applyAtomicChanges(this.doc, entry.undo);
		this.#redo.push(entry);
		this.#markDirty();
		this.onMutation?.();
		this.#assertDerivedState(`undo of "${entry.label}"`);
	}

	redoOnce() {
		if (!this.#redo.length) return;
		const entry = this.#redo.pop()!;
		applyAtomicChanges(this.doc, entry.redo);
		this.#undo.push(entry);
		this.#undoBytes += this.#entryBytes.get(entry) ?? 0;
		this.#markDirty();
		this.onMutation?.();
		this.#assertDerivedState(`redo of "${entry.label}"`);
	}
}
