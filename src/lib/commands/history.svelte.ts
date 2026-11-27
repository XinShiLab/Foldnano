import type FoldnanoDocument from '../model/document.svelte';
import type { Part } from '../model/Part';
import { reportError } from '../errorReporting';
import type { StorageManager } from '../services/storage';
import {
	applyAtomicChanges,
	HistoryRecorder,
	type AtomicChange,
	type HistoryEntry,
} from './historyChanges';
import { syncRepeatGroups } from '../model/Part/repeatGroups';
import { findDerivedStateMismatch, verifyHistoryEntry } from './historyVerification';
import { linkedPartEditedBy, linkedPartRefusal } from './linkedPartGuard';

type PartJSON = ReturnType<Part['toJSON']>;

/** Replay every targeted `tx()` entry on a scratch copy right after it commits (see
 * `verifyHistoryEntry`), and check derived state (spatial index, segment lookup) against a
 * fresh reload after every edit, undo and redo. Always on in tests; opt in during dev with
 * `VITE_VERIFY_UNDO=true`. */
const VERIFY_HISTORY =
	import.meta.env.MODE === 'test' || import.meta.env.VITE_VERIFY_UNDO === 'true';

const isWholeDocumentEntry = (entry: HistoryEntry): boolean =>
	entry.redo.every(
		(change) => change.kind === 'documentSnapshot' || change.kind === 'partSnapshot'
	);

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
	/** Save once nothing has happened for this long after an edit; 0 turns the idle save off. */
	idleDelayMs: number;
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

/** The idle save waits at least this many times the last write's duration, so a design whose
 * snapshot takes hundreds of ms isn't written after every short pause. */
const IDLE_DELAY_PER_SAVE_MS = 10;
/** Upper bound on how long `requestIdleCallback` may defer the idle save. */
const IDLE_CALLBACK_TIMEOUT_MS = 1000;

type AutoSaveTrigger = 'edit-count' | 'timer' | 'idle' | 'manual' | 'retry';

export interface SaveResult {
	success: boolean;
	savedAt: number | null;
}

export class HistoryStack {
	#undo: HistoryEntry[] = $state([]);
	#redo: HistoryEntry[] = $state([]);
	#revision = $state(0);
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
	#idleTimer: number | null = null;
	#idleCallback: number | null = null;
	#lastActivityAt = 0;
	#lastSaveDurationMs = 0;
	#saveInFlight: Promise<SaveResult> | null = null;
	#saveQueued = false;
	#autoSaveConfig: AutoSaveConfig = {
		enabled: true,
		// A safety net for when activity keeps deferring the idle save; the idle save does the work.
		editCountThreshold: 50,
		timeIntervalMs: 60 * 1000,
		idleDelayMs: 2000,
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
		private onSaved?: () => void,
		/** True while something (a held pointer, a running simulation) should defer the idle save. */
		private isBusy?: () => boolean
	) {
		this.#startAutoSaveTimer();
	}

	/** Bumps on every commit, undo and redo; read it to recompute once per edit, not per drag frame. */
	get revision(): number {
		return this.#revision;
	}

	get numberOfUndos() {
		return this.#undo.length;
	}
	/** The entry the next undo reverts; compare by identity to tell whether anything was
	 * committed (or undone) since. */
	get lastUndoEntry(): HistoryEntry | undefined {
		return this.#undo.at(-1);
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
			this.#cancelIdleSave();
		}
	}

	/**
	 * Record user input (pointer, wheel, key) so the idle save waits until the user pauses.
	 * Cheap enough to call on every pointer move: it only stamps a time.
	 */
	noteActivity(): void {
		this.#lastActivityAt = Date.now();
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
		this.#revision++;
		this.#editsSinceLastSave++;
		this.#lastActivityAt = Date.now();
		this.#updateAutoSaveStatus();
		this.#checkAutoSave();
		this.#scheduleIdleSave();
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

	get #idleDelayMs(): number {
		return Math.max(
			this.#autoSaveConfig.idleDelayMs,
			IDLE_DELAY_PER_SAVE_MS * this.#lastSaveDurationMs
		);
	}

	/** Arms the idle save (once; later edits and input only move `#lastActivityAt`). */
	#scheduleIdleSave(delayMs = this.#idleDelayMs) {
		if (typeof window === 'undefined') return;
		if (!this.#autoSaveConfig.enabled || this.#autoSaveConfig.idleDelayMs <= 0) return;
		if (this.#idleTimer !== null || this.#idleCallback !== null) return;
		this.#idleTimer = window.setTimeout(() => {
			this.#idleTimer = null;
			this.#onIdleTimer();
		}, delayMs);
	}

	#onIdleTimer() {
		// During a failure streak the quick retry and the timer own retrying, not every pause.
		if (this.#editsSinceLastSave === 0 || this.#lastAutoSaveError !== undefined) return;
		const delay = this.#idleDelayMs;
		const quietFor = Date.now() - this.#lastActivityAt;
		if (quietFor < delay) return this.#scheduleIdleSave(delay - quietFor);
		if (this.isBusy?.()) return this.#scheduleIdleSave(delay);
		// The snapshot is one synchronous task: idle callback only picks when it starts.
		const run = () => {
			this.#idleCallback = null;
			if (this.#editsSinceLastSave === 0) return;
			if (Date.now() - this.#lastActivityAt < delay || this.isBusy?.()) {
				return this.#scheduleIdleSave(delay);
			}
			void this.#performAutoSave('idle');
		};
		if (typeof window.requestIdleCallback === 'function') {
			this.#idleCallback = window.requestIdleCallback(run, { timeout: IDLE_CALLBACK_TIMEOUT_MS });
		} else {
			run();
		}
	}

	#cancelIdleSave() {
		if (typeof window === 'undefined') return;
		if (this.#idleTimer !== null) window.clearTimeout(this.#idleTimer);
		if (this.#idleCallback !== null) window.cancelIdleCallback?.(this.#idleCallback);
		this.#idleTimer = null;
		this.#idleCallback = null;
	}

	/**
	 * Perform the actual auto-save operation
	 */
	async #performAutoSave(trigger: AutoSaveTrigger): Promise<SaveResult> {
		// One write at a time: each save copies the whole document, so edits made while one is
		// pending must not each start another.
		if (this.#saveInFlight) {
			if (trigger !== 'manual') {
				this.#saveQueued = true;
				return { success: false, savedAt: null };
			}
			// A manual save must persist the state at call time, so run again after the pending one.
			await this.#saveInFlight;
			return this.#performAutoSave(trigger);
		}
		const run = this.#writeSnapshot(trigger);
		this.#saveInFlight = run;
		try {
			return await run;
		} finally {
			this.#saveInFlight = null;
			if (this.#saveQueued) {
				this.#saveQueued = false;
				this.#checkAutoSave();
			}
			// Edits made during the write, or an idle save the write turned away, still need one.
			if (this.#editsSinceLastSave > 0) this.#scheduleIdleSave();
		}
	}

	async #writeSnapshot(trigger: AutoSaveTrigger): Promise<SaveResult> {
		if (this.canPersistSnapshot && !this.canPersistSnapshot()) {
			return { success: false, savedAt: null };
		}
		try {
			const editsInSnapshot = this.#editsSinceLastSave;
			const startedAt = performance.now();
			const snapshot = this.doc.snapshot();
			const success = await this.storageManager.saveDocument(this.doc.id, snapshot);
			if (success) {
				this.#lastSaveDurationMs = performance.now() - startedAt;
				const savedAt = Date.now();
				// Edits made while the write was pending are not in it; keep them counted.
				this.#editsSinceLastSave = Math.max(0, this.#editsSinceLastSave - editsInSnapshot);
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
		this.#cancelIdleSave();
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
		this.#cancelIdleSave();
	}

	tx<R>(fn: () => R): R;
	tx<R>(label: string, fn: (recorder: HistoryRecorder) => R): R;
	tx<R>(labelOrFn: string | (() => R), maybeFn?: (recorder: HistoryRecorder) => R): R {
		if (typeof labelOrFn === 'function') {
			return this.snapshotTx('Unnamed edit', labelOrFn);
		}

		const recorder = new HistoryRecorder(this.doc);
		const label = labelOrFn;
		// Mirror rebuilds aren't expressed as targeted patches, so a Part whose mirrors the sync
		// rebuilds is recorded as a Part snapshot. Only Parts with repeat-group state can be
		// rebuilt, so only they are copied up front: an edit elsewhere stays O(patch).
		const repeatBefore = this.#repeatPartSnapshots();
		const before = VERIFY_HISTORY ? this.doc.snapshot() : null;
		let result: R;
		let entry: HistoryEntry | null;
		/** The edit's own patches, set once `fn` has finished. */
		let edit: HistoryEntry | null | undefined;
		try {
			result = maybeFn!(recorder);
			edit = recorder.commit(label);
			const synced = this.#syncRepeatGroupsIn();
			entry = synced.length ? withPartSnapshots(this.doc, edit, label, synced, repeatBefore) : edit;
		} catch (err) {
			if (edit !== undefined) {
				// The sync failed after the edit: undo the edit's patches outside the repeat Parts
				// (the copies below restore those whole).
				for (const change of edit?.undo ?? []) {
					if (repeatBefore.has(changedPartId(change) ?? '')) continue;
					try {
						applyAtomicChanges(this.doc, [change]);
					} catch (stepErr) {
						console.error('History rollback step failed:', stepErr);
					}
				}
			} else {
				recorder.rollback();
			}
			for (const [partId, json] of repeatBefore) {
				const part = this.doc.parts.find((p) => p.id === partId);
				if (!part || JSON.stringify(part.snapshot()) !== JSON.stringify(json)) {
					this.doc.replacePartFromJSON(partId, json);
				}
			}
			if (before && JSON.stringify(this.doc.snapshot()) !== JSON.stringify(before)) {
				this.doc.restore(before);
				this.onMutation?.();
				throw new Error(
					`Rollback of "${label}" left the document changed (the command mutates something it captures no scope or onRollback step for). Original error: ${err instanceof Error ? err.message : String(err)}`
				);
			}
			this.#assertDerivedState(`rollback of "${label}"`);
			this.onMutation?.();
			throw err;
		}
		const linked = entry && this.#linkedPartEdited(entry);
		if (entry && linked) {
			applyAtomicChanges(this.doc, entry.undo);
			this.onMutation?.();
			throw linkedPartRefusal(linked);
		}
		this.pushEntry(entry);
		if (entry && before && VERIFY_HISTORY && !isWholeDocumentEntry(entry)) {
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

	/** A copy of each Part `syncRepeatGroups` could change (a group, a grouped source or a
	 * mirror), by Part id. */
	#repeatPartSnapshots(): Map<string, PartJSON> {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a local, per-edit copy
		const snapshots = new Map<string, PartJSON>();
		for (const part of this.doc.parts) {
			const hasState =
				part.repeatGroups.length > 0 ||
				[...part.oligos].some((o) => o.repeatGroupId !== null || o.mirrorOf !== null);
			if (hasState) snapshots.set(part.id, part.snapshot());
		}
		return snapshots;
	}

	/** Rebuilds mirror oligos whose originals this edit changed (docs/repeat-units.md); returns
	 * the Parts it changed. */
	#syncRepeatGroupsIn(): Part[] {
		return this.doc.parts.filter((part) => syncRepeatGroups(part));
	}

	snapshotTx<R>(label: string, fn: () => R): R {
		const before = this.doc.snapshot();
		let result: R;
		try {
			result = fn();
			this.#syncRepeatGroupsIn();
		} catch (err) {
			this.doc.restore(before);
			throw err;
		}
		const after = this.doc.snapshot();
		const recorder = new HistoryRecorder(this.doc);
		recorder.documentSnapshot(before, after);
		const entry = recorder.commit(label);
		const linked = entry && this.#linkedPartEdited(entry);
		if (linked) {
			this.doc.restore(before);
			throw linkedPartRefusal(linked);
		}
		this.pushEntry(entry);
		if (entry) this.#assertDerivedState(`"${label}"`);
		return result;
	}

	/**
	 * Like `snapshotTx`, but copies only `part`: cost and undo memory scale with that Part, and
	 * undo swaps just its slot, leaving the other Part objects (and their views) alone. `fn` may
	 * replace the Part object in its slot (plugin results do) but must not touch any other Part,
	 * the assembly, or add/remove Parts; use `snapshotTx` or the assembly commands for those.
	 */
	partSnapshotTx<R>(label: string, part: Part, fn: () => R): R {
		const doc = this.doc;
		const index = doc.parts.indexOf(part);
		if (index < 0) throw new Error(`"${label}": Part ${part.id} is not in the document`);
		const others = doc.parts.filter((_, i) => i !== index);
		const outside = () =>
			JSON.stringify({ parts: others.map((p) => p.toJSON()), assembly: doc.assembly.toJSON() });
		const outsideBefore = VERIFY_HISTORY ? outside() : null;
		const before = part.snapshot();
		let result: R;
		try {
			result = fn();
			syncRepeatGroups(doc.parts[index]);
		} catch (err) {
			doc.replacePartFromJSON(doc.parts[index].id, before);
			throw err;
		}
		const sameOthers =
			doc.parts.length === others.length + 1 &&
			others.every((other, i) => doc.parts[i < index ? i : i + 1] === other);
		if (!sameOthers || (outsideBefore !== null && outside() !== outsideBefore)) {
			// Undo would miss whatever happened outside the slot: a command bug, so fail loudly.
			throw new Error(`"${label}" changed Parts outside its Part-scoped snapshot`);
		}
		const recorder = new HistoryRecorder(doc);
		recorder.partSnapshot(before, doc.parts[index].snapshot());
		const entry = recorder.commit(label);
		const linked = entry && this.#linkedPartEdited(entry);
		if (linked) {
			doc.replacePartFromJSON(doc.parts[index].id, before);
			throw linkedPartRefusal(linked);
		}
		this.pushEntry(entry);
		if (entry) this.#assertDerivedState(`"${label}"`);
		return result;
	}

	#allowLinkedPartEdits = false;

	/** Name of a linked Part the entry edits, unless a link command is running (see
	 * `withLinkedPartEdits`). */
	#linkedPartEdited(entry: HistoryEntry): string | null {
		return this.#allowLinkedPartEdits ? null : linkedPartEditedBy(this.doc, entry);
	}

	/**
	 * Runs `fn` with the linked-Part guard off. Only for the link commands, which replace a linked
	 * Part's cached copy (update) or turn it into a plain Part; every other edit of a linked Part
	 * is refused with an `InvalidOperationError` and leaves the document as it was.
	 */
	withLinkedPartEdits<R>(fn: () => R): R {
		const previous = this.#allowLinkedPartEdits;
		this.#allowLinkedPartEdits = true;
		try {
			return fn();
		} finally {
			this.#allowLinkedPartEdits = previous;
		}
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

/** The Part a change edits, or null for a document-level change (assembly, document fields). */
function changedPartId(change: AtomicChange): string | null {
	switch (change.kind) {
		case 'field':
		case 'slotSeq':
			return change.ref.kind === 'doc' ? null : change.ref.partId;
		case 'partMemento':
			return change.memento.partId;
		case 'partSnapshot':
			return change.replacePartId;
		case 'documentSnapshot':
		case 'occurrenceSet':
		case 'occurrenceRemove':
			return null;
		case 'stickyRecordSet':
		case 'stickyRecordRemove':
			return change.home.kind === 'part' ? change.home.partId : null;
		default:
			return change.partId;
	}
}

/**
 * `edit` with each synced Part's patches replaced by a snapshot of that Part (its copy from before
 * the edit, and its state now). Patches on other Parts and on the document stay as they are.
 */
function withPartSnapshots(
	doc: FoldnanoDocument,
	edit: HistoryEntry | null,
	label: string,
	synced: Part[],
	before: ReadonlyMap<string, PartJSON>
): HistoryEntry {
	const ids = new Set(synced.map((part) => part.id));
	if (edit?.redo.some((change) => change.kind === 'documentSnapshot')) {
		throw new Error(`"${label}" records a document snapshot inside a targeted edit`);
	}
	const snapshots = new HistoryRecorder(doc);
	for (const part of synced) {
		const copy = before.get(part.id);
		if (!copy) {
			throw new Error(`"${label}": mirrors rebuilt on Part ${part.id}, which had no repeat group`);
		}
		snapshots.partSnapshot(copy, part.snapshot());
	}
	const parts = snapshots.commit(label) ?? { label, undo: [], redo: [] };
	const outside = (change: AtomicChange) => !ids.has(changedPartId(change) ?? '');
	return {
		label,
		undo: [...parts.undo, ...(edit?.undo ?? []).filter(outside)],
		redo: [...(edit?.redo ?? []).filter(outside), ...parts.redo],
	};
}
