/**
 * The `exported` stamp a downloaded design file carries: when it was downloaded and a hash of its
 * parts, so opening it again can tell whether it is the same as, older or newer than the copy in
 * this browser, and whether it was edited outside Foldnano. Only downloads write it; it never
 * enters the model, IndexedDB or GitHub commits.
 */

export const EXPORT_STAMP_KEY = 'exported';

/** `server`: time from Foldnano's server, corrected for this computer's clock; `local`: offline. */
export type ClockSource = 'server' | 'local';

export interface ExportStamp {
	/** ISO 8601 UTC. */
	at: string;
	clock: ClockSource;
	/** `sha256:<hex>` of the file's `parts`, as canonical JSON. */
	contentHash: string;
}

const HASH_PREFIX = 'sha256:';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** JSON with object keys sorted at every level, so key order and whitespace don't change it. */
export function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
	}
	if (isRecord(value)) {
		const entries = Object.keys(value)
			.sort()
			.filter((k) => value[k] !== undefined)
			.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`);
		return `{${entries.join(',')}}`;
	}
	return JSON.stringify(value) ?? 'null';
}

/** Hash of a design's content. Only the parts: the name follows the file and the id any copy. */
export async function partsHash(parts: unknown): Promise<string> {
	const bytes = new TextEncoder().encode(canonicalJson(parts));
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
	return HASH_PREFIX + Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The file's stamp, or null for files without a valid one (older exports, other tools). */
export function readExportStamp(raw: unknown): ExportStamp | null {
	if (!isRecord(raw)) return null;
	const stamp = raw[EXPORT_STAMP_KEY];
	if (!isRecord(stamp)) return null;
	const { at, clock, contentHash } = stamp;
	if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) return null;
	if (clock !== 'server' && clock !== 'local') return null;
	if (typeof contentHash !== 'string' || !contentHash.startsWith(HASH_PREFIX)) return null;
	return { at, clock, contentHash };
}

export function withoutExportStamp<T extends object>(raw: T): T {
	if (!(EXPORT_STAMP_KEY in raw)) return raw;
	const { [EXPORT_STAMP_KEY]: _stamp, ...rest } = raw as Record<string, unknown>;
	return rest as T;
}

/** The snapshot with a fresh stamp for a download; unchanged when it has no parts list. */
export async function withExportStamp(
	snapshot: object,
	now: { at: number; clock: ClockSource }
): Promise<object> {
	const parts = (snapshot as { parts?: unknown }).parts;
	if (!Array.isArray(parts)) return snapshot;
	const stamp: ExportStamp = {
		at: new Date(now.at).toISOString(),
		clock: now.clock,
		contentHash: await partsHash(parts),
	};
	return { ...withoutExportStamp(snapshot), [EXPORT_STAMP_KEY]: stamp };
}

/** Whether the parts were changed after the stamp was written; null without a stamp. */
export async function editedSinceExport(raw: unknown): Promise<boolean | null> {
	const stamp = readExportStamp(raw);
	if (!stamp || !isRecord(raw)) return null;
	return (await partsHash(raw.parts)) !== stamp.contentHash;
}
