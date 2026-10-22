import { SvelteSet } from 'svelte/reactivity';
import type FoldnanoDocument from '$lib/model/document.svelte';
import type { DocSnapshot } from '$lib/model/document.svelte';
import type Oligo from '$lib/model/Oligo';
import OligoClass, { type OligoSegment, type SegmentEnd } from '$lib/model/Oligo';
import type { Part } from '$lib/model/Part';
import { DesignRegion } from '$lib/model/Part';
import { Plane, type PlaneVec3 } from '$lib/model/Part/Plane.svelte';
import type { OverlayPlacement } from '$lib/model/Part/Part.svelte';
import VirtualHelix from '$lib/model/VirtualHelix';
import StrandSet from '$lib/model/VirtualHelix/StrandSet.svelte';
import type { ModificationDef } from '$lib/model/modifications';

type OligoSnapshot = ReturnType<Oligo['toJSON']>;
type VirtualHelixSnapshot = ReturnType<VirtualHelix['toJSON']>;

export type ModelRef =
	| { kind: 'doc'; docId: string }
	| { kind: 'part'; partId: string }
	| { kind: 'vh'; partId: string; vhIndex: number }
	| { kind: 'oligo'; partId: string; oligoId: string }
	| { kind: 'segment'; partId: string; segmentId: string }
	| { kind: 'end'; partId: string; segmentId: string; end: 'fivePrime' | 'threePrime' }
	| { kind: 'slot'; partId: string; segmentId: string; bpIndex: number };

export type FieldChange = {
	kind: 'field';
	ref: ModelRef;
	field: string;
	value: unknown;
};

export type SlotSeqChange = {
	kind: 'slotSeq';
	ref: Extract<ModelRef, { kind: 'slot' }>;
	value: string;
};

export type PartMemento = {
	partId: string;
	virtualHelixIndices: number[];
	oligoIds: string[];
	segmentIds: string[];
	regions?: ReturnType<DesignRegion['toJSON']>[];
	oligoOrder: string[];
	oligos: OligoSnapshot[];
	virtualHelices: VirtualHelixSnapshot[];
	maxBase?: number;
	customModifications?: ModificationDef[];
};

export type PartMementoChange = {
	kind: 'partMemento';
	memento: PartMemento;
};

export type DocumentSnapshotChange = {
	kind: 'documentSnapshot';
	snapshot: DocSnapshot;
};

export type PlaneTransformChange = {
	kind: 'planeTransform';
	partId: string;
	planeId: string;
	origin: PlaneVec3;
	u: PlaneVec3;
	v: PlaneVec3;
	normal: PlaneVec3;
};

export type PlaneAddChange = {
	kind: 'planeAdd';
	partId: string;
	planeJson: ReturnType<Plane['toJSON']>;
};

export type PlaneRemoveChange = {
	kind: 'planeRemove';
	partId: string;
	planeId: string;
};

export type RegionAddChange = {
	kind: 'regionAdd';
	partId: string;
	regionJson: ReturnType<DesignRegion['toJSON']>;
};

export type RegionRemoveChange = {
	kind: 'regionRemove';
	partId: string;
	regionId: string;
};

export type OverlayPlacementSetChange = {
	kind: 'overlayPlacementSet';
	partId: string;
	placement: OverlayPlacement;
};

export type OverlayPlacementRemoveChange = {
	kind: 'overlayPlacementRemove';
	partId: string;
	id: string;
};

export type AtomicChange =
	| FieldChange
	| SlotSeqChange
	| PartMementoChange
	| DocumentSnapshotChange
	| PlaneTransformChange
	| PlaneAddChange
	| PlaneRemoveChange
	| RegionAddChange
	| RegionRemoveChange
	| OverlayPlacementSetChange
	| OverlayPlacementRemoveChange;

export type HistoryEntry = {
	label: string;
	undo: AtomicChange[];
	redo: AtomicChange[];
};

export type PartScopeSeed = {
	oligoIds?: string[];
	segmentIds?: string[];
	vhIndices?: number[];
	includeMaxBase?: boolean;
	includeCustomModifications?: boolean;
};

type FieldPatchDraft = {
	ref: ModelRef;
	field: string;
	before: unknown;
	after: unknown;
};

type SlotPatchDraft = {
	ref: Extract<ModelRef, { kind: 'slot' }>;
	before: string;
	after: string;
};

type MementoPatchDraft = {
	before: PartMemento;
	after: PartMemento;
};

type SnapshotPatchDraft = {
	before: DocSnapshot;
	after: DocSnapshot;
};

type PlaneTransformPatchDraft = {
	partId: string;
	planeId: string;
	before: { origin: PlaneVec3; u: PlaneVec3; v: PlaneVec3; normal: PlaneVec3 };
	after: { origin: PlaneVec3; u: PlaneVec3; v: PlaneVec3; normal: PlaneVec3 };
};

type PlaneAddPatchDraft = {
	partId: string;
	planeJson: ReturnType<Plane['toJSON']>;
};

type RegionAddPatchDraft = {
	partId: string;
	regionJson: ReturnType<DesignRegion['toJSON']>;
};

type OverlayPlacementPatchDraft = {
	partId: string;
	id: string;
	before: OverlayPlacement | undefined;
	after: OverlayPlacement | undefined;
};

const stableStringify = (value: unknown) => JSON.stringify(value);

const sameValue = (a: unknown, b: unknown): boolean => stableStringify(a) === stableStringify(b);

export const partRef = (part: Part): Extract<ModelRef, { kind: 'part' }> => ({
	kind: 'part',
	partId: part.id,
});

export const oligoRef = (oligo: Oligo): Extract<ModelRef, { kind: 'oligo' }> => ({
	kind: 'oligo',
	partId: oligo.inPart.id,
	oligoId: oligo.id,
});

export const segmentRef = (segment: OligoSegment): Extract<ModelRef, { kind: 'segment' }> => ({
	kind: 'segment',
	partId: segment.inPart.id,
	segmentId: segment.id,
});

export const endRef = (end: SegmentEnd): Extract<ModelRef, { kind: 'end' }> => ({
	kind: 'end',
	partId: end.inPart.id,
	segmentId: end.segment.id,
	end: end.isThreePrime ? 'threePrime' : 'fivePrime',
});

export const slotRef = (
	segment: OligoSegment,
	bpIndex: number
): Extract<ModelRef, { kind: 'slot' }> => ({
	kind: 'slot',
	partId: segment.inPart.id,
	segmentId: segment.id,
	bpIndex,
});

export const vhRef = (vh: VirtualHelix): Extract<ModelRef, { kind: 'vh' }> => ({
	kind: 'vh',
	partId: vh.inPart.id,
	vhIndex: vh.index,
});

export function applyAtomicChanges(doc: FoldnanoDocument, changes: AtomicChange[]): void {
	for (const change of changes) {
		applyAtomicChange(doc, change);
	}
}

function applyAtomicChange(doc: FoldnanoDocument, change: AtomicChange): void {
	switch (change.kind) {
		case 'field': {
			const target = resolveRef(doc, change.ref) as Record<string, unknown>;
			target[change.field] = change.value;
			if (change.ref.kind === 'vh' && change.field === 'latticeCoords') {
				const vh = resolveRef(doc, change.ref) as VirtualHelix;
				const region = vh.regionId
					? resolvePart(doc, change.ref.partId).getRegionById(vh.regionId)
					: null;
				if (
					region &&
					'invalidateDerivedCaches' in region &&
					typeof region.invalidateDerivedCaches === 'function'
				) {
					region.invalidateDerivedCaches();
				}
			}
			break;
		}
		case 'slotSeq': {
			const segment = resolveRef(doc, {
				kind: 'segment',
				partId: change.ref.partId,
				segmentId: change.ref.segmentId,
			}) as OligoSegment;
			const slot = segment.slotForBp(change.ref.bpIndex);
			if (!slot) {
				throw new Error(
					`Cannot apply slot history: slot ${change.ref.bpIndex} not found on segment ${change.ref.segmentId}`
				);
			}
			slot.seq = change.value;
			break;
		}
		case 'partMemento':
			applyPartMemento(resolvePart(doc, change.memento.partId), change.memento);
			break;
		case 'documentSnapshot':
			doc.restore(change.snapshot);
			break;
		case 'planeTransform':
			resolvePart(doc, change.partId).setPlaneTransform(change.planeId, {
				origin: change.origin,
				u: change.u,
				v: change.v,
				normal: change.normal,
			});
			break;
		case 'planeAdd':
			resolvePart(doc, change.partId).addPlane(Plane.fromJSON(change.planeJson));
			break;
		case 'planeRemove':
			resolvePart(doc, change.partId).removePlane(change.planeId);
			break;
		case 'regionAdd':
			resolvePart(doc, change.partId).addRegion(DesignRegion.fromJSON(change.regionJson));
			break;
		case 'regionRemove':
			resolvePart(doc, change.partId).removeRegion(change.regionId);
			break;
		case 'overlayPlacementSet':
			resolvePart(doc, change.partId).setOverlayPlacement(
				change.placement.id,
				change.placement.sourceKey,
				change.placement.transform
			);
			break;
		case 'overlayPlacementRemove':
			resolvePart(doc, change.partId).clearOverlayPlacement(change.id);
			break;
	}
}

function resolveRef(doc: FoldnanoDocument, ref: ModelRef): unknown {
	switch (ref.kind) {
		case 'doc':
			if (doc.id !== ref.docId) throw new Error(`Document ${ref.docId} is not loaded`);
			return doc;
		case 'part':
			return resolvePart(doc, ref.partId);
		case 'vh': {
			const part = resolvePart(doc, ref.partId);
			const vh = part.getVhByIndex(ref.vhIndex);
			if (!vh) throw new Error(`VirtualHelix ${ref.vhIndex} not found in part ${ref.partId}`);
			return vh;
		}
		case 'oligo': {
			const part = resolvePart(doc, ref.partId);
			const oligo = part.getOligoById(ref.oligoId);
			if (!oligo) throw new Error(`Oligo ${ref.oligoId} not found in part ${ref.partId}`);
			return oligo;
		}
		case 'segment': {
			const part = resolvePart(doc, ref.partId);
			const segment = part.getSegmentById(ref.segmentId);
			if (!segment) throw new Error(`Segment ${ref.segmentId} not found in part ${ref.partId}`);
			return segment;
		}
		case 'end': {
			const segment = resolveRef(doc, {
				kind: 'segment',
				partId: ref.partId,
				segmentId: ref.segmentId,
			}) as OligoSegment;
			return ref.end === 'fivePrime' ? segment.fivePrime : segment.threePrime;
		}
		case 'slot':
			return resolveRef(doc, {
				kind: 'segment',
				partId: ref.partId,
				segmentId: ref.segmentId,
			});
	}
}

function resolvePart(doc: FoldnanoDocument, partId: string): Part {
	const part = doc.parts.find((candidate) => candidate.id === partId);
	if (!part) throw new Error(`Part ${partId} not found in document ${doc.id}`);
	return part;
}

export class PartScopeCapture {
	readonly #recorder: HistoryRecorder;
	readonly #part: Part;
	readonly #seed: Required<PartScopeSeed>;
	readonly #before: PartMemento;
	readonly #vhIndicesExistingAtConstruction: Set<number>;

	constructor(recorder: HistoryRecorder, part: Part, seed: PartScopeSeed) {
		this.#recorder = recorder;
		this.#part = part;
		this.#seed = normalizeSeed(seed);
		this.#vhIndicesExistingAtConstruction = new Set(part.virtualHelices.map((vh) => vh.index));
		this.#before = capturePartMemento(part, this.#seed);
	}

	commit(): void {
		const expandedSeed = expandSeedAfterMutation(this.#part, this.#seed, this.#before);
		const before = capturePartMementoFromResolved(
			this.#part,
			expandedSeed,
			this.#before,
			this.#seed,
			this.#vhIndicesExistingAtConstruction
		);
		const after = capturePartMemento(this.#part, expandedSeed);
		this.#recorder.partMemento(before, after);
	}
}

export class HistoryRecorder {
	#fields: FieldPatchDraft[] = [];
	#slots: SlotPatchDraft[] = [];
	#mementos: MementoPatchDraft[] = [];
	#snapshots: SnapshotPatchDraft[] = [];
	#planeTransforms: PlaneTransformPatchDraft[] = [];
	#planeAdds: PlaneAddPatchDraft[] = [];
	#planeRemoves: PlaneAddPatchDraft[] = [];
	#regionAdds: RegionAddPatchDraft[] = [];
	#regionRemoves: RegionAddPatchDraft[] = [];
	#overlayPlacements: OverlayPlacementPatchDraft[] = [];

	constructor(readonly doc: FoldnanoDocument) {}

	field(ref: ModelRef, field: string, before: unknown, after: unknown): void {
		this.#fields.push({ ref, field, before, after });
	}

	slot(segment: OligoSegment, bpIndex: number, beforeSeq: string, afterSeq: string): void {
		this.#slots.push({ ref: slotRef(segment, bpIndex), before: beforeSeq, after: afterSeq });
	}

	capturePartScope(part: Part, seed: PartScopeSeed): PartScopeCapture {
		return new PartScopeCapture(this, part, seed);
	}

	partMemento(before: PartMemento, after: PartMemento): void {
		this.#mementos.push({ before, after });
	}

	documentSnapshot(before: DocSnapshot, after: DocSnapshot): void {
		this.#snapshots.push({ before, after });
	}

	planeTransform(
		part: Part,
		planeId: string,
		before: { origin: PlaneVec3; u: PlaneVec3; v: PlaneVec3; normal: PlaneVec3 },
		after: { origin: PlaneVec3; u: PlaneVec3; v: PlaneVec3; normal: PlaneVec3 }
	): void {
		this.#planeTransforms.push({ partId: part.id, planeId, before, after });
	}

	planeAdd(part: Part, planeJson: ReturnType<Plane['toJSON']>): void {
		this.#planeAdds.push({ partId: part.id, planeJson });
	}

	planeRemove(part: Part, plane: Plane): void {
		this.#planeRemoves.push({ partId: part.id, planeJson: plane.toJSON() });
	}

	regionAdd(part: Part, regionJson: ReturnType<DesignRegion['toJSON']>): void {
		this.#regionAdds.push({ partId: part.id, regionJson });
	}

	regionRemove(part: Part, region: DesignRegion): void {
		this.#regionRemoves.push({ partId: part.id, regionJson: region.toJSON() });
	}

	/** Targeted patch for one overlay-placement entry (set/update/clear). */
	overlayPlacement(
		part: Part,
		id: string,
		before: OverlayPlacement | undefined,
		after: OverlayPlacement | undefined
	): void {
		this.#overlayPlacements.push({ partId: part.id, id, before, after });
	}

	commit(label: string): HistoryEntry | null {
		const undo: AtomicChange[] = [];
		const redo: AtomicChange[] = [];

		for (const patch of this.#slots) {
			if (patch.before === patch.after) continue;
			undo.push({ kind: 'slotSeq', ref: patch.ref, value: patch.before });
			redo.push({ kind: 'slotSeq', ref: patch.ref, value: patch.after });
		}

		for (const patch of this.#mementos) {
			if (sameValue(patch.before, patch.after)) continue;
			redo.push({ kind: 'partMemento', memento: patch.after });
		}
		// Undo unwinds scopes last-in-first-out: a scope committed later captured its "before"
		// after earlier scopes had already mutated shared VHs, so applying it last would clobber them.
		for (const patch of [...this.#mementos].reverse()) {
			if (sameValue(patch.before, patch.after)) continue;
			undo.push({ kind: 'partMemento', memento: patch.before });
		}

		for (const patch of this.#snapshots) {
			if (sameValue(patch.before, patch.after)) continue;
			undo.push({ kind: 'documentSnapshot', snapshot: patch.before });
			redo.push({ kind: 'documentSnapshot', snapshot: patch.after });
		}

		for (const patch of this.#fields) {
			if (sameValue(patch.before, patch.after)) continue;
			undo.push({ kind: 'field', ref: patch.ref, field: patch.field, value: patch.before });
			redo.push({ kind: 'field', ref: patch.ref, field: patch.field, value: patch.after });
		}

		for (const patch of this.#planeTransforms) {
			if (sameValue(patch.before, patch.after)) continue;
			undo.push({
				kind: 'planeTransform',
				partId: patch.partId,
				planeId: patch.planeId,
				origin: patch.before.origin,
				u: patch.before.u,
				v: patch.before.v,
				normal: patch.before.normal,
			});
			redo.push({
				kind: 'planeTransform',
				partId: patch.partId,
				planeId: patch.planeId,
				origin: patch.after.origin,
				u: patch.after.u,
				v: patch.after.v,
				normal: patch.after.normal,
			});
		}

		for (const patch of this.#planeAdds) {
			undo.push({ kind: 'planeRemove', partId: patch.partId, planeId: patch.planeJson.id });
			redo.push({ kind: 'planeAdd', partId: patch.partId, planeJson: patch.planeJson });
		}

		for (const patch of this.#planeRemoves) {
			undo.push({ kind: 'planeAdd', partId: patch.partId, planeJson: patch.planeJson });
			redo.push({ kind: 'planeRemove', partId: patch.partId, planeId: patch.planeJson.id });
		}

		for (const patch of this.#regionAdds) {
			undo.push({ kind: 'regionRemove', partId: patch.partId, regionId: patch.regionJson.id });
			redo.push({ kind: 'regionAdd', partId: patch.partId, regionJson: patch.regionJson });
		}

		for (const patch of this.#regionRemoves) {
			undo.push({ kind: 'regionAdd', partId: patch.partId, regionJson: patch.regionJson });
			redo.push({ kind: 'regionRemove', partId: patch.partId, regionId: patch.regionJson.id });
		}

		for (const patch of this.#overlayPlacements) {
			if (sameValue(patch.before, patch.after)) continue;
			undo.push(
				patch.before
					? { kind: 'overlayPlacementSet', partId: patch.partId, placement: patch.before }
					: { kind: 'overlayPlacementRemove', partId: patch.partId, id: patch.id }
			);
			redo.push(
				patch.after
					? { kind: 'overlayPlacementSet', partId: patch.partId, placement: patch.after }
					: { kind: 'overlayPlacementRemove', partId: patch.partId, id: patch.id }
			);
		}

		return undo.length || redo.length ? { label, undo, redo } : null;
	}
}

function normalizeSeed(seed: PartScopeSeed): Required<PartScopeSeed> {
	return {
		oligoIds: [...(seed.oligoIds ?? [])],
		segmentIds: [...(seed.segmentIds ?? [])],
		vhIndices: [...(seed.vhIndices ?? [])],
		includeMaxBase: seed.includeMaxBase ?? false,
		includeCustomModifications: seed.includeCustomModifications ?? false,
	};
}

function capturePartMemento(part: Part, seed: Required<PartScopeSeed>): PartMemento {
	const resolved = resolvePartScope(part, seed);
	return {
		partId: part.id,
		virtualHelixIndices: [...resolved.vhIndices],
		oligoIds: [...resolved.oligoIds],
		segmentIds: [...resolved.segmentIds],
		regions: part.regions.map((region) => region.toJSON()),
		oligoOrder: Array.from(part.oligos).map((oligo) => oligo.id),
		oligos: Array.from(part.oligos)
			.filter((oligo) => resolved.oligoIds.has(oligo.id))
			.map((oligo) => oligo.toJSON()),
		virtualHelices: part.virtualHelices
			.filter((vh) => resolved.vhIndices.has(vh.index))
			.map((vh) => vh.toJSON()),
		maxBase: seed.includeMaxBase ? part.maxBase : undefined,
		customModifications: seed.includeCustomModifications
			? JSON.parse(JSON.stringify(part.customModifications))
			: undefined,
	};
}

function capturePartMementoFromResolved(
	part: Part,
	expandedSeed: Required<PartScopeSeed>,
	before: PartMemento,
	originalSeed: Required<PartScopeSeed>,
	vhIndicesExistingAtConstruction: Set<number>
): PartMemento {
	const currentBefore = capturePartMemento(part, {
		...expandedSeed,
		includeMaxBase: originalSeed.includeMaxBase,
		includeCustomModifications: originalSeed.includeCustomModifications,
	});
	const beforeOligos = new Map(before.oligos.map((oligo) => [oligo.id, oligo]));
	const beforeVhs = new Map(before.virtualHelices.map((vh) => [vh.index, vh]));

	// A VH index with no pre-mutation snapshot is only safe to keep when the VH was genuinely
	// created during this transaction (absent from vhIndicesExistingAtConstruction). If it already
	// existed beforehand, the missing snapshot means it was swept into scope as a side effect —
	// e.g. an oligo pulled in via one segment brings *all* its segments' VHs along, even ones the
	// original seed never touched — not because its own container actually changed. Keeping such
	// an index would make applyPartMemento hit the "exists but no snapshot" branch on undo and
	// delete an untouched VH.
	const safeVhIndices = currentBefore.virtualHelixIndices.filter(
		(index) => beforeVhs.has(index) || !vhIndicesExistingAtConstruction.has(index)
	);

	return {
		...currentBefore,
		virtualHelixIndices: safeVhIndices,
		regions: before.regions ?? currentBefore.regions,
		oligoOrder: before.oligoOrder,
		oligos: currentBefore.oligoIds
			.map((id) => beforeOligos.get(id))
			.filter((oligo): oligo is OligoSnapshot => Boolean(oligo)),
		virtualHelices: safeVhIndices
			.map((index) => beforeVhs.get(index))
			.filter((vh): vh is VirtualHelixSnapshot => Boolean(vh)),
		segmentIds: Array.from(
			new Set([
				...currentBefore.segmentIds,
				...before.segmentIds,
				...before.oligos.flatMap((oligo) => oligo.segments.map((segment) => segment.id)),
			])
		),
		oligoIds: Array.from(new Set([...currentBefore.oligoIds, ...before.oligoIds])),
	};
}

function resolvePartScope(part: Part, seed: Required<PartScopeSeed>) {
	const oligoIds = new Set(seed.oligoIds);
	const segmentIds = new Set(seed.segmentIds);
	const vhIndices = new Set(seed.vhIndices);

	for (const segmentId of seed.segmentIds) {
		const segment = part.getSegmentById(segmentId);
		if (!segment) continue;
		vhIndices.add(segment.inVirtualHelix.index);
		const oligo = part.getOligoBySegment(segment);
		if (oligo) oligoIds.add(oligo.id);
	}

	for (const oligoId of seed.oligoIds) {
		const oligo = part.getOligoById(oligoId);
		if (!oligo) continue;
		for (const segment of oligo.segments) {
			segmentIds.add(segment.id);
			vhIndices.add(segment.inVirtualHelix.index);
		}
	}

	return { oligoIds, segmentIds, vhIndices };
}

function expandSeedAfterMutation(
	part: Part,
	seed: Required<PartScopeSeed>,
	before: PartMemento
): Required<PartScopeSeed> {
	const vhIndices = new Set([...seed.vhIndices, ...before.virtualHelixIndices]);
	const oligoIds = new Set([...seed.oligoIds, ...before.oligoIds]);
	const segmentIds = new Set([...seed.segmentIds, ...before.segmentIds]);
	const beforeVhSegmentIds = new Set(
		before.virtualHelices.flatMap((vh) =>
			vh.strandSets.flatMap((strandSet) => strandSet.segmentIds)
		)
	);

	for (const vhIndex of vhIndices) {
		const vh = part.getVhByIndex(vhIndex);
		if (!vh) continue;
		for (const strandSet of vh.strandSets) {
			for (const segmentId of strandSet.segmentIds) {
				if (!beforeVhSegmentIds.has(segmentId)) {
					segmentIds.add(segmentId);
					const segment = part.getSegmentById(segmentId);
					const oligo = segment ? part.getOligoBySegment(segment) : null;
					if (oligo) oligoIds.add(oligo.id);
				}
			}
		}
	}

	for (const oligo of part.oligos) {
		for (const segment of oligo.segments) {
			if (segmentIds.has(segment.id)) {
				oligoIds.add(oligo.id);
				segmentIds.add(segment.id);
				vhIndices.add(segment.inVirtualHelix.index);
			}
		}
	}

	return {
		...seed,
		oligoIds: [...oligoIds],
		segmentIds: [...segmentIds],
		vhIndices: [...vhIndices],
	};
}

function applyPartMemento(part: Part, memento: PartMemento): void {
	const affectedOligoIds = new Set(memento.oligoIds);
	const affectedSegmentIds = new Set(memento.segmentIds);
	const affectedVhIndices = new Set(memento.virtualHelixIndices);
	const restoredVhByIndex = new Map(memento.virtualHelices.map((vh) => [vh.index, vh]));

	if (memento.regions) {
		part.regions = memento.regions.map((regionJson) =>
			DesignRegion.fromJSON(regionJson).attachToPart(part)
		);
	}

	for (const oligo of Array.from(part.oligos)) {
		const containsAffectedSegment = Array.from(oligo.segments).some((segment) =>
			affectedSegmentIds.has(segment.id)
		);
		if (!affectedOligoIds.has(oligo.id) && !containsAffectedSegment) continue;
		for (const segment of Array.from(oligo.segments)) {
			segment.destroy();
			part.unregisterSegment(segment);
		}
		oligo.segments.clear();
		part.oligos.delete(oligo);
	}

	for (const vhIndex of affectedVhIndices) {
		const vh = part.getVhByIndex(vhIndex);
		const vhSnapshot = restoredVhByIndex.get(vhIndex);

		if (!vh && vhSnapshot) {
			const restored = new VirtualHelix(
				part,
				vhSnapshot.index,
				vhSnapshot.listRow,
				vhSnapshot.length,
				vhSnapshot.latticeCoords?.row,
				vhSnapshot.latticeCoords?.col,
				vhSnapshot.id
			);
			restored.regionId = vhSnapshot.regionId;
			if (vhSnapshot.localFrame) {
				restored.localFrame = {
					origin: { ...vhSnapshot.localFrame.origin },
					axis: { ...vhSnapshot.localFrame.axis },
					radial0: { ...vhSnapshot.localFrame.radial0 },
				};
			}
			restored.strandSets = vhSnapshot.strandSets.map((ss) => {
				const strandSet = new StrandSet(restored, ss.strandIndex);
				strandSet.segmentIds = new SvelteSet<string>(ss.segmentIds);
				return strandSet;
			}) as typeof restored.strandSets;
			part.virtualHelices = [...part.virtualHelices, restored].sort(
				(a, b) => a.listRow - b.listRow
			);
			continue;
		}

		if (vh && !vhSnapshot) {
			part.virtualHelices = part.virtualHelices.filter((candidate) => candidate.index !== vhIndex);
			continue;
		}

		if (!vh || !vhSnapshot) continue;
		vh.listRow = vhSnapshot.listRow;
		vh.regionId = vhSnapshot.regionId;
		vh.latticeCoords = vhSnapshot.latticeCoords ? { ...vhSnapshot.latticeCoords } : undefined;
		vh.localFrame = vhSnapshot.localFrame
			? {
					origin: { ...vhSnapshot.localFrame.origin },
					axis: { ...vhSnapshot.localFrame.axis },
					radial0: { ...vhSnapshot.localFrame.radial0 },
				}
			: undefined;
		vh.length = vhSnapshot.length;
		vh.strandSets[0].segmentIds = new SvelteSet<string>(vhSnapshot.strandSets[0]?.segmentIds ?? []);
		vh.strandSets[1].segmentIds = new SvelteSet<string>(vhSnapshot.strandSets[1]?.segmentIds ?? []);
	}

	for (const oligoJson of memento.oligos) {
		const oligo = OligoClass.fromJSON(oligoJson, part);
		part.oligos.add(oligo);
	}

	const oligosById = new Map(Array.from(part.oligos).map((oligo) => [oligo.id, oligo]));
	const orderedOligos: Oligo[] = [];
	for (const oligoId of memento.oligoOrder) {
		const oligo = oligosById.get(oligoId);
		if (!oligo) continue;
		orderedOligos.push(oligo);
		oligosById.delete(oligoId);
	}
	orderedOligos.push(...oligosById.values());
	part.oligos = new SvelteSet<Oligo>(orderedOligos);

	if (memento.maxBase !== undefined) {
		const delta = memento.maxBase - part.maxBase;
		if (delta !== 0) part.increaseVhsLengthBy(delta);
	}
	if (memento.customModifications !== undefined) {
		part.customModifications = memento.customModifications;
	}

	for (const [vhIndex, vhSnapshot] of restoredVhByIndex) {
		const vh = part.getVhByIndex(vhIndex);
		if (vh) vh.listRow = vhSnapshot.listRow;
	}

	// Re-sort the VH array by restored listRow values and re-index.
	part.rebuildVhOrder();
	part.rebuildRspCaches();
}
