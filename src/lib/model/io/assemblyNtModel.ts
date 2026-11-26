import type FoldnanoDocument from '$lib/model/document.svelte';
import type { Part } from '$lib/model/Part';
import type { Occurrence, OccurrenceTransform } from '$lib/model/Assembly';
import { applyTransform, rotateVec } from '$lib/model/geometry3d/dnaGeometry';
import type { Quat, Vec3 } from '$lib/model/geometry3d/types';
import type { BlockTransformOverride } from '$lib/model/rbs/rbsTypes';
import {
	buildSimulationNtModel,
	type SimulationFallbackBase,
	type SimulationNtModel,
	type SimulationNucleotide,
} from './simulationNtModel';

export interface AssemblyNucleotide extends SimulationNucleotide {
	/** The instance this nucleotide belongs to. `segmentId` stays the Part's own segment id. */
	occurrenceId: string;
}

export interface AssemblyNtModel extends SimulationNtModel {
	nucleotides: AssemblyNucleotide[];
	/** The instances exported, in order; each one's nucleotides are contiguous. */
	occurrenceIds: string[];
}

export interface AssemblyNtOptions {
	fallbackBase?: SimulationFallbackBase;
	includeMirrors?: boolean;
	/** Relaxed (RBS) segment poses in Part space, by Part id; every instance of a Part gets its own. */
	relaxedParts?: ReadonlyMap<string, Map<string, BlockTransformOverride>>;
}

/**
 * What a simulation export (oxDNA / mrDNA) holds: every visible instance, each at its placement,
 * or the active Part alone in its own coordinates.
 */
export type SimulationExportScope = 'assembly' | 'activePart';

/** What the 3D Export menu asks the view to build. */
export interface SimulationExportRequest {
	includeMirrors?: boolean;
	scope?: SimulationExportScope;
}

/**
 * The instances an assembly export covers: visible ones whose Part exists (a broken instance has
 * nothing to export). Exports follow the 3D view, so hiding an instance leaves it out.
 */
export function exportedOccurrences(doc: FoldnanoDocument): Occurrence[] {
	return doc.assembly.occurrences.filter(
		(occurrence) => occurrence.visible && doc.parts.some((p) => p.id === occurrence.partId)
	);
}

function isIdentity({ position: p, quaternion: q }: OccurrenceTransform): boolean {
	return p.x === 0 && p.y === 0 && p.z === 0 && q[0] === 0 && q[1] === 0 && q[2] === 0;
}

/**
 * True when an assembly export can differ from the active Part alone: the design places more than
 * one instance, or has moved or hidden its only one. Hiding instances never takes the choice away;
 * the export then holds whatever is visible (nothing, for a hidden single instance).
 */
export function offersAssemblyExport(doc: FoldnanoDocument): boolean {
	const placed = doc.assembly.occurrences.filter((o) => doc.parts.some((p) => p.id === o.partId));
	return placed.length > 1 || placed.some((o) => !o.visible || !isIdentity(o.transform));
}

/** The Parts an export of `scope` holds, in design order (none for an assembly with nothing visible). */
export function simulationExportParts(
	doc: FoldnanoDocument,
	scope: SimulationExportScope,
	activePart: Part | null
): Part[] {
	if (scope === 'activePart') return activePart ? [activePart] : [];
	const partIds = new Set(exportedOccurrences(doc).map((o) => o.partId));
	return doc.parts.filter((part) => partIds.has(part.id));
}

/**
 * One nucleotide model for every exported instance: each Part's model (built once), with RBS
 * overrides applied in Part space, placed by the instance's transform, and renumbered so ids,
 * strand ids and links stay unique. VH, pair and span keys get the instance id as a prefix, so
 * two instances of one Part never pair or stack with each other.
 */
export function buildAssemblyNtModel(
	doc: FoldnanoDocument,
	options: AssemblyNtOptions = {}
): AssemblyNtModel {
	const { fallbackBase, includeMirrors, relaxedParts } = options;
	const partModels = new Map<string, SimulationNtModel>();
	const nucleotides: AssemblyNucleotide[] = [];
	const occurrenceIds: string[] = [];
	let strandCount = 0;

	for (const occurrence of exportedOccurrences(doc)) {
		const part = doc.parts.find((p) => p.id === occurrence.partId) as Part;
		let model = partModels.get(part.id);
		if (!model) {
			model = buildSimulationNtModel(part, { fallbackBase, includeMirrors });
			partModels.set(part.id, model);
		}
		const overrides = relaxedParts?.get(part.id);
		const idOffset = nucleotides.length;
		const prefix = `${occurrence.id}:`;
		for (const nt of model.nucleotides) {
			const relaxed = relax(nt, overrides?.get(nt.segmentId));
			nucleotides.push({
				...nt,
				id: nt.id + idOffset,
				strandId: nt.strandId + strandCount,
				prev: nt.prev === -1 ? -1 : nt.prev + idOffset,
				next: nt.next === -1 ? -1 : nt.next + idOffset,
				vhId: prefix + nt.vhId,
				pairKey: prefix + nt.pairKey,
				spanId: prefix + nt.spanId,
				...placeFrame(relaxed, occurrence.transform),
				occurrenceId: occurrence.id,
			});
		}
		strandCount += model.strandCount;
		occurrenceIds.push(occurrence.id);
	}
	return { nucleotides, strandCount, occurrenceIds };
}

interface NtFrame {
	positionNm: Vec3;
	a1: Vec3;
	a3: Vec3;
}

function relax(nt: SimulationNucleotide, override?: BlockTransformOverride): NtFrame {
	if (!override) return { positionNm: nt.positionNm, a1: nt.a1, a3: nt.a3 };
	return {
		positionNm: applyTransform(nt.positionNm, override),
		a1: rotateVec(override.quaternion, nt.a1),
		a3: rotateVec(override.quaternion, nt.a3),
	};
}

function placeFrame(frame: NtFrame, t: OccurrenceTransform): NtFrame {
	const q: Quat = {
		x: t.quaternion[0],
		y: t.quaternion[1],
		z: t.quaternion[2],
		w: t.quaternion[3],
	};
	const p = rotateVec(q, frame.positionNm);
	return {
		positionNm: { x: p.x + t.position.x, y: p.y + t.position.y, z: p.z + t.position.z },
		a1: rotateVec(q, frame.a1),
		a3: rotateVec(q, frame.a3),
	};
}

/** True when any exported instance's Part has a base without an assigned sequence. */
export function assemblyHasUnassignedSequence(
	doc: FoldnanoDocument,
	hasUnassigned: (part: Part) => boolean
): boolean {
	return simulationExportParts(doc, 'assembly', null).some(hasUnassigned);
}
