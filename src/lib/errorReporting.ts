import { toast } from 'svelte-sonner';
import { APP_COMMIT, APP_VERSION } from './appInfo';
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
	severity: 'warning' | 'error';
	/** Whether the message is already specific enough to show as-is, without a correlation id. */
	known: boolean;
}

function classify(err: unknown): Classification {
	if (err instanceof InvalidOperationError || err instanceof OperationNotSupportedError) {
		return { message: err.message, stack: err.stack, severity: 'warning', known: true };
	}
	if (err instanceof EditorError) {
		return { message: err.message, stack: err.stack, severity: 'error', known: true };
	}
	const message = err instanceof Error ? err.message : String(err);
	const stack = err instanceof Error ? err.stack : undefined;
	return { message: message || 'Unexpected error', stack, severity: 'error', known: false };
}

/**
 * Single entry point for reporting errors: classifies severity, logs to the console,
 * persists a structured entry to the local error-log ring buffer, and (unless silenced)
 * shows a toast.
 *
 * Entries must never contain design/document data — metadata only (see ErrorLogRecord).
 */
export function reportError(err: unknown, context: string, opts?: { notify?: boolean }): string {
	const id = generateId();
	const { message, stack, severity, known } = classify(err);
	const notify = opts?.notify ?? true;

	console.error(`[${context}] (#${id})`, err);

	const entry: ErrorLogRecord = {
		id,
		timestamp: Date.now(),
		context,
		message,
		stack,
		severity,
		appVersion: APP_VERSION,
		commitHash: APP_COMMIT,
	};
	void foldnanoIndexedDb
		.addErrorLog(entry)
		.catch((e) => console.error('[errorReporting] Failed to persist error log:', e));

	if (notify) {
		if (severity === 'warning') {
			toast.warning(message);
		} else if (known) {
			toast.error(message);
		} else {
			toast.error(`Something went wrong (#${id})`, {
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
