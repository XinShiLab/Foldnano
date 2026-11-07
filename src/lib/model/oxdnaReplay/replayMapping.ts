import type { Part } from '$lib/model/Part';
import { buildSimulationNtModel, type SimulationNucleotide } from '$lib/model/io/simulationNtModel';

import type { OxDnaTopology } from './oxdnaTopology';

/** Trajectory row `i` is `nucleotides[i]` of the design's NT model. */
export interface ReplayMapping {
	nucleotides: SimulationNucleotide[];
	strandCount: number;
	includeMirrors: boolean;
}

export type ReplayMappingResult =
	{ ok: true; mapping: ReplayMapping } | { ok: false; reason: string };

function partHasMirrors(part: Part): boolean {
	for (const oligo of part.oligos) if (oligo.isMirror) return true;
	return false;
}

// Bases are compared only where the design assigns one: unassigned bases were filled with a
// fallback (possibly random) at export time.
function firstMismatch(nts: SimulationNucleotide[], top: OxDnaTopology): string | null {
	for (let row = 0; row < nts.length; row++) {
		const nt = nts[row];
		if (nt.strandId !== top.strandIds[row]) return `row ${row} belongs to a different strand`;
		if (nt.next !== top.next[row] || nt.prev !== top.prev[row]) {
			return `row ${row} is linked to different neighbours`;
		}
		if (nt.baseAssigned && nt.base !== top.bases[row]) {
			return `row ${row} has base ${top.bases[row]} but the design has ${nt.base}`;
		}
	}
	return null;
}

/**
 * Rebuilds the NT model the oxDNA exporter used and checks it row by row against the `.top`.
 * Tries without mirror copies first (the export default), then with them.
 */
export function matchTopologyToDesign(part: Part, top: OxDnaTopology): ReplayMappingResult {
	const options = partHasMirrors(part) ? [false, true] : [false];
	let reason = '';
	for (const includeMirrors of options) {
		const model = buildSimulationNtModel(part, { includeMirrors });
		const nts = model.nucleotides;
		if (nts.length !== top.nucleotideCount || model.strandCount !== top.strandCount) {
			reason ||= `The topology has ${top.nucleotideCount} nucleotides in ${top.strandCount} strands; the design exports ${nts.length} in ${model.strandCount}.`;
			continue;
		}
		const mismatch = firstMismatch(nts, top);
		if (mismatch) {
			reason = `The topology does not match this design: ${mismatch}.`;
			continue;
		}
		return {
			ok: true,
			mapping: { nucleotides: nts, strandCount: model.strandCount, includeMirrors },
		};
	}
	return {
		ok: false,
		reason: `${reason} Was the design edited after the oxDNA export?`,
	};
}
