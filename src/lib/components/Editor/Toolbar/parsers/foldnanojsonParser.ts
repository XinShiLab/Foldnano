// import { CadnanoJSON, type VStrandJSON } from '$lib/model/io/cadnanoJSON';
// import type { Part } from '$lib/model/Part';
import FoldnanoDocument from '$lib/model/document.svelte';
import { DocumentFormatError } from '$lib/model/documentFormat';
import type { DesignFileParser, FileMeta } from '.';

// export async function parseCadnanoJSON(file: File): Promise<Part> {
//   // Legacy convenience wrapper
//   const text = await file.text();
//   const raw = JSON.parse(text);
//   return cadnanoParser.parse(raw, {
//     name: file.name,
//     extension: file.name.split('.').pop() || '',
//     size: file.size,
//     type: file.type
//   });
// }

// Parser object registered in the generic system
export const foldnanojsonParser: DesignFileParser = {
	id: 'foldnano-json',
	priority: 10,
	canParse(raw: Record<string, unknown>): boolean {
		// Structure-based detection: any JSON with a top-level `parts` array is a Foldnano document.
		// This handles .fn.json, .cweb.json (backward compat), and plain .json with the right shape.
		// No conflict with cadnano format which uses `vstrands` + `name`.
		return (
			!!raw && typeof raw === 'object' && (raw.format === 'foldnano' || Array.isArray(raw.parts))
		);
	},
	parse(raw: Record<string, unknown>, meta: FileMeta): FoldnanoDocument {
		try {
			return FoldnanoDocument.fromJSON(raw);
		} catch (err) {
			if (err instanceof DocumentFormatError) throw err;
			throw new SyntaxError(
				`Invalid Foldnano JSON in file "${meta.name}": ${(err as Error).message}`
			);
		}
	},
};
