import { APP_COMMIT, APP_VERSION } from './appInfo';
import { notify } from './notifications/notify.svelte';
import { EditorError, InvalidOperationError, OperationNotSupportedError } from './errors';
import { errorLogPanelState } from './errorLogPanel.svelte';
import { foldnanoIndexedDb } from './services/storage/indexeddb/FoldnanoIndexedDb';
import type { ErrorLogRecord } from './services/storage/indexedDbTypes';

function generateId(): string {
	return Math.random().toString(36).slice(2, 6);
}

interface Classification {
	message: string;
	stack?: string;
	/** Whether the message is already specific enough to show as-is, without a correlation id. */
	known: boolean;
}

function classify(err: unknown): Classification {
	if (err instanceof EditorError) {
		return { message: err.message, stack: err.stack, known: true };
	}
	const message = err instanceof Error ? err.message : String(err);
	const stack = err instanceof Error ? err.stack : undefined;
	return { message: message || 'Unexpected error', stack, known: false };
}

/** How long repeats of a logged error are counted in memory before one write adds them. */
export const ERROR_LOG_REPEAT_FLUSH_MS = 1000;
const MAX_TRACKED_ERRORS = 200;

interface TrackedError {
	record: ErrorLogRecord;
	pendingRepeats: number;
	lastSeenAt: number;
	flushTimer: ReturnType<typeof setTimeout> | null;
	/** Serializes this entry's writes so a repeat never races the first insert. */
	write: Promise<unknown>;
}

/** Error Log entries written by this tab, by context + message, so a repeat bumps a count. */
const loggedThisSession = new Map<string, TrackedError>();

function sessionKey(context: string, message: string): string {
	return `${context}\u0000${message}`;
}

function logPersistFailure(e: unknown): void {
	console.error('[errorReporting] Failed to persist error log:', e);
}

function flushRepeats(tracked: TrackedError): void {
	tracked.flushTimer = null;
	const by = tracked.pendingRepeats;
	const at = tracked.lastSeenAt;
	tracked.pendingRepeats = 0;
	tracked.write = tracked.write
		.then(async () => {
			if (await foldnanoIndexedDb.bumpErrorLog(tracked.record.id, by, at)) return;
			// The entry was cleared or pruned since: log it again under the same id.
			tracked.record = {
				...tracked.record,
				timestamp: at,
				count: undefined,
				lastSeenAt: undefined,
			};
			await foldnanoIndexedDb.addErrorLog(tracked.record);
		})
		.catch(logPersistFailure);
}

function persist(entry: ErrorLogRecord): void {
	const key = sessionKey(entry.context, entry.message);
	if (loggedThisSession.size >= MAX_TRACKED_ERRORS) {
		const oldest = loggedThisSession.keys().next().value;
		if (oldest !== undefined) loggedThisSession.delete(oldest);
	}
	loggedThisSession.set(key, {
		record: entry,
		pendingRepeats: 0,
		lastSeenAt: entry.timestamp,
		flushTimer: null,
		write: foldnanoIndexedDb.addErrorLog(entry).catch(logPersistFailure),
	});
}

/** Whether `reportError(err, context)` would merge into an entry this tab already logged. */
export function isLoggedThisSession(err: unknown, context: string): boolean {
	return loggedThisSession.has(sessionKey(context, classify(err).message));
}

/** A refusal of something the editor deliberately doesn't allow; not a bug to report. */
function isRefusal(err: unknown): boolean {
	return err instanceof InvalidOperationError || err instanceof OperationNotSupportedError;
}

/**
 * Single entry point for reporting errors: classifies severity, logs to the console,
 * persists a structured entry to the local error-log ring buffer, and (unless silenced)
 * shows a toast. Refusals (`InvalidOperationError`, `OperationNotSupportedError`) only get a
 * warning toast: the Error Log is for app failures worth reporting, so they return `null`.
 * A repeat of an error this tab already logged (same context and message) returns the first
 * entry's id and adds to its `count` instead of writing a new entry.
 *
 * Entries must never contain design/document data — metadata only (see ErrorLogRecord).
 */
export function reportError(
	err: unknown,
	context: string,
	opts?: { notify?: boolean; console?: boolean }
): string | null {
	const shouldNotify = opts?.notify ?? true;
	const shouldLogToConsole = opts?.console ?? true;
	const { message, stack, known } = classify(err);

	if (isRefusal(err)) {
		if (shouldLogToConsole) console.warn(`[${context}] ${message}`);
		if (shouldNotify) notify.warning(message);
		return null;
	}

	const tracked = loggedThisSession.get(sessionKey(context, message));
	const id = tracked?.record.id ?? generateId();
	if (shouldLogToConsole) console.error(`[${context}] (#${id})`, err);

	if (tracked) {
		tracked.pendingRepeats++;
		tracked.lastSeenAt = Date.now();
		tracked.flushTimer ??= setTimeout(() => flushRepeats(tracked), ERROR_LOG_REPEAT_FLUSH_MS);
	} else {
		persist({
			id,
			timestamp: Date.now(),
			context,
			message,
			stack,
			severity: 'error',
			appVersion: APP_VERSION,
			commitHash: APP_COMMIT,
		});
	}

	if (shouldNotify) {
		if (known) {
			notify.error(message, { errorLogId: id });
		} else {
			notify.error(`Something went wrong (#${id})`, {
				errorLogId: id,
				action: {
					label: 'View Details',
					onClick: () => {
						errorLogPanelState.open = true;
						errorLogPanelState.focusedEntryId = id;
					},
				},
			});
		}
	}

	return id;
}
