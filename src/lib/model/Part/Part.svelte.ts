import { v4 as uuidv4 } from 'uuid';
import Oligo, { type SegmentEnd } from '../Oligo';
import type OligoSegment from '../Oligo/OligoSegment.svelte';
import { mirroredSkipInsertSeq } from '../Oligo/OligoSegment.svelte';
import { cloneOligoJsonWithOffset } from '../Oligo/cloneOligoJson';
import type { VirtualHelixFrame } from '../geometry3d/dnaGeometry';
import { InvalidOperationError, OperationNotSupportedError } from '../../errors';

// import { type OligoSegment}  from '../Oligo';
import VirtualHelix from '../VirtualHelix';
import { SvelteSet } from 'svelte/reactivity';
import { SpatialIndexService } from './SpatialIndexService';
import { hashNameToColor, type ModificationDef } from '../modifications';
import { Plane, type PlaneVec3 } from './Plane.svelte';
import {
	DesignRegion,
	FreeformRegion,
	HoneycombRegion,
	LatticedDesignRegion,
	SquareRegion,
	type RegionKind,
} from './DesignRegion';

export interface NtIndices {
	vhIdx: number;
	rowIdx: number;
	strandIdx: 0 | 1;
	bpIdx: number;
}

/**
 * Remembered placement of one external-structure overlay instance. `id` is unique
 * per instance (so the same structure can be placed multiple times); `sourceKey`
 * (PDB accession, else filename) links instances of the same structure so they
 * rehydrate together when the file is re-dropped. Render-only metadata: it does
 * not affect the design and only the placement — never the geometry — is persisted.
 */
export interface OverlayPlacement {
	id: string;
	sourceKey: string;
	transform: {
		position: { x: number; y: number; z: number };
		quaternion: [number, number, number, number];
	};
}

export interface RspCoord {
	rowIdx: number;
	strandIdx: 0 | 1;
	bpIdx: number;
}

// type rspCoord = Pick<NtIndices, 'rowIdx' | 'strandIdx' | 'bpIdx'>;
export interface CrossoverSite {
	bpIdx: number;
	toVhIdx: number;
	right: boolean;
}

export type DuplicateCheck = { ok: true } | { ok: false; reason: string };

/** One placed copy of a repeat group. `vhMap` is reserved for lateral (VH→VH) repeats. */
export interface RepeatInstance {
	id: string;
	bpOffset: number;
	vhMap?: Record<string, string>;
}

/** A set of original oligos (`Oligo.repeatGroupId === id`) mirrored at each instance's
 * offset. See docs/repeat-units.md. */
export interface RepeatGroup {
	id: string;
	name: string;
	instances: RepeatInstance[];
}

export const MIRROR_EDIT_ERROR = "Mirror oligos can't be edited. Edit the original instead.";

export interface GridRange {
	startRowIdx: number;
	endRowIdx: number;
	strands: (0 | 1)[];
	startBpIdx: number;
	endBpIdx: number;
}

/**
 * A Part is a group of VirtualHelix items that are on the same lattice.
 * Parts are the model component that most directly corresponds to a
 * DNA origami design.
 * 
 * A part holds three types of information:
 * 
 * - The collection of VirtualHelices that make up the part
 * - The collection of Oligos that make up the part
 * - The lattice type and associated geometric parameters if there are any 
 *   (e.g. honeycomb, square, etc. and freeform with user-defined parameters)
 * 
 * Part is also the only model that can determine the relative position and adjacency of virtual helices.
 * 
 * Note: Oligos and VirtualHelices do not have back-references to their Part.
 * 
 * It is the **Part's job to manage its Oligos and VirtualHelices (creation and deletion)**.

	* from original cadnano documentation:
	* PartInstances are parented to either the document or an assembly
	* PartInstances know global position of the part
	* Copying a PartInstance only creates a new PartInstance with the same
	* Part(), with a mutable parent and position field.
	*/
export class Part {
	// Spatial indexing service for O(1) coordinate lookups
	private _spatialIndex = new SpatialIndexService();

	// O(1) listRow → VirtualHelix lookup; rebuilt in syncListRows()
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	private _vhByListRow = new Map<number, VirtualHelix>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	private _vhById = new Map<string, VirtualHelix>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	private _vhByIndex = new Map<number, VirtualHelix>();

	name: string = 'New_Part';
	readonly id: string;
	planes = $state<Plane[]>([]);
	regions = $state<DesignRegion[]>([]);

	oligos = $state<SvelteSet<Oligo>>(new SvelteSet());
	_virtualHelices = $state<VirtualHelix[]>([]);
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	segmentsLookup = new Map<string, OligoSegment>(new Map());

	customModifications: ModificationDef[] = $state([]);
	overlayPlacements = $state<OverlayPlacement[]>([]);
	repeatGroups = $state<RepeatGroup[]>([]);
	/** True only while `syncRepeatGroups` rewrites mirrors — the one writer allowed to. */
	_repeatSyncing = false;

	isAllScaffoldSequenceLocked = $derived.by(() => {
		for (const oligo of this.oligos) {
			if (oligo.isScaffold && !oligo.isMirror && !oligo.isSequenceLocked) return false;
		}
		return true;
	});

	constructor(name: string, id?: string) {
		this.id = id || uuidv4();
		this.name = name;
	}

	/** Oligos that are not mirrors — what exports and oligo lists should use. */
	get realOligos(): Oligo[] {
		return [...this.oligos].filter((oligo) => !oligo.isMirror);
	}

	getRepeatGroup(id: string): RepeatGroup | null {
		return this.repeatGroups.find((g) => g.id === id) ?? null;
	}

	private _assertNotMirrorEdit(...oligos: Oligo[]): void {
		if (!this._repeatSyncing && oligos.some((o) => o.isMirror)) {
			throw new InvalidOperationError(MIRROR_EDIT_ERROR);
		}
	}

	get hasScaffold(): boolean {
		for (const oligo of this.oligos) {
			if (oligo.isScaffold) return true;
		}
		return false;
	}

	// get isAllScaffoldSequenceLocked(): boolean {
	//   for (const oligo of this.oligos) {
	//     if (oligo.isScaffold && !oligo.isSequenceLocked) return false;
	//   }
	//   return true;
	// }

	registerSegment(segment: OligoSegment): void {
		if (this.segmentsLookup.has(segment.id)) {
			throw new Error(`Segment id ${segment.id} already exists in Part ${this.id}`);
		}
		this.segmentsLookup.set(segment.id, segment);
	}

	unregisterSegment(segment: OligoSegment): void {
		this.segmentsLookup.delete(segment.id);
	}

	getSegmentById(segmentId: string): OligoSegment | null {
		return this.segmentsLookup.get(segmentId) || null;
	}

	/** Every end across the design currently carrying the given modification name. */
	getEndsWithModification(name: string): SegmentEnd[] {
		const ends: SegmentEnd[] = [];
		for (const oligo of this.oligos) {
			for (const end of oligo.allEnds) {
				if (end.modification === name) ends.push(end);
			}
		}
		return ends;
	}

	getOligoById(oligoId: string): Oligo | null {
		for (const oligo of this.oligos) {
			if (oligo.id === oligoId) {
				return oligo;
			}
		}
		return null;
	}

	// --- RSP cache helpers (delegated to SpatialIndexService) ---
	private _cacheSegmentRange(oligo: Oligo, segment: OligoSegment): void {
		this._spatialIndex.cacheSegmentRange(oligo, segment);
	}

	private _uncacheSegmentRange(segment: OligoSegment): void {
		this._spatialIndex.uncacheSegmentRange(segment);
	}

	private _cacheOligo(oligo: Oligo): void {
		this._spatialIndex.cacheOligo(oligo);
	}

	private _uncacheOligo(oligo: Oligo): void {
		this._spatialIndex.uncacheOligo(oligo);
	}

	rebuildRspCaches(): void {
		this._spatialIndex.rebuildFromOligos(this.oligos);
	}

	syncListRows(): void {
		this._vhByListRow.clear();
		this._vhById.clear();
		this._vhByIndex.clear();

		for (const vh of this._virtualHelices) {
			this._vhById.set(vh.id, vh);
			this._vhByIndex.set(vh.index, vh);
		}

		// Assign listRow by region order. region.vhOrder is authoritative for region membership.
		// VHs not present in any region.vhOrder are appended at the end (defensive — should not
		// happen for a well-constructed Part).
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const assignedIds = new Set<string>();
		let listRow = 0;

		for (const region of this.regions) {
			for (const vhId of region.vhOrder) {
				const vh = this._vhById.get(vhId);
				if (!vh) continue;
				vh.listRow = listRow;
				this._vhByListRow.set(listRow++, vh);
				assignedIds.add(vh.id);
			}
		}

		for (const vh of this._virtualHelices) {
			if (assignedIds.has(vh.id)) continue;
			vh.listRow = listRow;
			this._vhByListRow.set(listRow++, vh);
		}
	}

	getVhByListRow(row: number): VirtualHelix | null {
		return this._vhByListRow.get(row) ?? null;
	}

	/** Reorders the VH array and syncs listRow to match array position. */
	reorderVirtualHelix(draggedVhIdx: number, newListRow: number): void {
		const oldListRow = this._virtualHelices.findIndex((vh) => vh.index === draggedVhIdx);
		if (oldListRow === -1 || oldListRow === newListRow) return;
		const [moved] = this._virtualHelices.splice(oldListRow, 1);
		this._virtualHelices.splice(newListRow, 0, moved);
		for (const region of this.regions) {
			const memberIds = this._virtualHelices
				.filter((vh) => vh.regionId === region.id)
				.map((vh) => vh.id);
			// eslint-disable-next-line svelte/prefer-svelte-reactivity
			const memberSet = new Set(memberIds);
			const preserved = region.vhOrder.filter((vhId) => !memberSet.has(vhId));
			region.vhOrder = [...memberIds, ...preserved];
		}
		this.syncListRows();
	}

	reorderVirtualHelixInRegion(draggedVhIdx: number, targetRegionRow: number): void {
		const vh = this.getVhByIndex(draggedVhIdx);
		if (!vh || !vh.regionId) return;
		const region = this.getRegionById(vh.regionId);
		if (!region) return;

		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const inRegion = new Map(
			this._virtualHelices.filter((vh) => vh.regionId === region.id).map((vh) => [vh.id, vh])
		);
		const memberIds = [
			...region.vhOrder.filter((id) => inRegion.has(id)),
			...[...inRegion.values()].filter((v) => !region.vhOrder.includes(v.id)).map((v) => v.id),
		];
		const currentRegionRow = memberIds.indexOf(vh.id);
		if (currentRegionRow === -1) return;

		const clampedTarget = Math.max(0, Math.min(memberIds.length - 1, targetRegionRow));
		if (clampedTarget === currentRegionRow) return;

		const reordered = [...memberIds];
		reordered.splice(currentRegionRow, 1);
		reordered.splice(clampedTarget, 0, vh.id);

		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const regionMemberSet = new Set(memberIds);
		const preserved = region.vhOrder.filter((vhId) => !regionMemberSet.has(vhId));
		region.vhOrder = [...reordered, ...preserved];
		this.syncListRows();
	}

	/** Sorts the VH array by current listRow values, then re-indexes. Used by history restore. */
	rebuildVhOrder(): void {
		this._virtualHelices.sort((a, b) => a.listRow - b.listRow);
		this.syncListRows();
	}

	// --- END RSP cache helpers ---

	getVirtualHelixFrame(vh: VirtualHelix): VirtualHelixFrame {
		return this.getRegionForVh(vh).getVirtualHelixFrame(vh);
	}

	toJSON() {
		return {
			name: this.name,
			id: this.id,
			planes: this.planes.map((plane) => plane.toJSON()),
			regions: this.regions.map((region) => region.toJSON()),
			oligos: Array.from(this.oligos).map((oligo) => oligo.toJSON()),
			virtualHelices: this.virtualHelices.map((vh) => vh.toJSON()),
			customModifications:
				this.customModifications.length > 0 ? this.customModifications : undefined,
			overlayPlacements: this.overlayPlacements.length > 0 ? this.overlayPlacements : undefined,
			repeatGroups:
				this.repeatGroups.length > 0
					? this.repeatGroups.map((g) => ({
							...g,
							instances: g.instances.map((i) => ({ ...i })),
						}))
					: undefined,
		};
	}

	static forType(
		type: 'HONEYCOMB' | 'SQUARE' | 'FREEFORM',
		name: string,
		id?: string,
		maxBase?: number,
		options?: { step?: number }
	): Part {
		const part = new Part(name, id);
		part.initializeDefaultPlaneAndRegion(type, { maxBase, step: options?.step });
		return part;
	}

	static fromJSON(json: ReturnType<Part['toJSON']>): Part {
		if (!json.planes || !json.regions || !json.virtualHelices) {
			throw new Error('Document predates region schema; not supported');
		}

		const part = new Part(json.name, json.id);

		part.planes = json.planes.map((planeJson) => Plane.fromJSON(planeJson));
		part.regions = json.regions.map((regionJson) =>
			DesignRegion.fromJSON(regionJson).attachToPart(part)
		);

		const vhs = json.virtualHelices.map((vhJson) => VirtualHelix.fromJSON(vhJson, part));
		part.virtualHelices = vhs;

		for (const oligoJson of json.oligos) {
			const oligo = Oligo.fromJSON(oligoJson, part);
			part.oligos.add(oligo);
		}
		if (json.customModifications) {
			// Backfill `.color` for documents saved before modifications had colors
			// (they only had `.symbol`) — deterministic, so it's stable across reloads.
			part.customModifications = json.customModifications.map((m) => {
				const legacy = m as Partial<ModificationDef> & { name: string };
				return { name: legacy.name, color: legacy.color ?? hashNameToColor(legacy.name) };
			});
		}
		if (json.overlayPlacements) {
			// Pre-duplicate files stored one placement per structure with `id` as the
			// key; default `sourceKey` to `id` so they still rehydrate.
			part.overlayPlacements = json.overlayPlacements.map((p) => ({
				id: p.id,
				sourceKey: p.sourceKey ?? p.id,
				transform: p.transform,
			}));
		}
		if (json.repeatGroups) part.repeatGroups = json.repeatGroups;
		part.rebuildRspCaches();
		part.normalizeVhLengthsToRegion();
		return part;
	}

	get virtualHelices(): readonly VirtualHelix[] {
		return this._virtualHelices;
	}

	set virtualHelices(vhs: VirtualHelix[]) {
		vhs.forEach((vh) => {
			vh.inPart = this;
		});
		this._virtualHelices = vhs;
		this.syncListRows();
	}

	get subStepSize(): number {
		return this.getDefaultRegion().subStepSize;
	}

	get maxBase(): number {
		return this.getDefaultRegion().maxBase;
	}

	get step(): number {
		return this.getDefaultRegion().step;
	}

	protected _createDefaultPlane(): Plane {
		return new Plane(this.nextPlaneName());
	}

	nextRegionName(kind: RegionKind): string {
		const prefix = `${kind} Region `;
		const trailingNumber = / (\d+)$/;
		let max = 0;
		for (const r of this.regions) {
			if (r.kind !== kind) continue;
			const m = r.name.match(trailingNumber);
			if (m) max = Math.max(max, parseInt(m[1], 10));
		}
		return `${prefix}${max + 1}`;
	}

	nextPlaneName(): string {
		const prefix = 'Plane ';
		const trailingNumber = / (\d+)$/;
		let max = 0;
		for (const p of this.planes) {
			const m = p.name.match(trailingNumber);
			if (m) max = Math.max(max, parseInt(m[1], 10));
		}
		return `${prefix}${max + 1}`;
	}

	protected _createDefaultRegion(
		kind: RegionKind,
		planeId: string,
		opts?: { step?: number; maxBase?: number }
	): DesignRegion {
		const vhOrder = this._virtualHelices.map((vh) => vh.id);
		const name = this.nextRegionName(kind);
		const stepOverride = opts?.step;
		const maxBaseOverride = opts?.maxBase;

		switch (kind) {
			case 'FREEFORM': {
				const step = stepOverride;
				const subStepSize = stepOverride !== undefined ? Math.floor(stepOverride / 3) : undefined;
				return new FreeformRegion(
					name,
					planeId,
					undefined,
					vhOrder,
					step,
					undefined,
					subStepSize,
					undefined,
					maxBaseOverride
				);
			}
			case 'SQUARE':
				return new SquareRegion(
					name,
					planeId,
					undefined,
					vhOrder,
					undefined,
					undefined,
					undefined,
					undefined,
					maxBaseOverride
				);
			case 'HONEYCOMB':
			default:
				return new HoneycombRegion(
					name,
					planeId,
					undefined,
					vhOrder,
					undefined,
					undefined,
					undefined,
					undefined,
					maxBaseOverride
				);
		}
	}

	initializeDefaultPlaneAndRegion(
		kind: RegionKind,
		opts?: { step?: number; maxBase?: number }
	): void {
		if (this.planes.length > 0 || this.regions.length > 0) return;
		const plane = this._createDefaultPlane();
		const region = this._createDefaultRegion(kind, plane.id, opts).attachToPart(this);
		this.planes = [plane];
		this.regions = [region];
		// Bind any pre-existing VHs to the new default region.
		for (const vh of this._virtualHelices) {
			if (vh.regionId == null) vh.regionId = region.id;
		}
		if (region.vhOrder.length === 0) {
			region.vhOrder = this._virtualHelices.map((vh) => vh.id);
		}
		this.syncListRows();
	}

	getPlaneById(id: string): Plane | null {
		return this.planes.find((plane) => plane.id === id) ?? null;
	}

	getOverlayPlacement(id: string): OverlayPlacement | undefined {
		return this.overlayPlacements.find((p) => p.id === id);
	}

	/** All saved placements of one structure (used to rehydrate duplicates on load). */
	getOverlayPlacementsForSource(sourceKey: string): OverlayPlacement[] {
		return this.overlayPlacements.filter((p) => p.sourceKey === sourceKey);
	}

	setOverlayPlacement(
		id: string,
		sourceKey: string,
		transform: OverlayPlacement['transform']
	): void {
		const clone: OverlayPlacement = {
			id,
			sourceKey,
			transform: {
				position: { ...transform.position },
				quaternion: [...transform.quaternion] as [number, number, number, number],
			},
		};
		// Replace the array so the change is reactive (and tracked by effects).
		this.overlayPlacements = [...this.overlayPlacements.filter((p) => p.id !== id), clone];
	}

	clearOverlayPlacement(id: string): void {
		this.overlayPlacements = this.overlayPlacements.filter((p) => p.id !== id);
	}

	addPlane(plane: Plane): void {
		this.planes.push(plane);
	}

	removePlane(planeId: string): void {
		const idx = this.planes.findIndex((p) => p.id === planeId);
		if (idx >= 0) this.planes.splice(idx, 1);
	}

	addRegion(region: DesignRegion): void {
		region.attachToPart(this);
		this.regions.push(region);
		this.syncListRows();
	}

	insertRegionAfter(afterRegionId: string, region: DesignRegion): void {
		region.attachToPart(this);
		const idx = this.regions.findIndex((r) => r.id === afterRegionId);
		this.regions.splice(idx + 1, 0, region);
		this.syncListRows();
	}

	removeRegion(regionId: string): void {
		const hasVhs = this._virtualHelices.some((vh) => vh.regionId === regionId);
		if (hasVhs) throw new Error(`Cannot remove region ${regionId}: it still has virtual helices`);
		const idx = this.regions.findIndex((r) => r.id === regionId);
		if (idx >= 0) this.regions.splice(idx, 1);
	}

	setPlaneTransform(
		planeId: string,
		t: { origin: PlaneVec3; u: PlaneVec3; v: PlaneVec3; normal: PlaneVec3 }
	): void {
		const plane = this.getPlaneById(planeId);
		if (!plane) return;
		plane.origin = { ...t.origin };
		plane.u = { ...t.u };
		plane.v = { ...t.v };
		plane.normal = { ...t.normal };
	}

	getRegionById(id: string): DesignRegion | null {
		return this.regions.find((region) => region.id === id) ?? null;
	}

	getDefaultPlane(): Plane {
		const plane = this.planes[0];
		if (!plane) throw new Error(`Part ${this.id} has no planes`);
		return plane;
	}

	getDefaultRegion(): DesignRegion {
		const region = this.regions[0];
		if (!region) throw new Error(`Part ${this.id} has no regions`);
		return region;
	}

	getRegionForVh(vh: VirtualHelix): DesignRegion {
		const region = vh.regionId ? this.getRegionById(vh.regionId) : null;
		if (region) return region;
		const fallback = this.regions.length === 1 ? this.regions[0] : null;
		if (fallback) {
			vh.regionId = fallback.id;
			return fallback;
		}
		throw new Error(`Part ${this.id} has no region for VH ${vh.index}`);
	}

	getVhById(vhId: string): VirtualHelix | null {
		return this._vhById.get(vhId) ?? null;
	}

	addOligosFromArray(oligoArray: Oligo[]): void {
		for (const oligo of oligoArray) {
			this.oligos.add(oligo);
			this._cacheOligo(oligo);
		}
	}

	getEntitiesAtVh(
		vhId: string,
		strandIdx: 0 | 1,
		bpIndex: number
	): {
		vh: VirtualHelix | null;
		oligo: Oligo | null;
		segment: OligoSegment | null;
		end: SegmentEnd | null;
	} {
		const vh = this.getVhById(vhId);
		if (!vh) {
			return { vh: null, oligo: null, segment: null, end: null };
		}

		const segment = this._spatialIndex.getSegmentAt(vhId, strandIdx, bpIndex);
		let oligo: Oligo | null = null;
		if (segment) {
			oligo = this._spatialIndex.getOligoBySegmentId(segment.id) || this.getOligoBySegment(segment);
			if (oligo) this._spatialIndex.setOligoForSegment(segment.id, oligo);
		}
		const endsAt = this._spatialIndex.getEndsAt(vhId, strandIdx, bpIndex);
		const end = segment
			? endsAt.find((candidate) => candidate.segment === segment) || null
			: endsAt[0] || null;

		return { vh, oligo, segment, end };
	}

	getEntitiesAt(
		vhRow: number,
		strandIdx: 0 | 1,
		bpIndex: number
	): {
		vh: VirtualHelix | null;
		oligo: Oligo | null;
		segment: OligoSegment | null;
		end: SegmentEnd | null;
	} {
		const vh = this.getVhByListRow(vhRow);
		if (!vh) {
			return { vh: null, oligo: null, segment: null, end: null };
		}
		return this.getEntitiesAtVh(vh.id, strandIdx, bpIndex);
	}

	getOligoByVh(vhId: string, strandIdx: 0 | 1, bpIndex: number) {
		const { oligo, segment } = this.getEntitiesAtVh(vhId, strandIdx, bpIndex);
		return oligo && segment ? { oligo, segment } : null;
	}

	getOligoByIndices(vhRow: number, strandIdx: 0 | 1, bpIndex: number) {
		const vh = this.getVhByListRow(vhRow);
		return vh ? this.getOligoByVh(vh.id, strandIdx, bpIndex) : null;
	}

	getOligoBySegment(segment: OligoSegment): Oligo | null {
		for (const oligo of this.oligos) {
			if (oligo.segments.has(segment)) {
				return oligo;
			}
		}
		return null;
	}

	getVhByIndex(vhIndex: number): VirtualHelix | null {
		return this._vhByIndex.get(vhIndex) ?? null;
	}

	getVhIdxByListRow(row: number): number | null {
		return this.getVhByListRow(row)?.index ?? null;
	}

	queryEntitiesInVhRange(
		vhIds: string[],
		strands: (0 | 1)[],
		startBpIdx: number,
		endBpIdx: number
	): Array<{
		segment: OligoSegment;
		oligo: Oligo | null;
		fivePrimeInRange: boolean;
		threePrimeInRange: boolean;
	}> {
		const results: Array<{
			segment: OligoSegment;
			oligo: Oligo | null;
			fivePrimeInRange: boolean;
			threePrimeInRange: boolean;
		}> = [];
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const seenSegmentIds = new Set<string>();

		for (const vhId of vhIds) {
			const vh = this.getVhById(vhId);
			if (!vh) continue;

			for (const strandIdx of strands) {
				const strandSet = vh.strandSets[strandIdx];
				for (const segId of strandSet.segmentIds) {
					if (seenSegmentIds.has(segId)) continue;
					const segment = this.segmentsLookup.get(segId);
					if (!segment) continue;

					const minBp = Math.min(segment.fivePrime.index, segment.threePrime.index);
					const maxBp = Math.max(segment.fivePrime.index, segment.threePrime.index);
					if (maxBp < startBpIdx || minBp > endBpIdx) continue;

					seenSegmentIds.add(segId);

					let oligo = this._spatialIndex.getOligoBySegmentId(segId);
					if (!oligo) {
						oligo = this.getOligoBySegment(segment);
						if (oligo) this._spatialIndex.setOligoForSegment(segId, oligo);
					}

					results.push({
						segment,
						oligo,
						fivePrimeInRange:
							segment.fivePrime.index >= startBpIdx && segment.fivePrime.index <= endBpIdx,
						threePrimeInRange:
							segment.threePrime.index >= startBpIdx && segment.threePrime.index <= endBpIdx,
					});
				}
			}
		}

		return results;
	}

	queryEntitiesInGridRange(range: GridRange): Array<{
		segment: OligoSegment;
		oligo: Oligo | null;
		fivePrimeInRange: boolean;
		threePrimeInRange: boolean;
	}> {
		const vhIds = this._virtualHelices
			.filter((vh) => vh.listRow >= range.startRowIdx && vh.listRow <= range.endRowIdx)
			.map((vh) => vh.id);
		return this.queryEntitiesInVhRange(
			vhIds,
			range.strands as (0 | 1)[],
			range.startBpIdx,
			range.endBpIdx
		);
	}

	getEndsInVhRange(
		vhIds: string[],
		strands: (0 | 1)[],
		startBpIdx: number,
		endBpIdx: number,
		onlyFreeEnds: boolean
	): SegmentEnd[] {
		const endsInRange: SegmentEnd[] = [];
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const vhIdSet = new Set(vhIds);
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const strandSet = new Set(strands);

		for (const oligo of this.oligos) {
			for (const segment of oligo.segments) {
				if (!vhIdSet.has(segment.inVirtualHelix.id)) continue;
				if (!strandSet.has(segment.inStrandIndex)) continue;

				if (
					segment.fivePrime.index >= startBpIdx &&
					segment.fivePrime.index <= endBpIdx &&
					(!onlyFreeEnds || segment.fivePrime.isFree)
				) {
					endsInRange.push(segment.fivePrime);
				}
				if (
					segment.threePrime.index >= startBpIdx &&
					segment.threePrime.index <= endBpIdx &&
					(!onlyFreeEnds || segment.threePrime.isFree)
				) {
					endsInRange.push(segment.threePrime);
				}
			}
		}

		return endsInRange;
	}

	getEndsInRange(
		selectRange: {
			startVhRow: number;
			startStrandIdx: 0 | 1;
			endVhRow: number;
			endStrandIdx: 0 | 1;
			startBpIdx: number;
			endBpIdx: number;
		},
		onlyFreeEnds: boolean
	): SegmentEnd[] {
		const endsInRange: SegmentEnd[] = [];
		for (let row = selectRange.startVhRow; row <= selectRange.endVhRow; row++) {
			const vh = this.getVhByListRow(row);
			if (!vh) continue;

			const strands = ([0, 1] as const).filter((strandIdx) => {
				if (row === selectRange.startVhRow && strandIdx < selectRange.startStrandIdx) return false;
				if (row === selectRange.endVhRow && strandIdx > selectRange.endStrandIdx) return false;
				return true;
			});

			endsInRange.push(
				...this.getEndsInVhRange(
					[vh.id],
					strands,
					selectRange.startBpIdx,
					selectRange.endBpIdx,
					onlyFreeEnds
				)
			);
		}
		return endsInRange;
	}

	getMaxUsedLengthAcrossAllVhs(): number {
		let maxLength = 0;
		for (const vh of this.virtualHelices) {
			if (vh.usedLength > maxLength) {
				maxLength = vh.usedLength;
			}
		}
		return maxLength;
	}

	getLatticedRegions(): LatticedDesignRegion[] {
		return this.regions.filter((r): r is LatticedDesignRegion => r instanceof LatticedDesignRegion);
	}

	/**
	 * Each VH's length should equal its region's maxBase. Older documents
	 * (and any path that called Part.addVirtualHelix() directly) sized VHs against
	 * the default region's length, which can disagree with a non-default region's
	 * own bounds. Walk all VHs and fix them up in place. Only grows length —
	 * shrinking would silently truncate occupied strands.
	 */
	normalizeVhLengthsToRegion(): void {
		for (const vh of this._virtualHelices) {
			const region = vh.regionId ? this.getRegionById(vh.regionId) : null;
			if (!region) continue;
			if (vh.length === region.maxBase) continue;
			if (vh.length > region.maxBase) {
				// VH is wider than its region claims — extend the region to match
				// (rounded up to a step boundary) so existing strands stay valid.
				const delta = vh.length - region.maxBase;
				const stepRounded = Math.ceil(delta / region.step) * region.step;
				region.maxBase += stepRounded;
			} else {
				vh.length = region.maxBase;
			}
		}
	}

	autoStaple(): void {
		for (const region of this.regions) {
			if (region instanceof LatticedDesignRegion) region.autoStaple();
		}
	}

	autoStapleRegion(regionId: string): void {
		const region = this.getRegionById(regionId);
		if (!region) throw new Error(`Region ${regionId} not found`);
		if (!(region instanceof LatticedDesignRegion)) {
			throw new Error(
				`Region ${region.name} is not a lattice region; autoStaple requires lattice.`
			);
		}
		region.autoStaple();
	}

	adjacentVhs(_vh: VirtualHelix): VirtualHelix[] {
		return this.getRegionForVh(_vh).adjacentVhs(_vh);
	}

	areVhsAdjacent(vh1: VirtualHelix, vh2: VirtualHelix): boolean {
		return this.adjacentVhs(vh1).includes(vh2);
	}

	potentialXoverSites(_vhIdx: number): CrossoverSite[][] {
		const vh = this.getVhByIndex(_vhIdx);
		if (!vh) return [[], []];
		return this.getRegionForVh(vh).potentialXoverSites(_vhIdx);
	}

	isConnectionConstrained(ntA: Omit<NtIndices, 'rowIdx'>, ntB: Omit<NtIndices, 'rowIdx'>): boolean {
		if (ntA.strandIdx === ntB.strandIdx) return false; // same strandSet, no constraint
		if (ntA.bpIdx !== ntB.bpIdx) return false; // must be at same bpIdx
		// const vhA = this.getVhByIndex(ntA.vhIdx);
		// if(!vhA) return false;
		const potentialXoverSites = this.potentialXoverSites(ntA.vhIdx);
		if (!potentialXoverSites || potentialXoverSites.length === 0) return false;

		const strandIndexA = ntA.strandIdx;
		const sitesA = potentialXoverSites[strandIndexA];
		for (const site of sitesA) {
			if (site.bpIdx === ntA.bpIdx && site.toVhIdx === ntB.vhIdx) {
				return true; // found a valid crossover site
			}
		}
		return false;
	}

	canEndsBeConstrained(endA: SegmentEnd, endB: SegmentEnd): boolean {
		// first check if they are connected
		const isConnected =
			endA.connectedSegment === endB.segment && endB.connectedSegment === endA.segment;
		if (!isConnected) return false;
		//

		// check if the connection sites are constrained
		const ntA: NtIndices = endA.ntIndices;
		const ntB: NtIndices = endB.ntIndices;
		return this.isConnectionConstrained(ntA, ntB);
	}

	getConnectedEnd(end: SegmentEnd): { otherEnd: SegmentEnd; isConstrained: boolean } | null {
		if (!end.connectedSegment) return null;

		const otherEnd = end.isThreePrime
			? end.connectedSegment?.fivePrime
			: end.connectedSegment?.threePrime;
		if (!otherEnd) return null;

		const ntA: NtIndices = end.ntIndices;
		const ntB: NtIndices = otherEnd.ntIndices;
		const isConnectionConstrained = this.isConnectionConstrained(ntA, ntB);

		return {
			otherEnd: otherEnd || null,
			isConstrained: isConnectionConstrained,
		};
	}

	// mutations to the part -- adding/removing virtual helices, oligos, crossovers, etc.

	protected nextAvailableVhIndex(): number {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const used = new Set(this._virtualHelices.map((vh) => vh.index));
		let i = 0;
		while (used.has(i)) i++;
		return i;
	}

	addVirtualHelix(params?: { index?: number; id?: string }): VirtualHelix {
		if (params?.id && this.getVhById(params.id)) {
			throw new Error(`VirtualHelix id ${params.id} already exists in Part ${this.id}`);
		}
		const index = params?.index ?? this.nextAvailableVhIndex();
		const newVh = new VirtualHelix(
			this,
			index,
			this._virtualHelices.length,
			this.maxBase,
			undefined,
			undefined,
			params?.id
		);
		if (this.regions.length === 1) newVh.regionId = this.regions[0].id;
		this._virtualHelices.push(newVh);
		this.syncListRows();
		return newVh;
	}

	increaseVhsLengthBy(deltaLength: number): void {
		const region = this.getDefaultRegion();
		region.increaseVhsLengthBy(deltaLength);
	}

	createOligo(
		vh: VirtualHelix,
		fivePrimeEndIndex: number,
		threePrimeEndIndex: number,
		color?: string,
		opts?: { oligoId?: string; segmentId?: string }
	): Oligo {
		if (opts?.oligoId && this.getOligoById(opts.oligoId)) {
			throw new Error(`Oligo id ${opts.oligoId} already exists in Part ${this.id}`);
		}
		if (opts?.segmentId && this.getSegmentById(opts.segmentId)) {
			throw new Error(`Segment id ${opts.segmentId} already exists in Part ${this.id}`);
		}
		//check if the space is occupied
		const strandSetIndex = fivePrimeEndIndex < threePrimeEndIndex ? 0 : 1;
		const isSpaceOccupied = vh.strandSets[strandSetIndex].isRangeOccupied(
			fivePrimeEndIndex,
			threePrimeEndIndex
		);
		if (isSpaceOccupied) {
			throw new Error('Cannot create Oligo: space occupied in VirtualHelix StrandSet');
		}
		// check if indices are within bounds (using the VH's own region)
		const region = this.getRegionForVh(vh);
		const { minBase, maxBase } = region;
		if (
			fivePrimeEndIndex < minBase ||
			fivePrimeEndIndex >= maxBase ||
			threePrimeEndIndex < minBase ||
			threePrimeEndIndex >= maxBase
		) {
			throw new Error(
				`Cannot create Oligo: indices must be within bounds (${minBase}-${maxBase - 1})`
			);
		}

		const newOligo = Oligo.createNewOligo(
			this,
			vh,
			fivePrimeEndIndex,
			threePrimeEndIndex,
			color,
			opts?.oligoId,
			opts?.segmentId
		);
		this.oligos.add(newOligo);
		this._cacheOligo(newOligo);
		return newOligo;
	}

	fillEmptyStrandSet(vh: VirtualHelix, strandSetIndex: 0 | 1, color?: string): Oligo | null {
		const strandSet = vh.strandSets[strandSetIndex];
		const isStrandSetEmpty = strandSet.isEmpty;
		if (!isStrandSetEmpty) throw new Error('StrandSet is not empty.');
		// Use the VH's own region as the bounding source. vh.length can exceed
		// the region's maxBase in legacy/multi-region cases (e.g. a VH inherited
		// the part's default-region length); clamping here keeps fill inside
		// Part.createOligo's bounds check.
		const region = this.getRegionForVh(vh);
		const startIdx = region.minBase;
		const endIdx = Math.min(vh.length, region.maxBase) - 1;
		if (endIdx <= startIdx) return null;
		const fivePrimeEndIndex = strandSetIndex === 0 ? startIdx : endIdx;
		const threePrimeEndIndex = strandSetIndex === 0 ? endIdx : startIdx;

		const newOligo = this.createOligo(vh, fivePrimeEndIndex, threePrimeEndIndex, color);
		return newOligo;
	}

	removeOligo(oligo: Oligo): void {
		// first make sure the oligo is in this part
		if (!this.oligos.has(oligo)) {
			throw new Error('Oligo must be part of this Part to remove it.');
		}
		this._assertNotMirrorEdit(oligo);
		//destroy (remove from VHs) remove all segmemts in this oligo
		this._uncacheOligo(oligo);
		const segmentIds = Array.from(oligo.segments, (segment) => segment.id);
		oligo.destroy();
		for (const segmentId of segmentIds) {
			this.segmentsLookup.delete(segmentId);
		}

		// remove oligo from this part's oligo list
		this.oligos.delete(oligo);
	}

	private _connectedComponents(segments: OligoSegment[]): OligoSegment[][] {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const remaining = new Set(segments);
		const components: OligoSegment[][] = [];

		while (remaining.size > 0) {
			const start = remaining.values().next().value!;
			const stack = [start];
			const component: OligoSegment[] = [];
			remaining.delete(start);

			while (stack.length > 0) {
				const segment = stack.pop()!;
				component.push(segment);
				for (const connected of [
					segment.fivePrime.connectedSegment,
					segment.threePrime.connectedSegment,
				]) {
					if (!connected || !remaining.has(connected)) continue;
					remaining.delete(connected);
					stack.push(connected);
				}
			}

			components.push(component);
		}

		return components;
	}

	removeVirtualHelicesByIndex(vhIndices: Iterable<number>): void {
		const selectedVhIndices = new SvelteSet(vhIndices);
		if (selectedVhIndices.size === 0) return;
		const selectedVhIds = new SvelteSet(
			this.virtualHelices.filter((vh) => selectedVhIndices.has(vh.index)).map((vh) => vh.id)
		);

		const selectedSegments = new SvelteSet<OligoSegment>();
		for (const vh of this.virtualHelices) {
			if (!selectedVhIndices.has(vh.index)) continue;
			for (const strandSet of vh.strandSets) {
				for (const segmentId of strandSet.segmentIds) {
					const segment = this.getSegmentById(segmentId);
					if (segment) selectedSegments.add(segment);
				}
			}
		}

		const affectedOligos = new SvelteSet<Oligo>();
		for (const segment of selectedSegments) {
			const oligo = segment.oligo;
			if (oligo) affectedOligos.add(oligo);
			for (const connected of [
				segment.fivePrime.connectedSegment,
				segment.threePrime.connectedSegment,
			]) {
				const connectedOligo = connected?.oligo;
				if (connectedOligo) affectedOligos.add(connectedOligo);
			}
		}

		for (const oligo of affectedOligos) {
			this._uncacheOligo(oligo);
		}

		for (const segment of selectedSegments) {
			const connectedFivePrime = segment.fivePrime.connectedEnd;
			if (connectedFivePrime) connectedFivePrime.isConstrained = false;
			segment.fivePrime.disconnect();

			const connectedThreePrime = segment.threePrime.connectedEnd;
			if (connectedThreePrime) connectedThreePrime.isConstrained = false;
			segment.threePrime.disconnect();
		}

		for (const oligo of affectedOligos) {
			const originalSegments = Array.from(oligo.segments);
			const remainingSegments = originalSegments.filter(
				(segment) => !selectedSegments.has(segment)
			);

			for (const segment of originalSegments) {
				if (!selectedSegments.has(segment)) continue;
				oligo.segments.delete(segment);
				segment.destroy();
				this.segmentsLookup.delete(segment.id);
			}

			if (remainingSegments.length === 0) {
				this.oligos.delete(oligo);
				continue;
			}

			const components = this._connectedComponents(remainingSegments);
			const [firstComponent, ...extraComponents] = components;
			oligo.segments = new SvelteSet(firstComponent);
			this._cacheOligo(oligo);

			for (const component of extraComponents) {
				const splitOligo = new Oligo(this, undefined, undefined, oligo.color);
				splitOligo.isScaffold = oligo.isScaffold;
				splitOligo.isSequenceLocked = oligo.isSequenceLocked;
				splitOligo.name = oligo.name;
				splitOligo.repeatGroupId = oligo.repeatGroupId;
				splitOligo.mirrorOf = oligo.mirrorOf;
				splitOligo.segments = new SvelteSet(component);
				this.oligos.add(splitOligo);
				this._cacheOligo(splitOligo);
			}
		}

		for (const segment of selectedSegments) {
			if (!this.segmentsLookup.has(segment.id)) continue;
			segment.destroy();
			this.segmentsLookup.delete(segment.id);
		}

		for (const region of this.regions) {
			region.vhOrder = region.vhOrder.filter((vhId) => !selectedVhIds.has(vhId));
		}

		this.virtualHelices = this.virtualHelices.filter((vh) => !selectedVhIndices.has(vh.index));
		this.rebuildVhOrder();
		this.rebuildRspCaches();
	}

	connectTwoOligos(oligo_from3end: Oligo, oligo_to5end: Oligo): void {
		// note: it has to be oligoA's 3' end to oligoB's 5' end
		const oligoA = oligo_from3end;
		const oligoB = oligo_to5end;

		// first make sure both oligos are in this part
		if (!this.oligos.has(oligoA) || !this.oligos.has(oligoB)) {
			throw new Error('Both oligos must be part of this Part to connect them.');
		}
		this._assertNotMirrorEdit(oligoA, oligoB);
		if (
			oligoA.repeatGroupId &&
			oligoB.repeatGroupId &&
			oligoA.repeatGroupId !== oligoB.repeatGroupId
		) {
			throw new InvalidOperationError("Can't join oligos from two different repeat groups.");
		}
		// A group original absorbing an ungrouped oligo keeps it in the group (and vice versa).
		oligoA.repeatGroupId ??= oligoB.repeatGroupId;

		try {
			// Localized cache updates: uncache changed oligos first.
			this._uncacheOligo(oligoA);
			if (oligoA !== oligoB) this._uncacheOligo(oligoB);

			oligoA.connectOligos(oligoB);

			if (oligoA !== oligoB) {
				// remove oligoB from this part's oligo list
				oligoB.destroy();

				this.oligos.delete(oligoB);
			}
			// Re-cache resulting oligo topology.
			this._cacheOligo(oligoA);
		} catch (error) {
			throw new Error(`Failed to connect oligos: ${(error as Error).message}`);
		}
	}

	/**
	 * Connect a specific segment's 3' end to another segment's 5' end.
	 *
	 * Unlike `connectTwoOligos`, this honours segment-level intent: the
	 * connection is made between the two specified ends (which must be free).
	 * If those ends are already occupied, `SegmentEnd.connectTo` throws —
	 * surfacing the conflict instead of silently joining the oligo-global ends.
	 *
	 * Used by the `foldnano_mini` op replayer for `connect`. For terminal
	 * segments the result is identical to `connectTwoOligos`.
	 */
	connectSegmentEnds(fromSeg: OligoSegment, toSeg: OligoSegment): void {
		const fromOligo = fromSeg.oligo;
		const toOligo = toSeg.oligo;
		if (!fromOligo || !toOligo) {
			throw new Error('connectSegmentEnds: segments must belong to oligos');
		}
		if (!this.oligos.has(fromOligo) || !this.oligos.has(toOligo)) {
			throw new Error("Both segments' oligos must be part of this Part to connect them.");
		}
		this._assertNotMirrorEdit(fromOligo, toOligo);
		if (
			fromOligo.repeatGroupId &&
			toOligo.repeatGroupId &&
			fromOligo.repeatGroupId !== toOligo.repeatGroupId
		) {
			throw new InvalidOperationError("Can't join oligos from two different repeat groups.");
		}
		fromOligo.repeatGroupId ??= toOligo.repeatGroupId;

		try {
			this._uncacheOligo(fromOligo);
			if (fromOligo !== toOligo) this._uncacheOligo(toOligo);

			if (!fromSeg.threePrime.isFree || !toSeg.fivePrime.isFree) {
				throw new InvalidOperationError("Both the 3' and the 5' end must be free to connect.");
			}
			const isMerge = fromSeg.threePrime.isAdjacentTo(toSeg.fivePrime);
			if (isMerge) {
				fromSeg.threePrime.mergeTo(toSeg.fivePrime);
			} else {
				fromSeg.threePrime.connectTo(toSeg.fivePrime);
			}

			if (fromOligo === toOligo) {
				this._cacheOligo(fromOligo);
				return;
			}

			// Migrate every segment downstream of the junction into fromOligo. A merge has already
			// destroyed toSeg and handed its 3' connection to fromSeg, so start from fromSeg's.
			let current: OligoSegment | null = isMerge ? fromSeg.threePrime.connectedSegment : toSeg;
			while (current && !fromOligo.segments.has(current)) {
				const owner: Oligo | null = current.oligo;
				if (owner && owner !== fromOligo) owner.segments.delete(current);
				fromOligo.segments.add(current);
				current = current.threePrime.connectedSegment;
			}

			toOligo.destroy();
			this.oligos.delete(toOligo);
			this._cacheOligo(fromOligo);
		} catch (error) {
			throw new Error(`Failed to connect segment ends: ${(error as Error).message}`);
		}
	}

	breakOligoAt(
		oligo: Oligo,
		breakAtSegment: OligoSegment,
		breakAtIndex: number,
		opts?: { newOligoId?: string; newSegmentId?: string }
	): Oligo {
		// first make sure the oligo is in this part
		if (!this.oligos.has(oligo)) {
			throw new Error('Oligo must be part of this Part to break it.');
		}
		// make sure the segments are part of the oligo
		if (!oligo.segments.has(breakAtSegment)) {
			throw new Error('OligoSegment must be part of the Oligo to break it.');
		}
		this._assertNotMirrorEdit(oligo);

		// Uncache before structural change.
		this._uncacheOligo(oligo);
		const newOligo = oligo.breakOligoAt(breakAtSegment, breakAtIndex, opts);

		// add new oligo to this part's oligo list
		if (newOligo !== oligo) {
			this.oligos.add(newOligo);
			// Cache both updated oligos.
			this._cacheOligo(oligo);
			this._cacheOligo(newOligo);
		} else {
			this._cacheOligo(oligo);
		}
		return newOligo;
	}

	/** `opts.newOligoId` names the oligo split off downstream of `segment`, if there is one. */
	removeSegmentFromOligo(
		oligo: Oligo,
		segment: OligoSegment,
		opts?: { newOligoId?: string }
	): void {
		// first make sure the oligo is in this part
		if (!this.oligos.has(oligo)) {
			throw new Error('Oligo must be part of this Part to remove a segment from it.');
		}
		// uncache before structural change
		this._uncacheOligo(oligo);

		// break oligo at the segment's three prime end index
		this.breakOligoAt(oligo, segment, segment.threePrime.index, {
			newOligoId: opts?.newOligoId,
		});
		// break oligo at the segment's five prime end index on the original oligo

		const oligoToRemove = this.breakOligoAt(oligo, segment, segment.fivePrime.index);

		// remove the oligo that contains only the segment
		// this.oligos.delete(oligoToRemove);
		this.removeOligo(oligoToRemove);
	}

	createCrossover(
		fromOligo: Oligo,
		toOligo: Oligo,
		toSegment: OligoSegment,
		atIndexTarget: number
	): void {
		// it can be a crossover from an oligo to itself (hairpin crossover), but not the same segment
		const fromSegment = fromOligo.threePrimeEndSegment;
		if (fromOligo === toOligo && fromSegment === toSegment) {
			throw new Error('Cannot create crossover on the same segment of the same oligo.');
		}

		// first make sure both oligos are in this part
		const isSameOligo = fromOligo === toOligo;
		if (!this.oligos.has(fromOligo) || !this.oligos.has(toOligo)) {
			throw new Error('Both oligos must be part of this Part to create a crossover.');
		}
		if (!fromOligo.threePrime) {
			throw new Error('fromOligo must have a free three prime end to create a crossover.');
		}

		if (
			fromOligo !== toOligo &&
			toSegment === toOligo.threePrimeEndSegment &&
			atIndexTarget === toOligo.threePrime?.index
		) {
			throw new Error('Cannot create crossover to a three prime end.');
		}

		// if atIndexTarget is 1nt to five prime end on the 5'-segment of toOligo, reject since it will create a one-nt segment
		if (toOligo.fivePrime && toSegment === toOligo.fivePrime.segment) {
			const fivePrimeIndex = toOligo.fivePrime.index;
			const strandSetIndexTarget = toSegment.inStrandIndex;
			const isOneNtSegment =
				strandSetIndexTarget === 0
					? atIndexTarget === fivePrimeIndex + 1
					: atIndexTarget === fivePrimeIndex - 1;
			if (isOneNtSegment) {
				throw new Error('Cannot create crossover that results in a one-nucleotide segment.');
			}
		}

		// if atIndexTarget is a free five prime end of toOligo, just connect
		if (toOligo.fivePrime && toOligo.fivePrime.index === atIndexTarget) {
			this.connectTwoOligos(fromOligo, toOligo);
			return;
		}

		// else break the target at StrandSetTargetOligo === 0? index - 1 : index + 1 // TODO: this might create a one-nt segment
		// then connect this 3' end to the new oligo's 3' end
		const strandSetIndexTarget = toSegment.inStrandIndex;

		const breakAtIndex = strandSetIndexTarget === 0 ? atIndexTarget - 1 : atIndexTarget + 1;
		const newOligo = this.breakOligoAt(toOligo, toSegment, breakAtIndex);

		if (isSameOligo) {
			this.connectTwoOligos(newOligo, newOligo);
		} else {
			this.connectTwoOligos(fromOligo, newOligo);
		}
	}

	moveOligoTerminusTo(endToMove: SegmentEnd, toIdx: number): void {
		// Update only the affected segment range and ends.
		const seg = endToMove.segment;
		if (!seg) {
			endToMove.index = toIdx;
			return;
		}
		const owning = this._spatialIndex.getOligoBySegmentId(seg.id) || this.getOligoBySegment(seg);
		this._uncacheSegmentRange(seg);
		endToMove.index = toIdx;
		// Run synchronously rather than relying solely on the end setter's scheduled microtask,
		// so capturePartScope snapshots (taken synchronously inside the command's tx) observe the
		// settled slot state instead of racing it.
		seg.updateSlotsAfterEndMove();

		if (owning) this._cacheSegmentRange(owning, seg);
	}

	/** Translate a batch of segments (each with both ends moving by the same delta) instead of the
	 * clear-and-reinitialize semantics of a single-end resize (`moveOligoTerminusTo`): carries
	 * sequence and skip/insert content on every slot to its new position, mirroring skip/insert
	 * state onto the complementary strand. Throws if any marker can't be safely relocated
	 * (constrained crossover site, or incompatible complementary slot) — nothing in the batch is
	 * mutated if any segment fails validation.
	 *
	 * A segment with a constrained (crossover-connected) end is only supported here when its
	 * connected partner segment is *also* in this same batch, translating by the same delta —
	 * the crossover invariant (both ends always share one bp) is then preserved automatically,
	 * since both sides shift in lockstep, with no cross-segment propagation needed (`canMoveTo`'s
	 * constrained check only reads the partner's VH identity, never its live position). A
	 * constrained end whose partner *isn't* co-translating can't safely use this path — the
	 * caller (`moveOligoEndCmd`) is expected to have already excluded those.
	 *
	 * Segments in the same batch that are each other's complementary-strand partner (e.g. both
	 * strands of a duplex dragged together) are treated as moving in lockstep: their skip/insert
	 * pairing is preserved automatically and isn't re-validated or re-mirrored against each
	 * other's position. This requires resolving every segment's *current* complementary partner
	 * before any of them move — hence the two-phase plan-then-apply structure below, rather than
	 * looping a per-segment translate (which would corrupt or spuriously block later segments in
	 * the batch once earlier ones have already shifted). */
	translateOligoSegments(moves: { segment: OligoSegment; delta: number }[]): void {
		const nonZeroMoves = moves.filter((m) => m.delta !== 0);
		if (nonZeroMoves.length === 0) return;

		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const coMovingByDelta = new Map<OligoSegment, number>(
			nonZeroMoves.map((m) => [m.segment, m.delta])
		);

		for (const { segment, delta } of nonZeroMoves) {
			for (const end of [segment.fivePrime, segment.threePrime]) {
				if (!end.isConstrained) continue;
				const partner = end.connectedEnd;
				if (!partner || coMovingByDelta.get(partner.segment) !== delta) {
					throw new OperationNotSupportedError(
						"Cannot move: this strand is connected by a crossover whose other side isn't moving with it."
					);
				}
			}
			if (!segment.canTranslateSlotsBy(delta, coMovingByDelta)) {
				throw new InvalidOperationError(
					"Cannot move: a skip or insertion on this strand can't be relocated to the target position."
				);
			}
		}

		// Plan every cross-segment mirror mutation while positions are still pristine (before any
		// segment in the batch has moved), deferred as thunks to run once every segment's own
		// slots have shifted.
		const mirrorOps = nonZeroMoves.flatMap(({ segment, delta }) =>
			segment.planTranslateMirrorOps(delta, coMovingByDelta)
		);

		// Move the segment that's travelling furthest out of the way first (rightmost-first for a
		// rightward move, leftmost-first for leftward) — same principle as moveOligoEndCmd's
		// per-end sort. Without this, a not-yet-moved segment can still be sitting in the sweep
		// range of another segment's end (e.g. two adjacent/paired segments dragged together),
		// and canMoveTo's occupancy check throws — which end of the batch triggers it depends on
		// arbitrary iteration order, so the failure looked intermittent.
		const orderedMoves = [...nonZeroMoves].sort((a, b) => {
			const sa = Math.sign(a.delta);
			const sb = Math.sign(b.delta);
			if (sa === sb) {
				if (sa > 0) return b.segment.highIndex - a.segment.highIndex;
				return a.segment.lowIndex - b.segment.lowIndex;
			}
			return sb - sa;
		});

		for (const { segment, delta } of orderedMoves) {
			const owning =
				this._spatialIndex.getOligoBySegmentId(segment.id) || this.getOligoBySegment(segment);
			this._uncacheSegmentRange(segment);
			// Move both ends without triggering the per-end resize-style slot sync (which would
			// briefly see a wrong, partially-updated range and clobber slot content before
			// shiftOwnSlotsBy runs). Move the higher-index end first for a rightward delta, the
			// lower-index end first for a leftward one: moving one end compares it against the
			// *other* end's still-old index, and when |delta| exceeds the segment's own length that
			// stale comparison can violate the five<=three (or five>=three) direction invariant even
			// though the final state is perfectly valid once both ends have moved.
			const [higher, lower] =
				segment.fivePrime.index > segment.threePrime.index
					? [segment.fivePrime, segment.threePrime]
					: [segment.threePrime, segment.fivePrime];
			const [firstEnd, secondEnd] = delta > 0 ? [higher, lower] : [lower, higher];
			firstEnd.moveIndexWithoutSlotSync(firstEnd.index + delta);
			secondEnd.moveIndexWithoutSlotSync(secondEnd.index + delta);
			segment.shiftOwnSlotsBy(delta);
			if (owning) this._cacheSegmentRange(owning, segment);
		}

		for (const op of mirrorOps) op();
	}

	/** Whether a constrained crossover end shifted to `newIdx` still sits on a lattice crossover
	 * site toward the same partner VH with the same left/right orientation. Sites are only
	 * computed up to the VH's current length, so positions past it are checked whole `step`s
	 * back — lattice site patterns are `step`-periodic. */
	hasMatchingXoverSiteAt(end: SegmentEnd, newIdx: number): boolean {
		const partner = end.connectedEnd;
		if (!partner) return false;
		const vh = end.inVirtualHelix;
		const sites = this.potentialXoverSites(vh.index)[end.inStrandIndex];
		const isCurrentRight = sites.find((s) => s.bpIdx === end.index)?.right;
		const step = this.getRegionForVh(vh).step;
		const idx =
			newIdx < vh.length ? newIdx : newIdx - Math.ceil((newIdx - vh.length + 1) / step) * step;
		return sites.some(
			(s) =>
				s.bpIdx === idx && s.toVhIdx === partner.inVirtualHelix.index && s.right === isCurrentRight
		);
	}

	/** Read-only check: can copies of these whole oligos be placed `delta` bp along the same VHs?
	 * Copies may run past a region's end (`duplicateOligos` grows it), but must not overlap any
	 * existing strand, must keep every constrained crossover on a matching lattice site, and must
	 * keep the skip/insert pairing invariant with whatever strand ends up complementary. */
	canDuplicateOligosBy(oligos: Iterable<Oligo>, delta: number): DuplicateCheck {
		const fail = (reason: string): DuplicateCheck => ({ ok: false, reason });
		if (delta === 0) return fail('The copy would sit on top of the original.');
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const copied = [...new Set([...oligos].flatMap((o) => [...o.segments]))];
		if (copied.length === 0) return fail('Nothing to duplicate.');

		// Slot lengths of the copies at their new positions, so copies landing opposite each
		// other are checked against each other rather than against empty space.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const copySlotLen = new Map<string, number>();
		for (const seg of copied) {
			for (const slot of seg.slots) {
				copySlotLen.set(
					`${seg.inVirtualHelix.id}:${seg.inStrandIndex}:${slot.bpIndex + delta}`,
					slot.seq.length
				);
			}
		}

		for (const seg of copied) {
			const vh = seg.inVirtualHelix;
			const lo = seg.lowIndex + delta;
			const hi = seg.highIndex + delta;
			const { minBase } = this.getRegionForVh(vh);
			if (lo < minBase) return fail(`The copy on VH ${vh.index} would start before bp ${minBase}.`);
			if (seg.ownerStrandSet.isRangeOccupied(lo, hi)) {
				return fail(
					`The copy would overlap an existing strand on VH ${vh.index} (bp ${lo}–${hi}).`
				);
			}
			for (const end of [seg.fivePrime, seg.threePrime]) {
				if (end.isConstrained && !this.hasMatchingXoverSiteAt(end, end.index + delta)) {
					return fail(
						`VH ${vh.index} has no matching crossover site at bp ${end.index + delta} for the crossover at bp ${end.index}.`
					);
				}
			}

			const compStrandIdx = (1 - seg.inStrandIndex) as 0 | 1;
			for (const slot of seg.slots) {
				const newBp = slot.bpIndex + delta;
				const isModified = slot.seq.length !== 1;
				const copyLen = copySlotLen.get(`${vh.id}:${compStrandIdx}:${newBp}`);
				if (copyLen !== undefined) {
					if (copyLen !== slot.seq.length) {
						return fail(
							`Copies on VH ${vh.index} would pair a skip or insertion with a mismatched strand at bp ${newBp}.`
						);
					}
					continue;
				}
				const targetSeg = this.getEntitiesAtVh(vh.id, compStrandIdx, newBp).segment;
				const target = targetSeg?.slotForBp(newBp);
				// A kept mirror of a sibling original already carries the matching skip/insertion.
				const pairedMirror = !!targetSeg?.oligo?.isMirror && target?.seq.length === slot.seq.length;
				if (target && target.seq.length !== 1 && !pairedMirror) {
					return fail(
						`The copy on VH ${vh.index} would land opposite a skip or insertion at bp ${newBp}.`
					);
				}
				if (isModified && !target) {
					return fail(
						`A skip or insertion on VH ${vh.index} at bp ${slot.bpIndex} needs a complementary strand at bp ${newBp}.`
					);
				}
			}
		}
		return { ok: true };
	}

	/** Adds independent copies of these whole oligos `delta` bp along the same VHs, growing any
	 * region the copies run past, and mirrors copied skips/insertions onto existing
	 * complementary strands. Returns the new oligos. */
	duplicateOligos(oligos: Iterable<Oligo>, delta: number): Oligo[] {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const sources = [...new Set(oligos)];
		const check = this.canDuplicateOligosBy(sources, delta);
		if (!check.ok) throw new InvalidOperationError(check.reason);

		// Resolve existing complementary slots before any copy exists to shadow the lookup.
		const complementSyncs: {
			slot: NonNullable<ReturnType<OligoSegment['slotForBp']>>;
			len: number;
		}[] = [];
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const neededMaxBase = new Map<DesignRegion, number>();
		for (const oligo of sources) {
			for (const seg of oligo.segments) {
				const vh = seg.inVirtualHelix;
				const region = this.getRegionForVh(vh);
				neededMaxBase.set(
					region,
					Math.max(neededMaxBase.get(region) ?? 0, seg.highIndex + delta + 1)
				);
				const compStrandIdx = (1 - seg.inStrandIndex) as 0 | 1;
				for (const slot of seg.slots) {
					if (slot.seq.length === 1) continue;
					const newBp = slot.bpIndex + delta;
					const targetSeg = this.getEntitiesAtVh(vh.id, compStrandIdx, newBp).segment;
					const target = targetSeg?.slotForBp(newBp);
					if (!target) continue;
					if (targetSeg?.oligo?.isMirror && target.seq.length === slot.seq.length) continue;
					complementSyncs.push({ slot: target, len: slot.seq.length });
				}
			}
		}

		for (const [region, needed] of neededMaxBase) {
			if (needed <= region.maxBase) continue;
			region.increaseVhsLengthBy(Math.ceil((needed - region.maxBase) / region.step) * region.step);
		}

		const copies = sources.map((oligo) =>
			Oligo.fromJSON(cloneOligoJsonWithOffset(oligo.toJSON(), delta), this)
		);
		this.addOligosFromArray(copies);
		for (const { slot, len } of complementSyncs) slot.seq = mirroredSkipInsertSeq(slot.seq, len);
		return copies;
	}

	clearAllSequences(): void {
		for (const oligo of this.oligos) {
			oligo.clearOwnSequence();
		}
	}
}
