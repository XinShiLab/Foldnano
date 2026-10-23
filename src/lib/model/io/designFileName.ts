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

/**
 * Base name (no extension) for every file exported from a document. Exports are named after the
 * document, never the Part, whose name is internal while a document holds a single Part.
 */
export function exportBaseName(docName: string, suffix = ''): string {
	const safe = (name: string) => name.replace(/[\\/:*?"<>|]/g, '-');
	return (safe(docName).trim() || FALLBACK_BASE_NAME) + safe(suffix);
}
