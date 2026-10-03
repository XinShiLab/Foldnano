import FoldnanoDocument from '$lib/model/document.svelte';
import { DocumentFormatError } from '$lib/model/documentFormat';
import type { BackupReason, LocalBackup } from '$lib/services/storage';

export type DocumentLoadFailureReason = 'too-new' | 'malformed' | 'error';

/** A saved document whose snapshot exists but could not be turned into a FoldnanoDocument. */
export interface DocumentLoadFailure {
	docId: string;
	name: string | null;
	message: string;
	reason: DocumentLoadFailureReason;
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
	const base = designName.trim().replace(/[\\/:*?"<>|]/g, '-') || 'design';
	return `${base} (backup ${stamp}).fn.json`;
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
