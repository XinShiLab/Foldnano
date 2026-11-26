import { v4 as uuidv4 } from 'uuid';
import FoldnanoDocument from './document.svelte';
import type { Part } from './Part';
import type { PartSource } from './Part/Part.svelte';
import { remapPartIds, stableIdsFor } from './Part/remapPartIds';

// A linked Part is a read-only cached copy of the single Part of another design (its source).
// The copy gets fresh ids, so it never clashes with the assembly's other Parts; whether the source
// changed is told by hashing the source Part's content, never by comparing the copy.

type PartJSON = ReturnType<Part['toJSON']>;

/**
 * - `upToDate`: the copy matches the source's Part.
 * - `outdated`: the source changed since the copy was taken; "Update" brings the change in.
 * - `replaced`: the source design now holds a different Part than the one copied; only an
 *   explicit "Relink" takes it.
 * - `unlinkable`: the source design can't be linked any more (several Parts, or links of its
 *   own); the copy keeps working.
 * - `missing`: the source design is gone from this browser; the copy keeps working.
 * - `notLocal`: a repo design not opened in this browser yet; open it from GitHub to compare.
 * - `checking`: not compared yet.
 */
export type PartLinkState =
	'upToDate' | 'outdated' | 'replaced' | 'unlinkable' | 'missing' | 'notLocal' | 'checking';

/** The Part's content as one string with sorted keys; id, name and link info are left out. */
export function canonicalPartJson(json: PartJSON): string {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const { id, name, source, ...content } = json;
	return stableStringify(content);
}

function stableStringify(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map((v) => (v === undefined ? 'null' : stableStringify(v))).join(',')}]`;
	}
	if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
	const record = value as Record<string, unknown>;
	const fields = Object.keys(record)
		.filter((key) => record[key] !== undefined)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
	return `{${fields.join(',')}}`;
}

/** sha-256 (hex) of `canonicalPartJson`: equal for equal content however the JSON was written. */
export async function partContentHash(json: PartJSON): Promise<string> {
	const bytes = new TextEncoder().encode(canonicalPartJson(json));
	const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A stored design read into a document, or null when it can't be read. */
export function readSourceDocument(raw: unknown): FoldnanoDocument | null {
	if (!raw) return null;
	try {
		return FoldnanoDocument.fromJSON(raw);
	} catch {
		return null;
	}
}

/**
 * Why `doc` can't be linked, or null when it can. Only designs with exactly one Part and no links
 * of their own can be linked, so assemblies stay one level deep and can never link in a cycle.
 */
export function unlinkableReason(doc: FoldnanoDocument): string | null {
	if (doc.parts.length !== 1) return `has ${doc.parts.length} Parts`;
	if (doc.parts[0].source) return 'contains a linked Part';
	return null;
}

/**
 * `unlinkableReason` read straight from a stored snapshot, without building its Parts (for
 * listing many designs). Null when it can be linked.
 */
export function storedUnlinkableReason(raw: unknown): string | null {
	const parts = (raw as { parts?: { source?: unknown }[] } | null)?.parts;
	if (!Array.isArray(parts)) return "can't be read";
	if (parts.length !== 1) return `has ${parts.length} Parts`;
	if (parts[0]?.source) return 'contains a linked Part';
	return null;
}

/**
 * How a source design stands against a link to it; status and update both go through this, so
 * "Update" is offered exactly when it would bring in the linked Part.
 * - `same`: the design still holds the linked Part (`partId`).
 * - `replaced`: it holds one linkable Part, but a different one.
 * - `unlinkable`: it can't be linked any more (`reason`).
 */
export type LinkSourceMatch =
	| { kind: 'same'; part: Part }
	| { kind: 'replaced'; part: Part }
	| { kind: 'unlinkable'; reason: string };

export function matchLinkSource(doc: FoldnanoDocument, source: PartSource): LinkSourceMatch {
	const reason = unlinkableReason(doc);
	if (reason) return { kind: 'unlinkable', reason };
	const [part] = doc.parts;
	return { kind: part.id === source.partId ? 'same' : 'replaced', part };
}

/** Where a link points: the source design, without the per-copy fields. */
export type PartLinkTarget = Pick<PartSource, 'repoPath' | 'docId' | 'blobSha'>;

/** The source's Part, its content hash and the link info a copy of it carries. */
export async function linkFromSource(
	sourceDoc: FoldnanoDocument,
	target: PartLinkTarget
): Promise<{ json: PartJSON; source: PartSource }> {
	const reason = unlinkableReason(sourceDoc);
	if (reason) throw new Error(`"${sourceDoc.name}" can't be linked: it ${reason}`);
	const json = sourceDoc.parts[0].snapshot();
	const source: PartSource = {
		...(target.repoPath ? { repoPath: target.repoPath } : {}),
		...(target.docId ? { docId: target.docId } : {}),
		...(target.blobSha ? { blobSha: target.blobSha } : {}),
		partId: json.id,
		contentHash: await partContentHash(json),
		linkedAt: new Date().toISOString(),
	};
	return { json, source };
}

/**
 * JSON of a read-only copy of a source Part: its own ids throughout, the given name, and `source`
 * as its link. `id` is the copy's Part id (a new one when omitted); the other ids follow from it
 * and the source's ids (`stableIdsFor`), so an update that replaces the copy keeps them.
 */
export function linkedPartJson(
	json: PartJSON,
	source: PartSource,
	name: string,
	id?: string
): PartJSON {
	const partId = id ?? uuidv4();
	return { ...remapPartIds(json, stableIdsFor(partId)), id: partId, name, source };
}

/**
 * True when `source` points at the design `target` names: the same repo path, or the same local
 * document (a link taken before its source was published has only the local id).
 */
export function sameLinkTarget(source: PartSource, target: PartLinkTarget): boolean {
	if (source.repoPath && target.repoPath && source.repoPath === target.repoPath) return true;
	return !!source.docId && source.docId === target.docId;
}
