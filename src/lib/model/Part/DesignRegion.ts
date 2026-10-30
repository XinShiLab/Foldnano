import { v4 as uuidv4 } from 'uuid';
import VirtualHelix from '../VirtualHelix';
import {
	getHelixXY,
	normalizeVec,
	referenceRadial0,
	type VirtualHelixFrame,
} from '../geometry3d/dnaGeometry';
import type { CrossoverSite, Part } from './Part.svelte';
import { toCoord } from './latticeOffsets';

export type RegionKind = 'HONEYCOMB' | 'SQUARE' | 'FREEFORM';

export type DesignRegionJSON = {
	id: string;
	name: string;
	kind: RegionKind;
	planeId: string;
	vhOrder: string[];
	step: number;
	turnsPerStep: number;
	subStepSize: number;
	twistOffset: number;
	minBase: number;
	maxBase: number;
	defaultMaxBase?: number; // legacy key — read-only fallback for old files
};

const HONEYCOMB_DEFAULTS = { step: 21, turnsPerStep: 2, subStepSize: 7, twistOffset: 340 };
const SQUARE_DEFAULTS = {
	step: 32,
	turnsPerStep: 3,
	subStepSize: 8,
	twistOffset: 195,
};
const FREEFORM_DEFAULTS = { step: 21, turnsPerStep: 2, subStepSize: 7, twistOffset: 0 };

export function defaultsForKind(kind: RegionKind) {
	switch (kind) {
		case 'SQUARE':
			return SQUARE_DEFAULTS;
		case 'HONEYCOMB':
			return HONEYCOMB_DEFAULTS;
		case 'FREEFORM':
		default:
			return FREEFORM_DEFAULTS;
	}
}

function fallbackFrame(): VirtualHelixFrame {
	return {
		origin: { x: 0, y: 0, z: 0 },
		axis: { x: 0, y: 0, z: 1 },
		radial0: { x: 1, y: 0, z: 0 },
	};
}

export class DesignRegion {
	readonly id: string;
	name: string;
	kind: RegionKind;
	planeId: string;
	vhOrder: string[];
	step: number;
	turnsPerStep: number;
	subStepSize: number;
	twistOffset: number;
	minBase: number;
	maxBase: number;
	inPart?: Part;

	constructor(
		name: string,
		kind: RegionKind,
		planeId: string,
		id?: string,
		vhOrder: string[] = [],
		step?: number,
		turnsPerStep?: number,
		subStepSize?: number,
		twistOffset?: number,
		defaultMaxBase?: number,
		minBase?: number
	) {
		const defaults = defaultsForKind(kind);
		this.id = id || uuidv4();
		this.name = name;
		this.kind = kind;
		this.planeId = planeId;
		this.vhOrder = vhOrder;
		this.step = step ?? defaults.step;
		this.turnsPerStep = turnsPerStep ?? defaults.turnsPerStep;
		this.subStepSize = subStepSize ?? defaults.subStepSize;
		this.twistOffset = twistOffset ?? defaults.twistOffset;
		this.minBase = minBase ?? 0;
		this.maxBase = defaultMaxBase ?? this.step * 2;
	}

	get helicalPitch(): number {
		return this.step / this.turnsPerStep;
	}

	get twistPerBase(): number {
		return 360 / this.helicalPitch;
	}

	get twistPerBaseInDeg(): number {
		return this.twistPerBase;
	}

	get twistOffsetInDeg(): number {
		return this.twistOffset;
	}

	attachToPart(part: Part): this {
		this.inPart = part;
		return this;
	}

	protected get part(): Part {
		if (!this.inPart) {
			throw new Error(`Region ${this.id} is not attached to a Part`);
		}
		return this.inPart;
	}

	protected getRegionVirtualHelices(): VirtualHelix[] {
		const part = this.part;
		const regionHelices = part.virtualHelices.filter((vh) => vh.regionId === this.id);
		if (this.vhOrder.length === 0) return regionHelices;

		const byId = new Map(regionHelices.map((vh) => [vh.id, vh]));
		const ordered: VirtualHelix[] = [];
		for (const vhId of this.vhOrder) {
			const vh = byId.get(vhId);
			if (!vh) continue;
			ordered.push(vh);
			byId.delete(vhId);
		}
		ordered.push(...byId.values());
		return ordered;
	}

	protected getPlane() {
		const plane = this.part.getPlaneById(this.planeId);
		if (!plane) {
			throw new Error(`Region ${this.id} cannot find plane ${this.planeId}`);
		}
		return plane;
	}

	getLocalVirtualHelixFrame(_vh: VirtualHelix): VirtualHelixFrame {
		return fallbackFrame();
	}

	getVirtualHelixFrame(vh: VirtualHelix): VirtualHelixFrame {
		return this.getPlane().transformFrame(this.getLocalVirtualHelixFrame(vh));
	}

	get supportsLatticeGrid(): boolean {
		return false;
	}
	get supportsConstrainedXoverSites(): boolean {
		return false;
	}
	get supportsLatticeAutoStaple(): boolean {
		return false;
	}

	adjacentVhs(_vh: VirtualHelix): VirtualHelix[] {
		return [];
	}

	areVhsAdjacent(vh1: VirtualHelix, vh2: VirtualHelix): boolean {
		return this.adjacentVhs(vh1).includes(vh2);
	}

	potentialXoverSites(_vhIdx: number): CrossoverSite[][] {
		return [[], []];
	}

	increaseVhsLengthBy(deltaLength: number): void {
		if (deltaLength % this.step !== 0) {
			throw new Error(`deltaLength must be a multiple of ${this.step}`);
		}
		for (const vh of this.getRegionVirtualHelices()) {
			vh.length += deltaLength;
		}
		this.maxBase += deltaLength;
	}

	toJSON(): DesignRegionJSON {
		return {
			id: this.id,
			name: this.name,
			kind: this.kind,
			planeId: this.planeId,
			vhOrder: this.vhOrder,
			step: this.step,
			turnsPerStep: this.turnsPerStep,
			subStepSize: this.subStepSize,
			twistOffset: this.twistOffset,
			minBase: this.minBase,
			maxBase: this.maxBase,
		};
	}

	static fromJSON(json: DesignRegionJSON): DesignRegion {
		switch (json.kind) {
			case 'FREEFORM':
				return FreeformRegion.fromJSON(json);
			case 'SQUARE':
				return SquareRegion.fromJSON(json);
			case 'HONEYCOMB':
			default:
				return HoneycombRegion.fromJSON(json);
		}
	}
}

export abstract class LatticedDesignRegion extends DesignRegion {
	declare kind: 'HONEYCOMB' | 'SQUARE';
	private _xoverCache = new Map<number, CrossoverSite[][]>();

	override get supportsLatticeGrid(): boolean {
		return true;
	}
	override get supportsConstrainedXoverSites(): boolean {
		return true;
	}
	override get supportsLatticeAutoStaple(): boolean {
		return true;
	}

	addVhAtCoords(part: Part, col: number, row: number, idOverride?: string): VirtualHelix {
		const isEven = row % 2 === col % 2;
		const existing = part.virtualHelices
			.map((vh) =>
				isEven ? (vh.index % 2 === 0 ? vh.index : null) : vh.index % 2 === 1 ? vh.index : null
			)
			.filter((i): i is number => i !== null)
			.sort((a, b) => a - b);
		const newIndex = existing.length === 0 ? (isEven ? 0 : 1) : existing[existing.length - 1] + 2;

		const newVh = part.addVirtualHelix({ index: newIndex, id: idOverride });
		// Size the VH against THIS region, not the part's default region.
		// Otherwise a fresh VH in a non-default region inherits the default
		// region's maxBase, which can exceed this region's bounds and later
		// trip Part.createOligo's bounds check (e.g. fillEmptyStrandSet).
		newVh.length = this.maxBase;
		newVh.latticeCoords = { row, col };
		newVh.regionId = this.id;
		if (!this.vhOrder.includes(newVh.id)) this.vhOrder.push(newVh.id);
		this.invalidateDerivedCaches();
		part.syncListRows();
		return newVh;
	}

	constructor(
		name: string,
		kind: 'HONEYCOMB' | 'SQUARE',
		planeId: string,
		id?: string,
		vhOrder: string[] = [],
		step?: number,
		turnsPerStep?: number,
		subStepSize?: number,
		twistOffset?: number,
		defaultMaxBase?: number,
		minBase?: number
	) {
		super(
			name,
			kind,
			planeId,
			id,
			vhOrder,
			step,
			turnsPerStep,
			subStepSize,
			twistOffset,
			defaultMaxBase,
			minBase
		);
	}

	abstract adjacentCoords(col: number, row: number): { col: number; row: number }[];

	override getLocalVirtualHelixFrame(vh: VirtualHelix): VirtualHelixFrame {
		if (!vh.latticeCoords) {
			throw new Error(`Latticed region ${this.id} requires latticeCoords for VH ${vh.index}`);
		}
		const { col, row } = vh.latticeCoords;
		const { x, y } = getHelixXY(col, row, this.kind);
		return {
			origin: { x, y, z: 0 },
			axis: { x: 0, y: 0, z: 1 },
			radial0: { x: 1, y: 0, z: 0 },
		};
	}

	getVhByLatticeCoords(col: number, row: number): VirtualHelix | null {
		return (
			this.getRegionVirtualHelices().find(
				(vh) => vh.latticeCoords?.col === col && vh.latticeCoords?.row === row
			) ?? null
		);
	}

	override adjacentVhs(vh: VirtualHelix): VirtualHelix[] {
		if (!vh.latticeCoords) return [];
		const { col, row } = vh.latticeCoords;
		return this.adjacentCoords(col, row)
			.map(({ col: candidateCol, row: candidateRow }) =>
				this.getVhByLatticeCoords(candidateCol, candidateRow)
			)
			.filter((candidate) => candidate !== null);
	}

	private calcPotentialXoverSites(vh: VirtualHelix): CrossoverSite[][] {
		if (!vh.latticeCoords) return [[], []];
		const { col, row } = vh.latticeCoords;

		const potentialSites = vh.strandSets.map((strandSet) => {
			const collected: ReturnType<typeof toCoord>[] = [];
			for (let bpIndex = 0; bpIndex < vh.length; bpIndex++) {
				const left = toCoord(
					this.kind,
					this.step,
					vh.isEvenParity,
					strandSet.strandIndex,
					col,
					row,
					bpIndex
				);
				if (left) collected.push(left);

				const right = toCoord(
					this.kind,
					this.step,
					vh.isEvenParity,
					strandSet.strandIndex,
					col,
					row,
					bpIndex,
					true
				);
				if (right) collected.push(right);
			}
			return collected.filter((site) => site !== null);
		});

		return potentialSites.map((strand) =>
			strand
				.map((site) => ({
					bpIdx: site.bpIdx,
					toVhIdx: this.getVhByLatticeCoords(site.to.col, site.to.row)?.index ?? -1,
					right: site.right,
				}))
				.filter((site) => site.toVhIdx !== -1)
		);
	}

	override potentialXoverSites(vhIdx: number): CrossoverSite[][] {
		const cached = this._xoverCache.get(vhIdx);
		if (cached) return cached;

		const vh = this.part.getVhByIndex(vhIdx);
		if (!vh || vh.regionId !== this.id) return [[], []];

		const sites = this.calcPotentialXoverSites(vh);
		this._xoverCache.set(vhIdx, sites);
		return sites;
	}

	override increaseVhsLengthBy(deltaLength: number): void {
		super.increaseVhsLengthBy(deltaLength);
		this._xoverCache.clear();
	}

	invalidateDerivedCaches(): void {
		this._xoverCache.clear();
	}

	autoStaple(): void {
		const part = this.part;
		const regionVhs = this.getRegionVirtualHelices();

		// Step 1+2: Fill empty staple strand sets to mirror scaffold occupancy
		for (const vh of regionVhs) {
			const stapleIdx: 0 | 1 = vh.index % 2 === 0 ? 1 : 0;
			const scaffoldIdx: 0 | 1 = stapleIdx === 0 ? 1 : 0;
			const stapleSet = vh.strandSets[stapleIdx];
			if (!stapleSet.isEmpty) continue;

			const scaffoldSet = vh.strandSets[scaffoldIdx];
			const merged = scaffoldSet.mergedIntervals;
			for (const [lo, hi] of merged) {
				const fivePrime = stapleIdx === 0 ? lo : hi;
				const threePrime = stapleIdx === 0 ? hi : lo;
				try {
					part.createOligo(vh, fivePrime, threePrime);
				} catch {
					// ignore failures
				}
			}
		}

		// Collect scaffold end indices across all part VHs (for accurate isFarFromEnds)
		const endsByVh = new Map<number, { staple: Set<number>; scaffold: Set<number> }>();
		for (const vh of part.virtualHelices) {
			const stapleIdx: 0 | 1 = vh.index % 2 === 0 ? 1 : 0;
			const scaffoldIdx: 0 | 1 = stapleIdx === 0 ? 1 : 0;
			endsByVh.set(vh.index, {
				staple: vh.strandSets[stapleIdx].getSegmentEndIndices(),
				scaffold: vh.strandSets[scaffoldIdx].getSegmentEndIndices(),
			});
		}
		const isFarFromEnds = (vh: VirtualHelix, bpIdx: number): boolean => {
			const entry = endsByVh.get(vh.index);
			const ends = new Set<number>();
			if (entry) {
				for (const e of entry.scaffold) ends.add(e);
			}
			ends.add(0);
			ends.add(vh.length - 1);
			let minD = Infinity;
			for (const e of ends) {
				const d = Math.abs(e - bpIdx);
				if (d < minD) minD = d;
			}
			return minD >= 6;
		};

		// Step 3: Add permissible crossovers (only for VHs in this region)
		for (const vh of regionVhs) {
			const stapleIdx: 0 | 1 = vh.index % 2 === 0 ? 1 : 0;
			const sitesByStrand = this.potentialXoverSites(vh.index);
			const sites = sitesByStrand[stapleIdx] || [];
			for (const site of sites) {
				const isStart = stapleIdx === 1 ? site.right : !site.right;
				if (!isStart) continue;
				const toVh = part.getVhByIndex(site.toVhIdx);
				if (!toVh) continue;
				const bp = site.bpIdx;
				const fromSet = vh.strandSets[stapleIdx];
				const toSet = toVh.strandSets[1 - stapleIdx];
				if (!fromSet.isIndexOccupied(bp) || !toSet.isIndexOccupied(bp)) continue;
				if (!isFarFromEnds(vh, bp) || !isFarFromEnds(toVh, bp)) continue;

				const fromHit = part.getOligoByIndices(vh.listRow, stapleIdx, bp);
				const toHit = part.getOligoByIndices(toVh.listRow, (1 - stapleIdx) as 0 | 1, bp);
				if (!fromHit || !toHit) continue;

				let fromOligo = fromHit.oligo;
				const fromSegment = fromHit.segment;
				let toOligo = toHit.oligo;
				let toSegment = toHit.segment;

				// A connection already terminates exactly at this junction — either this very
				// crossover (from a previous autoStaple pass) or some other connection. Either
				// way, don't tear it down to "recreate" it; only fill genuinely empty sites.
				if (fromSegment.threePrime.index === bp && !fromSegment.threePrime.isFree) continue;

				if (
					!fromOligo.threePrime ||
					fromOligo.threePrime.index !== bp ||
					!fromOligo.threePrime.isFree
				) {
					try {
						part.breakOligoAt(fromOligo, fromSegment, bp);
					} catch {
						continue;
					}
					const refreshed = part.getOligoByIndices(vh.listRow, stapleIdx, bp);
					if (!refreshed) continue;
					fromOligo = refreshed.oligo;
					if (
						!fromOligo.threePrime ||
						fromOligo.threePrime.index !== bp ||
						!fromOligo.threePrime.isFree
					) {
						continue;
					}

					// If fromOligo and toOligo were already merged by an earlier crossover in
					// this same pass, the break above may have moved toSegment into a new oligo
					// object — re-resolve both from the current state rather than reuse stale refs.
					const refreshedTo = part.getOligoByIndices(toVh.listRow, (1 - stapleIdx) as 0 | 1, bp);
					if (!refreshedTo) continue;
					toOligo = refreshedTo.oligo;
					toSegment = refreshedTo.segment;
				}

				try {
					part.createCrossover(fromOligo, toOligo, toSegment, bp);
				} catch {
					// ignore and continue
				}
			}
		}
	}
}

export class HoneycombRegion extends LatticedDesignRegion {
	constructor(
		name: string,
		planeId: string,
		id?: string,
		vhOrder: string[] = [],
		step?: number,
		turnsPerStep?: number,
		subStepSize?: number,
		twistOffset?: number,
		defaultMaxBase?: number,
		minBase?: number
	) {
		super(
			name,
			'HONEYCOMB',
			planeId,
			id,
			vhOrder,
			step,
			turnsPerStep,
			subStepSize,
			twistOffset,
			defaultMaxBase,
			minBase
		);
	}

	adjacentCoords(col: number, row: number): { col: number; row: number }[] {
		const adjacent = [];
		if (row % 2 === col % 2) {
			adjacent.push({ col: col - 1, row });
			adjacent.push({ col: col + 1, row });
			adjacent.push({ col, row: row - 1 });
		} else {
			adjacent.push({ col: col - 1, row });
			adjacent.push({ col: col + 1, row });
			adjacent.push({ col, row: row + 1 });
		}
		return adjacent;
	}

	static fromJSON(json: DesignRegionJSON): HoneycombRegion {
		return new HoneycombRegion(
			json.name,
			json.planeId,
			json.id,
			json.vhOrder,
			json.step,
			json.turnsPerStep,
			json.subStepSize,
			json.twistOffset,
			json.maxBase ?? json.defaultMaxBase,
			json.minBase
		);
	}
}

export class SquareRegion extends LatticedDesignRegion {
	constructor(
		name: string,
		planeId: string,
		id?: string,
		vhOrder: string[] = [],
		step?: number,
		turnsPerStep?: number,
		subStepSize?: number,
		twistOffset?: number,
		defaultMaxBase?: number,
		minBase?: number
	) {
		super(
			name,
			'SQUARE',
			planeId,
			id,
			vhOrder,
			step,
			turnsPerStep,
			subStepSize,
			twistOffset,
			defaultMaxBase,
			minBase
		);
	}

	adjacentCoords(col: number, row: number): { col: number; row: number }[] {
		return [
			{ col: col - 1, row },
			{ col: col + 1, row },
			{ col, row: row - 1 },
			{ col, row: row + 1 },
		].filter(({ col: candidateCol, row: candidateRow }) => candidateCol >= 0 && candidateRow >= 0);
	}

	static fromJSON(json: DesignRegionJSON): SquareRegion {
		return new SquareRegion(
			json.name,
			json.planeId,
			json.id,
			json.vhOrder,
			json.step,
			json.turnsPerStep,
			json.subStepSize,
			json.twistOffset,
			json.maxBase ?? json.defaultMaxBase,
			json.minBase
		);
	}
}

export class FreeformRegion extends DesignRegion {
	constructor(
		name: string,
		planeId: string,
		id?: string,
		vhOrder: string[] = [],
		step?: number,
		turnsPerStep?: number,
		subStepSize?: number,
		twistOffset?: number,
		defaultMaxBase?: number,
		minBase?: number
	) {
		super(
			name,
			'FREEFORM',
			planeId,
			id,
			vhOrder,
			step,
			turnsPerStep,
			subStepSize,
			twistOffset,
			defaultMaxBase,
			minBase
		);
	}

	override getLocalVirtualHelixFrame(vh: VirtualHelix): VirtualHelixFrame {
		if (!vh.localFrame) {
			console.warn(`Freeform region: VH ${vh.index} has no localFrame; falling back to origin/+Z.`);
			return fallbackFrame();
		}
		return vh.localFrame;
	}

	addVhAt(
		part: Part,
		start: [number, number, number],
		direction: [number, number, number] = [0, 0, 1]
	): VirtualHelix {
		const vh = part.addVirtualHelix();
		vh.length = this.maxBase;
		vh.regionId = this.id;
		const axis = normalizeVec({ x: direction[0], y: direction[1], z: direction[2] });
		vh.localFrame = {
			origin: { x: start[0], y: start[1], z: start[2] },
			axis,
			radial0: referenceRadial0(axis),
		};
		if (!this.vhOrder.includes(vh.id)) this.vhOrder.push(vh.id);
		part.syncListRows();
		return vh;
	}

	moveVh(_part: Part, vh: VirtualHelix, x: number, y: number, z?: number): void {
		if (!vh.localFrame) {
			vh.localFrame = {
				origin: { x, y, z: z ?? 0 },
				axis: { x: 0, y: 0, z: 1 },
				radial0: { x: 1, y: 0, z: 0 },
			};
		} else {
			vh.localFrame = {
				...vh.localFrame,
				origin: { x, y, z: z ?? vh.localFrame.origin.z },
			};
		}
	}

	static fromJSON(json: DesignRegionJSON): FreeformRegion {
		return new FreeformRegion(
			json.name,
			json.planeId,
			json.id,
			json.vhOrder,
			json.step,
			json.turnsPerStep,
			json.subStepSize,
			json.twistOffset,
			json.maxBase ?? json.defaultMaxBase,
			json.minBase
		);
	}
}
