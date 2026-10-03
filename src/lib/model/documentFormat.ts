import type { DocSnapshot } from './document.svelte';

export const FOLDNANO_FORMAT = 'foldnano';

/**
 * Bump when an older app would misread the saved JSON or silently drop part of it on re-save,
 * which includes adding new fields. Register the upgrade from the old version in MIGRATIONS.
 */
export const CURRENT_FORMAT_VERSION = 1;

export interface SavedWith {
	app: string;
	commit: string;
}

export interface DocumentFormatHeader {
	format: typeof FOLDNANO_FORMAT;
	formatVersion: number;
	/** Provenance only; never branch on it. */
	savedWith?: SavedWith;
}

export type RawDocumentJson = Record<string, unknown>;
export type DocumentMigration = (raw: RawDocumentJson) => RawDocumentJson;

/** `MIGRATIONS[n]` upgrades a version-n document to version n + 1. */
export const MIGRATIONS: Readonly<Record<number, DocumentMigration>> = {};

export type DocumentFormatErrorReason = 'too-new' | 'malformed';

/** Carries a message that is safe to show the user as-is. */
export class DocumentFormatError extends Error {
	readonly reason: DocumentFormatErrorReason;

	constructor(reason: DocumentFormatErrorReason, message: string) {
		super(message);
		this.name = 'DocumentFormatError';
		this.reason = reason;
	}
}

function isRecord(value: unknown): value is RawDocumentJson {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readFormatVersion(raw: RawDocumentJson): number {
	// Files written before versioning have no field; they are version 1.
	if (raw.formatVersion === undefined) return 1;
	const version = raw.formatVersion;
	if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
		throw new DocumentFormatError(
			'malformed',
			`This design file has an invalid format version (${JSON.stringify(version)}).`
		);
	}
	return version;
}

function tooNewMessage(raw: RawDocumentJson, version: number): string {
	const savedWith = isRecord(raw.savedWith) ? raw.savedWith : undefined;
	const byApp = typeof savedWith?.app === 'string' ? ` by Foldnano ${savedWith.app}` : '';
	return (
		`This design was saved${byApp} in file format version ${version}, but this version of ` +
		`Foldnano can only open up to version ${CURRENT_FORMAT_VERSION}. ` +
		`Reload the page to update Foldnano, then open the design again.`
	);
}

export function applyMigrations(
	raw: RawDocumentJson,
	fromVersion: number,
	toVersion = CURRENT_FORMAT_VERSION,
	migrations: Readonly<Record<number, DocumentMigration>> = MIGRATIONS
): RawDocumentJson {
	let current = raw;
	for (let version = fromVersion; version < toVersion; version++) {
		const migrate = migrations[version];
		if (!migrate) throw new Error(`No document migration registered from version ${version}`);
		current = migrate(current);
	}
	return current;
}

/**
 * Validates a raw Foldnano document and upgrades it to the current format version. Throws
 * DocumentFormatError for files this app cannot open, including ones from a newer app.
 */
export function migrateDocumentJson(raw: unknown): DocSnapshot {
	if (!isRecord(raw)) {
		throw new DocumentFormatError('malformed', 'This file is not a Foldnano design.');
	}
	if (raw.format !== undefined && raw.format !== FOLDNANO_FORMAT) {
		throw new DocumentFormatError(
			'malformed',
			`This file is not a Foldnano design (format "${String(raw.format)}").`
		);
	}
	const version = readFormatVersion(raw);
	if (version > CURRENT_FORMAT_VERSION) {
		throw new DocumentFormatError('too-new', tooNewMessage(raw, version));
	}
	const migrated = applyMigrations(raw, version);
	if (!Array.isArray(migrated.parts)) {
		throw new DocumentFormatError('malformed', 'This Foldnano design has no parts list.');
	}
	return {
		...migrated,
		format: FOLDNANO_FORMAT,
		formatVersion: CURRENT_FORMAT_VERSION,
	} as unknown as DocSnapshot;
}
