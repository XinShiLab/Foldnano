import FoldnanoDocument from '$lib/model/document.svelte';
import { exportBaseName } from '$lib/model/io/designFileName';
import { DocumentFormatError } from '$lib/model/documentFormat';
import type { BackupReason, LocalBackup } from '$lib/services/storage';
import { toast } from 'svelte-sonner';
import type { DesignIssue } from '$lib/model/checks/designIssue';

const MAX_LISTED_ISSUES = 5;
// Opening a file as a new document adopts it twice (import, then the /editor/[docId] remount).
const REPEAT_NOTICE_WINDOW_MS = 10_000;
let lastIssueNotice: { key: string; at: number } | null = null;

export type DocumentLoadFailureReason = 'too-new' | 'malformed' | 'error';

/** A saved document whose snapshot exists but could not be turned into a FoldnanoDocument. */
export interface DocumentLoadFailure {
	docId: string;
	name: string | null;
	message: string;
	reason: DocumentLoadFailureReason;
}

/** Tells the user a design was repaired on load (`repairDocumentJson`); no-op when nothing was. */
export function notifyDocumentRepairs(repairs: string[]): void {
	if (repairs.length === 0) return;
	console.warn('[documentRepair] Repaired the document on load:', repairs);
	toast.warning('This design had inconsistencies from an earlier bug and was repaired.', {
		description: repairs.join('\n'),
	});
}

/** Tells the user what the integrity check found in a design just opened; `info` stays quiet. */
export function notifyDesignIssues(docId: string, issues: readonly DesignIssue[]): void {
	const shown = issues.filter((issue) => issue.severity !== 'info');
	if (shown.length === 0) return;
	const key = `${docId}\n${shown.map((issue) => issue.message).join('\n')}`;
	const now = Date.now();
	if (lastIssueNotice?.key === key && now - lastIssueNotice.at < REPEAT_NOTICE_WINDOW_MS) return;
	lastIssueNotice = { key, at: now };
	console.warn('[designIssues] Found on load:', shown);
	const lines = shown.slice(0, MAX_LISTED_ISSUES).map((issue) => issue.message);
	if (shown.length > MAX_LISTED_ISSUES)
		lines.push(`…and ${shown.length - MAX_LISTED_ISSUES} more.`);
	toast.warning("This design contains things the editor wouldn't create itself.", {
		description: lines.join('\n'),
	});
}

/** A backup as shown in the Backups dialog and on the recovery screen. */
export interface BackupEntry {
	id: string;
	reason: BackupReason;
	/** Why it was kept, e.g. "Before pulling from GitHub". */
	label: string;
	/** Extra context such as the GitHub branch, or null. */
	detail: string | null;
	createdAt: number;
	snapshot: object;
	/** False when this backup cannot be opened either. */
	readable: boolean;
}

export type RestoreBackupResult = 'restored' | 'not-allowed' | 'save-failed' | 'still-unreadable';

export const BACKUP_REASON_LABELS: Record<BackupReason, string> = {
	periodic: 'Automatic backup',
	before_pull: 'Before pulling from GitHub',
	before_accept_remote: 'Before accepting the GitHub version',
	before_branch_reload: 'Before switching branch',
	before_conflict_resolve: 'Before resolving a conflict',
	before_discard: 'Before discarding local changes',
	before_restore: 'Before restoring a backup',
	before_repair: 'Before repairing on load',
};

export function describeLoadFailure(
	docId: string,
	raw: unknown,
	err: unknown
): DocumentLoadFailure {
	const name =
		typeof raw === 'object' && raw !== null && typeof (raw as { name?: unknown }).name === 'string'
			? (raw as { name: string }).name
			: null;
	if (err instanceof DocumentFormatError) {
		return { docId, name, message: err.message, reason: err.reason };
	}
	const detail = err instanceof Error ? err.message : String(err);
	return {
		docId,
		name,
		message: `The saved data for this design is damaged or inconsistent (${detail}).`,
		reason: 'error',
	};
}

/** e.g. `My design (backup 2026-09-27 14-05).fn.json`, in local time. */
export function backupFileName(designName: string, createdAt: number): string {
	const d = new Date(createdAt);
	const pad = (n: number) => String(n).padStart(2, '0');
	const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}`;
	return `${exportBaseName(designName)} (backup ${stamp}).fn.json`;
}

function isReadable(snapshot: object): boolean {
	try {
		FoldnanoDocument.fromJSON(snapshot);
		return true;
	} catch {
		return false;
	}
}

/** A document's backup timeline, newest first, each checked for readability. */
export function toBackupEntries(backups: LocalBackup[]): BackupEntry[] {
	return backups
		.map((b) => ({
			id: b.id,
			reason: b.reason,
			label: BACKUP_REASON_LABELS[b.reason] ?? BACKUP_REASON_LABELS.periodic,
			detail: b.github ? `${b.github.branch} · ${b.github.path}` : null,
			createdAt: b.createdAt,
			snapshot: b.snapshot,
			readable: isReadable(b.snapshot),
		}))
		.sort((a, b) => b.createdAt - a.createdAt);
}
