import { strToU8, zipSync, type Zippable } from 'fflate';
import { APP_COMMIT, APP_VERSION } from '$lib/appInfo';
import { exportBaseName, FN_JSON_EXT } from '$lib/model/io/designFileName';
import type { GitHubFileMetadata } from './githubTypes';
import type { StorageManager } from './StorageManager';
import type { DocumentMetadata } from './types';

export const DESIGN_ARCHIVE_FORMAT = 'foldnano-design-archive';
export const DESIGN_ARCHIVE_VERSION = 1;
export const DESIGN_ARCHIVE_MANIFEST = 'manifest.json';

/** One saved design, as stored: the snapshot is written raw so damaged designs still get out. */
export interface ArchiveDesign {
	id: string;
	name: string;
	lastModified: number;
	snapshot: object;
	github: GitHubFileMetadata | null;
}

export interface DesignArchiveManifestEntry {
	file: string;
	id: string;
	name: string;
	lastModified: string;
	/** Where the design was linked when exported; for reference, not a live link. */
	github?: { owner: string; repo: string; branch: string; path: string };
}

export interface DesignArchiveManifest {
	format: typeof DESIGN_ARCHIVE_FORMAT;
	version: typeof DESIGN_ARCHIVE_VERSION;
	exportedAt: string;
	savedWith: { app: string; commit: string };
	designs: DesignArchiveManifestEntry[];
}

export interface DesignArchive {
	zip: Uint8Array;
	manifest: DesignArchiveManifest;
	/** Listed designs whose snapshot could not be read, so they are not in the zip. */
	skipped: DocumentMetadata[];
}

/** Reads every saved design, oldest first so duplicate names number in creation order. */
export async function collectArchiveDesigns(
	storage: StorageManager,
	githubFor: (docId: string) => GitHubFileMetadata | null
): Promise<{ designs: ArchiveDesign[]; skipped: DocumentMetadata[] }> {
	const listed = [...(await storage.getDocumentList())].sort(
		(a, b) => a.lastModified - b.lastModified
	);
	const designs: ArchiveDesign[] = [];
	const skipped: DocumentMetadata[] = [];
	for (const doc of listed) {
		const snapshot = await storage.loadDocument(doc.id);
		if (!snapshot) {
			skipped.push(doc);
			continue;
		}
		designs.push({
			id: doc.id,
			name: doc.name,
			lastModified: doc.lastModified,
			snapshot,
			github: githubFor(doc.id),
		});
	}
	return { designs, skipped };
}

/** Builds the zip: one `.fn.json` per design plus a manifest mapping files to document ids. */
export function buildDesignArchive(
	designs: readonly ArchiveDesign[],
	exportedAt: Date
): Omit<DesignArchive, 'skipped'> {
	const files: Zippable = {};
	// Case-insensitive, since unzipping on macOS or Windows would merge `A` and `a`.
	const taken = new Set<string>([DESIGN_ARCHIVE_MANIFEST]);
	const entries: DesignArchiveManifestEntry[] = [];
	for (const design of designs) {
		const file = uniqueFileName(exportBaseName(design.name), taken);
		files[file] = strToU8(JSON.stringify(design.snapshot));
		entries.push({
			file,
			id: design.id,
			name: design.name,
			lastModified: new Date(design.lastModified).toISOString(),
			...(design.github && {
				github: {
					owner: design.github.owner,
					repo: design.github.repo,
					branch: design.github.branch,
					path: design.github.path,
				},
			}),
		});
	}
	const manifest: DesignArchiveManifest = {
		format: DESIGN_ARCHIVE_FORMAT,
		version: DESIGN_ARCHIVE_VERSION,
		exportedAt: exportedAt.toISOString(),
		savedWith: { app: APP_VERSION, commit: APP_COMMIT },
		designs: entries,
	};
	files[DESIGN_ARCHIVE_MANIFEST] = strToU8(JSON.stringify(manifest, null, 2));
	return { zip: zipSync(files, { level: 6 }), manifest };
}

function uniqueFileName(base: string, taken: Set<string>): string {
	for (let n = 1; ; n++) {
		const file = `${n === 1 ? base : `${base} (${n})`}${FN_JSON_EXT}`;
		if (taken.has(file.toLowerCase())) continue;
		taken.add(file.toLowerCase());
		return file;
	}
}

/** e.g. `foldnano-designs-2026-11-07.zip`, in local time. */
export function designArchiveFileName(exportedAt: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	const day = `${exportedAt.getFullYear()}-${pad(exportedAt.getMonth() + 1)}-${pad(exportedAt.getDate())}`;
	return `foldnano-designs-${day}.zip`;
}

export async function exportAllDesigns(
	storage: StorageManager,
	githubFor: (docId: string) => GitHubFileMetadata | null,
	exportedAt = new Date()
): Promise<DesignArchive> {
	const { designs, skipped } = await collectArchiveDesigns(storage, githubFor);
	return { ...buildDesignArchive(designs, exportedAt), skipped };
}

export function downloadDesignArchive(zip: Uint8Array, exportedAt: Date): void {
	const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: 'application/zip' }));
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = designArchiveFileName(exportedAt);
	anchor.click();
	// Safari can cancel a download whose URL is revoked in the same task.
	setTimeout(() => URL.revokeObjectURL(url), 0);
}
