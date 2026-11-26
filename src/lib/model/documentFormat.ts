import type { DocSnapshot } from './document.svelte';
import { withoutExportStamp } from './exportStamp';
import { quaternionLength } from './Assembly/Occurrence.svelte';

export const FOLDNANO_FORMAT = 'foldnano';

/**
 * Bump when an older app would misread the saved JSON or silently drop part of it on re-save,
 * which includes adding new fields. Register the upgrade from the old version in MIGRATIONS.
 */
export const CURRENT_FORMAT_VERSION = 3;

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
export const MIGRATIONS: Readonly<Record<number, DocumentMigration>> = {
	// v2 adds the WIREFRAME region kind and optional referenceGeometry; v1 content is unchanged.
	1: (raw) => raw,
	// v3 adds the assembly: every v2 Part is placed once, at the origin. Occurrence names follow
	// `Assembly.nextOccurrenceName` (`<part name> 1`); v2 Part names are unique per document in
	// practice, but duplicates still get distinct numbers.
	2: (raw) => {
		const parts = Array.isArray(raw.parts) ? (raw.parts as RawDocumentJson[]) : [];
		const taken = new Set<string>();
		const occurrences = parts.map((part, i) => {
			const base = typeof part.name === 'string' ? part.name : `Part ${i + 1}`;
			let n = 1;
			while (taken.has(`${base} ${n}`)) n++;
			const name = `${base} ${n}`;
			taken.add(name);
			return {
				id: `occurrence-${String(part.id)}`,
				partId: part.id,
				name,
				transform: { position: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] },
				visible: true,
			};
		});
		return { ...raw, assembly: { occurrences } };
	},
};

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

/** The format version that added the assembly (occurrences) to the file. */
const ASSEMBLY_FORMAT_VERSION = 3;

const isFiniteNumber = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value);

/** An occurrence in the shape `Occurrence.fromJSON` reads (a missing Part is allowed). */
function isOccurrenceJson(value: unknown): boolean {
	if (!isRecord(value)) return false;
	const { id, partId, name, visible, transform } = value;
	if (typeof id !== 'string' || typeof partId !== 'string' || typeof name !== 'string') {
		return false;
	}
	if (typeof visible !== 'boolean' || !isRecord(transform)) return false;
	const { position, quaternion } = transform;
	return (
		isRecord(position) &&
		[position.x, position.y, position.z].every(isFiniteNumber) &&
		Array.isArray(quaternion) &&
		quaternion.length === 4 &&
		quaternion.every(isFiniteNumber) &&
		// A zero quaternion is no rotation at all; any other length is normalized on load.
		quaternionLength(quaternion) > 1e-9
	);
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
	const assembly = migrated.assembly;
	if (!isRecord(assembly) || !Array.isArray(assembly.occurrences)) {
		throw new DocumentFormatError('malformed', 'This Foldnano design has no assembly.');
	}
	// Only a file's own occurrences are checked; a migration builds them from the Parts, which are
	// checked when the document is built.
	const badIndex =
		version >= ASSEMBLY_FORMAT_VERSION
			? assembly.occurrences.findIndex((occurrence) => !isOccurrenceJson(occurrence))
			: -1;
	if (badIndex >= 0) {
		throw new DocumentFormatError(
			'malformed',
			`Instance ${badIndex + 1} of this Foldnano design can't be read (it needs an id, a Part id, a name, a visibility and a finite placement).`
		);
	}
	// A download stamp describes that one file; every stored or committed copy goes through here.
	return {
		...withoutExportStamp(migrated),
		format: FOLDNANO_FORMAT,
		formatVersion: CURRENT_FORMAT_VERSION,
	} as unknown as DocSnapshot;
}

/**
 * Serializes a design for a file (download, zip, GitHub commit). The design's name is the file's
 * own name, so the top-level `name` is left out; browser storage keeps it.
 */
export function stringifyDesignFile(snapshot: object, space?: number): string {
	const { name: _name, ...rest } = snapshot as Record<string, unknown>;
	return JSON.stringify(rest, null, space);
}
