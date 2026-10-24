import { CadnanoJSON } from '$lib/model/io/cadnanoJSON';
import type { Part } from '$lib/model/Part';
import { AmbiguousLatticeError } from '$lib/model/io/cadnanoLattice';
import type { DesignFileParser, FileMeta, ParseOptions } from '.';

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

let _lastWarnings: string[] = [];

// Parser object registered in the generic system
export const cadnanoParser: DesignFileParser & { getLastWarnings(): string[] } = {
	id: 'cadnano-json',
	priority: 9,
	getLastWarnings(): string[] {
		return _lastWarnings;
	},
	canParse(raw: Record<string, unknown>, meta: FileMeta): boolean {
		// Heuristic: must have name + vstrands array
		return (
			meta.secondaryExtension === 'cadnano' ||
			(!!raw && typeof raw === 'object' && Array.isArray(raw.vstrands) && 'name' in raw)
		);
	},
	parse(raw: Record<string, unknown>, meta: FileMeta, options?: ParseOptions): Part {
		try {
			const parsedCadnanoJson = CadnanoJSON.fromRaw(raw);
			_lastWarnings = parsedCadnanoJson.warnings;
			const part = parsedCadnanoJson.toPart({ lattice: options?.lattice });
			return part;
		} catch (err) {
			// Callers catch this one to ask the user, so it must reach them unwrapped.
			if (err instanceof AmbiguousLatticeError) throw err;
			throw new SyntaxError(
				`Invalid cadnano JSON in file "${meta.name}": ${(err as Error).message}`
			);
		}
	},
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
