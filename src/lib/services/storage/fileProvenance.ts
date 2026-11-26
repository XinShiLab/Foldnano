/**
 * Compares a design file being opened with the copy of the same design (same id) in this browser,
 * for the Open dialog: same content, older or newer, edited outside Foldnano, or one of the
 * design's backups.
 */
import FoldnanoDocument from '$lib/model/document.svelte';
import { migrateDocumentJson } from '$lib/model/documentFormat';
import { repairDocumentJson } from '$lib/model/documentRepair';
import {
	designContentHash,
	editedSinceExport,
	readExportStamp,
	type DesignContent,
} from '$lib/model/exportStamp';

export type FileRelation = 'identical' | 'older' | 'newer' | 'different';

export interface FileProvenance {
	relation: FileRelation;
	/** Changed after it was downloaded; null when the file has no stamp to check against. */
	editedOutside: boolean | null;
	/** When the file was downloaded, in server time; null without a usable stamp. */
	exportedAt: number | null;
	/** When this browser last saved the design, moved to server time when the offset is known. */
	browserSavedAt: number;
	/** One of the two times comes from a computer clock that may be off. */
	approximate: boolean;
	/** Newest backup of this design with the same content as the file. */
	matchesBackupAt: number | null;
}

export interface ProvenanceInput {
	/** The file as read from disk, before migration. */
	rawFile: unknown;
	/** The file as the editor would open it (`FoldnanoDocument.toJSON()` of the parsed file). */
	fileSnapshot: DesignContent;
	/** The browser copy as stored. */
	stored: unknown;
	/** The browser copy's save time, on this computer's clock. */
	storedAt: number;
	backups: readonly { createdAt: number; snapshot: object }[];
	/** From `serverClockOffset()`; null when offline. */
	clockOffset: number | null;
}

/**
 * Content hash after the same load steps the editor runs, so a file from an older format version
 * or one an older release wrote still matches the design it became. Null if it can't be opened.
 */
export async function normalizedContentHash(raw: unknown): Promise<string | null> {
	try {
		// Plain data first: repair clones, and a snapshot taken from a live document holds proxies.
		const plain: unknown = JSON.parse(JSON.stringify(raw));
		const { snapshot } = repairDocumentJson(migrateDocumentJson(plain));
		return await designContentHash(FoldnanoDocument.fromJSON(snapshot).toJSON());
	} catch {
		return null;
	}
}

export async function compareWithBrowserCopy(input: ProvenanceInput): Promise<FileProvenance> {
	const stamp = readExportStamp(input.rawFile);
	const editedOutside = await editedSinceExport(input.rawFile);
	const exportedAt = stamp ? Date.parse(stamp.at) : null;
	const browserSavedAt = input.storedAt + (input.clockOffset ?? 0);
	const approximate = input.clockOffset === null || stamp?.clock === 'local';

	const fileHash = await designContentHash(input.fileSnapshot);
	const result = (relation: FileRelation, matchesBackupAt: number | null = null) => ({
		relation,
		editedOutside,
		exportedAt,
		browserSavedAt,
		approximate,
		matchesBackupAt,
	});

	if ((await normalizedContentHash(input.stored)) === fileHash) return result('identical');

	let matchesBackupAt: number | null = null;
	for (const backup of input.backups) {
		if (matchesBackupAt !== null && backup.createdAt <= matchesBackupAt) continue;
		if ((await normalizedContentHash(backup.snapshot)) === fileHash) {
			matchesBackupAt = backup.createdAt;
		}
	}
	// A file changed after download carries a time that no longer describes its content.
	if (exportedAt === null || editedOutside) return result('different', matchesBackupAt);
	return result(exportedAt < browserSavedAt ? 'older' : 'newer', matchesBackupAt);
}

/** The Open dialog's sentence about the file versus the browser copy. */
export function describeFileProvenance(
	p: FileProvenance,
	formatTime: (ms: number) => string
): string {
	const saved = formatTime(p.browserSavedAt);
	const exported = p.exportedAt === null ? null : formatTime(p.exportedAt);
	const is = p.approximate ? 'seems' : 'is';
	let text: string;
	if (p.relation === 'identical' && p.editedOutside) {
		// e.g. a base changed in a segment's `slots` but not its `sequence`, which wins on load.
		text = `The file was changed outside Foldnano after it was downloaded${exported === null ? '' : ` (${exported})`}, but Foldnano ignores those changes: it opens with the same content as the browser copy.`;
	} else if (p.relation === 'identical') {
		text = 'The file has the same content as the browser copy.';
	} else if (p.relation === 'older') {
		text = `The file ${is} older: it was downloaded ${exported}, and the browser copy was saved since (${saved}). Replacing would undo that later work.`;
	} else if (p.relation === 'newer') {
		text = `The file ${is} newer: it was downloaded ${exported}, after the browser copy was last saved (${saved}).`;
	} else if (p.editedOutside && exported !== null) {
		text = `The file was changed outside Foldnano after it was downloaded (${exported}). The browser copy was last saved ${saved}.`;
	} else {
		text = `The content differs from the browser copy, last saved ${saved}.`;
	}
	if (p.matchesBackupAt !== null) {
		text += ` It matches your backup from ${formatTime(p.matchesBackupAt)}.`;
	}
	return text;
}
