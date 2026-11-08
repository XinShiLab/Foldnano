// Longest first, so `x.cadnano.json` loses both parts rather than just `.json`.
const DESIGN_EXTENSIONS = ['.cadnano.json', '.cweb.json', '.fn.json', '.json'] as const;

export const FN_JSON_EXT = '.fn.json';

const FALLBACK_BASE_NAME = 'design';

/**
 * Splits a design file name into stem and extension. Only known design extensions count, so dots
 * inside the name (`origami.v2.fn.json`) stay in the stem; other files split at the last dot.
 */
export function splitDesignExtension(fileName: string): { stem: string; ext: string } {
	const lower = fileName.toLowerCase();
	const known = DESIGN_EXTENSIONS.find((ext) => lower.endsWith(ext) && lower.length > ext.length);
	if (known) {
		const cut = fileName.length - known.length;
		return { stem: fileName.slice(0, cut), ext: fileName.slice(cut) };
	}
	const dotIdx = fileName.lastIndexOf('.');
	if (dotIdx <= fileName.lastIndexOf('/') + 1) return { stem: fileName, ext: '' };
	return { stem: fileName.slice(0, dotIdx), ext: fileName.slice(dotIdx) };
}

export function stripDesignExtension(fileName: string): string {
	return splitDesignExtension(fileName).stem;
}

/** Document name of a file at `path`: its file name without the design extension. */
export function designNameFromPath(path: string): string {
	return stripDesignExtension(path.split('/').pop() ?? path);
}

/** Path of the Foldnano document created next to an imported design file. */
export function fnJsonPathFor(path: string): string {
	return stripDesignExtension(path) + FN_JSON_EXT;
}

/** Name of the blank workspace. Reserved: a design is never saved under it. */
export const UNTITLED_DOCUMENT_NAME = 'Untitled Document';

export const DESIGN_NAME_MAX_LENGTH = 100;

const DESIGN_NAME_PATTERN = /^[\p{L}\p{N}_\-. ()]+$/u;
// Windows refuses these as file names (with any extension), which breaks a clone of the repo.
const WINDOWS_DEVICE_NAMES = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

/** Names compare ignoring case and surrounding spaces: macOS and Windows clones can't hold both. */
export function designNameKey(name: string): string {
	return name.trim().toLowerCase();
}

export function isReservedDesignName(name: string): boolean {
	return designNameKey(name) === designNameKey(UNTITLED_DOCUMENT_NAME);
}

// Endings that look like part of a design extension; `box.fn` would save as `box.fn.fn.json`.
const PARTIAL_EXTENSION = /\.(fn|cadnano|cweb)$/i;

/** Trims a typed name and drops one full design extension (`box.fn.json` -> `box`). */
export function normalizeDesignName(input: string): string {
	const trimmed = input.trim();
	const lower = trimmed.toLowerCase();
	const ext = DESIGN_EXTENSIONS.find((e) => lower.endsWith(e) && lower.length > e.length);
	return ext ? trimmed.slice(0, -ext.length).trim() : trimmed;
}

/**
 * Returns an error message, or null when `name` (a file name without extension) is usable.
 * Pass typed input through `normalizeDesignName` first.
 */
export function validateDesignName(name: string): string | null {
	if (!name) return 'Name is required.';
	if (name.length > DESIGN_NAME_MAX_LENGTH) {
		return `Use at most ${DESIGN_NAME_MAX_LENGTH} characters.`;
	}
	if (!DESIGN_NAME_PATTERN.test(name)) {
		return 'Use only letters, numbers, spaces, hyphens, underscores, dots, or parentheses.';
	}
	if (/^\.+$/.test(name)) return 'Name must contain more than dots.';
	if (PARTIAL_EXTENSION.test(name)) {
		return `Leave out the file extension; ${FN_JSON_EXT} is added for you.`;
	}
	if (/^[ .]|[ .]$/.test(name)) return 'Name cannot start or end with a space or dot.';
	if (WINDOWS_DEVICE_NAMES.test(name)) return `"${name}" is reserved on Windows.`;
	if (isReservedDesignName(name)) return `"${UNTITLED_DOCUMENT_NAME}" is reserved; pick a name.`;
	return null;
}

/** First of `base`, `base (2)`, `base (3)`, ... not in `taken` (compared ignoring case). */
export function uniqueDesignName(base: string, taken: Iterable<string>): string {
	const keys = new Set([...taken].map(designNameKey));
	if (!keys.has(designNameKey(base))) return base;
	for (let n = 2; ; n++) {
		const candidate = `${base} (${n})`;
		if (!keys.has(designNameKey(candidate))) return candidate;
	}
}

/** The entry of `paths` naming the same file as `target` ignoring case, other than `ownPath`. */
export function findPathClash(
	paths: Iterable<string>,
	target: string,
	ownPath?: string
): string | null {
	const key = target.toLowerCase();
	const own = ownPath?.toLowerCase();
	for (const path of paths) {
		const k = path.toLowerCase();
		if (k === key && k !== own) return path;
	}
	return null;
}

/**
 * Base name (no extension) for every file exported from a document. Exports are named after the
 * document, never the Part, whose name is internal while a document holds a single Part.
 */
export function exportBaseName(docName: string, suffix = ''): string {
	const safe = (name: string) => name.replace(/[\\/:*?"<>|]/g, '-');
	return (safe(docName).trim() || FALLBACK_BASE_NAME) + safe(suffix);
}
