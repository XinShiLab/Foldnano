import { toast, type ExternalToast } from 'svelte-sonner';

export type NotificationLevel = 'success' | 'error' | 'warning' | 'info';

export interface NotifyOptions extends Omit<ExternalToast, 'description'> {
	description?: string;
	/** Keep this in the tab's notification list. Defaults to true for errors and warnings only. */
	history?: boolean;
	/** Error Log entry this notification reports; the list links to it. */
	errorLogId?: string;
}

export interface NotificationEntry {
	readonly id: number;
	readonly level: NotificationLevel;
	readonly title: string;
	details: string[];
	count: number;
	readonly firstAt: number;
	lastAt: number;
	errorLogId?: string;
}

export const NOTIFICATION_HISTORY_LIMIT = 50;
/** A repeat of the newest entry within this window merges into it instead of adding a row. */
export const NOTIFICATION_COALESCE_MS = 10_000;

/** Per-tab, in-memory list of recent notifications; cleared on reload, never persisted. */
export const notificationHistory = $state({
	entries: [] as NotificationEntry[],
	hasUnseenAttention: false,
});

let nextId = 1;

function record(level: NotificationLevel, title: string, opts: NotifyOptions | undefined): void {
	const keep = opts?.history ?? (level === 'error' || level === 'warning');
	if (!keep) return;

	const now = Date.now();
	const description = opts?.description;
	const newest = notificationHistory.entries[0];
	if (
		newest &&
		newest.level === level &&
		newest.title === title &&
		now - newest.lastAt <= NOTIFICATION_COALESCE_MS
	) {
		newest.count += 1;
		newest.lastAt = now;
		if (description && !newest.details.includes(description)) newest.details.push(description);
		if (opts?.errorLogId) newest.errorLogId = opts.errorLogId;
	} else {
		notificationHistory.entries.unshift({
			id: nextId++,
			level,
			title,
			details: description ? [description] : [],
			count: 1,
			firstAt: now,
			lastAt: now,
			errorLogId: opts?.errorLogId,
		});
		if (notificationHistory.entries.length > NOTIFICATION_HISTORY_LIMIT) {
			notificationHistory.entries.length = NOTIFICATION_HISTORY_LIMIT;
		}
	}
	if (level === 'error' || level === 'warning') notificationHistory.hasUnseenAttention = true;
}

function show(level: NotificationLevel, message: string, opts?: NotifyOptions): string | number {
	record(level, message, opts);
	if (!opts) return toast[level](message);
	const { history: _history, errorLogId: _errorLogId, ...toastOpts } = opts;
	return toast[level](message, toastOpts);
}

/** The app's one way to show a toast; also feeds the tab's notification list. */
export const notify = {
	success: (message: string, opts?: NotifyOptions) => show('success', message, opts),
	error: (message: string, opts?: NotifyOptions) => show('error', message, opts),
	warning: (message: string, opts?: NotifyOptions) => show('warning', message, opts),
	info: (message: string, opts?: NotifyOptions) => show('info', message, opts),
};

export function markNotificationsSeen(): void {
	notificationHistory.hasUnseenAttention = false;
}

export function clearNotificationHistory(): void {
	notificationHistory.entries.length = 0;
	notificationHistory.hasUnseenAttention = false;
}
