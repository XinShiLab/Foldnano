import { Part } from '../Part';
import { HoneycombRegion, LatticedDesignRegion, SquareRegion } from '../Part/DesignRegion';
import Oligo, { OligoSegment } from '../Oligo';
import VirtualHelix from '../VirtualHelix';
import { v4 as uuidv4 } from 'uuid';
import type { Plane } from '../Part/Plane.svelte';
import type { DesignIssue } from '../checks/designIssue';
import { checkCadnanoJsonShape } from '../checks/shape/cadnanoJsonShape';
import {
	AmbiguousLatticeError,
	latticeCandidates,
	latticesByLength,
	type CadnanoLattice,
} from './cadnanoLattice';

const isScafToStrandSetIdx = (vhIdx: number, isScaf: boolean): number => {
	return vhIdx % 2 === 0 ? Number(!isScaf) : Number(isScaf);
};

type Nt = [number, number, number, number]; // [fromVhIdx, fromBpIdx, toVhIdx, toBpIdx]
type Color = [number, number]; // [fivePrimeIdx, 24bit int representing color]
/** strand segments 'start' === 5' and 'end' === 3' */
type Pos = {
	vhIdx: number;
	bpIdx: number;
	strandIdx: 0 | 1;
};

type SkipORLoop = Map<number, number>; // index, type: -1 for skip, 1 for loop

const areTwoPosEqual = (a: Pos, b: Pos): boolean => {
	return a.vhIdx === b.vhIdx && a.bpIdx === b.bpIdx && a.strandIdx === b.strandIdx;
};

interface SegmentInfo {
	startBpIdx: number;
	endBpIdx: number;
	from: Pos | null;
	to: Pos | null;
	skipsAndLoops: SkipORLoop;
}

export interface VStrandJSON {
	row: number;
	col: number;
	num: number;
	scaf: Nt[];
	stap: Nt[];
	loop: number[];
	skip: number[];
	// Some cadnano files use camelCase variants; both forms are accepted
	scaf_loop?: number[];
	stap_loop?: number[];
	scafLoop?: number[];
	stapLoop?: number[];
	// scaf_colors may be absent in some cadnano file variants
	stap_colors?: Color[];
	scaf_colors?: Color[];
}

class VStrand implements VStrandJSON {
	row: number;
	col: number;
	num: number;
	scaf: Nt[];
	stap: Nt[];
	loop: number[];
	skip: number[];
	scafLoop: number[];
	stapLoop: number[];
	stap_colors: Color[];
	scaf_colors: Color[];
	segments: [Set<SegmentInfo>, Set<SegmentInfo>];
	/** Warnings generated during parsing (e.g. a deletion moved off a crossover base). */
	warnings: string[] = [];
	// Private so it stays out of `JSON.stringify` on export (unlike `segments` / `warnings`).
	#singleNtBpIndices: number[] = [];

	/** bp indices of 1-nt strands: bases linked to neither neighbour on this helix, which never start a segment. */
	get singleNtBpIndices(): readonly number[] {
		return this.#singleNtBpIndices;
	}

	constructor(vsobj: VStrandJSON) {
		this.row = vsobj.row;
		this.col = vsobj.col;
		this.num = vsobj.num;
		this.scaf = vsobj.scaf;
		this.stap = vsobj.stap;
		this.loop = vsobj.loop;
		this.skip = [...vsobj.skip]; // cloned: relocateSkipsOffCrossovers mutates it
		this.relocateSkipsOffCrossovers();
		// Accept both spellings on input; canonicalize to cadnano's own camelCase for storage/output
		this.scafLoop = vsobj.scafLoop ?? vsobj.scaf_loop ?? [];
		this.stapLoop = vsobj.stapLoop ?? vsobj.stap_loop ?? [];
		this.stap_colors = vsobj.stap_colors ?? [];
		this.scaf_colors = vsobj.scaf_colors ?? [];
		this.segments = this.buildSegments();
	}

	/** A bp column carries a (constrained) crossover when either strand links to a different VH here. */
	private isCrossoverColumn(i: number): boolean {
		const refsOtherVh = (nt: Nt | undefined) =>
			!!nt && ((nt[0] !== -1 && nt[0] !== this.num) || (nt[2] !== -1 && nt[2] !== this.num));
		return refsOtherVh(this.scaf[i]) || refsOtherVh(this.stap[i]);
	}

	private isOccupiedColumn(i: number): boolean {
		const occupied = (nt: Nt | undefined) =>
			!!nt && !(nt[0] === -1 && nt[1] === -1 && nt[2] === -1 && nt[3] === -1);
		return occupied(this.scaf[i]) || occupied(this.stap[i]);
	}

	/**
	 * Deletions (skips) sitting on a constrained crossover bp can't be represented by the
	 * NT/oxDNA model (a deletion at a pinned anchor) and are disallowed in the app. Cadnano
	 * permits them, so on import we relocate each such skip to the nearest adjacent occupied,
	 * non-crossover bp on the same helix — which always exists because a crossover base has at
	 * least one interior neighbour within its segment. Operating on the column-wide `skip` array
	 * keeps both strands mirrored. Emits a warning for the user.
	 */
	private relocateSkipsOffCrossovers(): void {
		const L = this.skip.length;
		for (let i = 0; i < L; i++) {
			if (this.skip[i] !== -1) continue;
			if (!this.isCrossoverColumn(i)) continue;
			const target = [i - 1, i + 1].find(
				(j) =>
					j >= 0 &&
					j < L &&
					this.skip[j] === 0 &&
					this.isOccupiedColumn(j) &&
					!this.isCrossoverColumn(j)
			);
			if (target === undefined) {
				this.warnings.push(
					`VH ${this.num}: deletion at crossover bp ${i} could not be relocated; ` +
						`the NT model and oxDNA export may reject this design.`
				);
				continue;
			}
			this.skip[i] = 0;
			this.skip[target] = -1;
			this.warnings.push(
				`VH ${this.num}: deletion at crossover bp ${i} moved to bp ${target} ` +
					`(deletions are not allowed on crossover sites).`
			);
		}
	}

	private buildSegments(): [Set<SegmentInfo>, Set<SegmentInfo>] {
		const makePos = (vhIdx: number, bpIdx: number, isScaf: boolean): Pos => ({
			vhIdx,
			bpIdx,
			strandIdx: isScafToStrandSetIdx(vhIdx, isScaf) as 0 | 1,
		});

		const buildSegmentsForStrand = (nts: Nt[], isScaf: boolean) => {
			const segmentsInStrand: SegmentInfo[] = [];
			const len = nts.length;
			const curVh = this.num;
			const strandSetIdx = isScafToStrandSetIdx(curVh, isScaf) as 0 | 1;
			const step = strandSetIdx === 0 ? 1 : -1;

			const isEmpty = (nt: Nt) => nt[0] === -1 && nt[1] === -1 && nt[2] === -1 && nt[3] === -1;
			const nextIndex = (i: number) => i + step;
			const prevIndex = (i: number) => i - step;

			const isFreeStart = (nt: Nt, i: number) =>
				nt[0] === -1 && nt[1] === -1 && nt[2] === curVh && nt[3] === nextIndex(i);

			// Relaxed: treat any non-free 'from' that points into this VH with expected next index as an xover entry,
			// even if the source VH is the same (internal xover).
			const isXoverEntryStart = (nt: Nt, i: number) =>
				nt[0] !== -1 &&
				(nt[0] !== curVh || nt[1] !== prevIndex(i)) &&
				nt[2] === curVh &&
				nt[3] === nextIndex(i);

			const isFreeEnd = (nt: Nt, i: number) =>
				nt[2] === -1 && nt[3] === -1 && nt[0] === curVh && (nt[1] === prevIndex(i) || nt[1] === i);

			// Relaxed: treat any non-free 'to' that points out from this VH with expected prev index as an xover exit,
			// even if the destination VH is the same (internal xover).
			// Also accept self-referential prev (nt[1] === i): some cadnano files use [vh, i, ...] at position i
			// as a convention for a crossover exit endpoint rather than the expected [vh, prevIndex(i), ...].
			const isXoverExitEnd = (nt: Nt, i: number) =>
				nt[2] !== -1 &&
				nt[0] === curVh &&
				(nt[1] === prevIndex(i) || nt[1] === i) &&
				(nt[2] !== curVh || nt[3] !== nextIndex(i));

			// loop[i] stores the insertion count (>0 = insertion); skip[i] === -1 means deletion.
			const loopCount = (i: number): number => (this.loop[i] > 0 ? this.loop[i] : 0);
			const isLoop = (i: number) => this.loop[i] > 0;
			const isSkip = (i: number) => this.skip[i] === -1;

			let segmentStartInfo: { bpIdx: number; from: Pos | null; skipsAndLoops: SkipORLoop } | null =
				null;

			const start = step === 1 ? 0 : len - 1;
			const inBounds = (i: number) => (step === 1 ? i < len : i >= 0);
			for (let i = start; inBounds(i); i += step) {
				const nt = nts[i];
				if (isEmpty(nt)) continue;

				if (!segmentStartInfo) {
					if (isFreeStart(nt, i) || isXoverEntryStart(nt, i)) {
						segmentStartInfo = {
							bpIdx: i,
							from: isFreeStart(nt, i) ? null : makePos(nt[0], nt[1], isScaf),
							skipsAndLoops: new Map<number, number>(),
						};
						// Check skip/loop at the segment's own start position
						if (isLoop(i) || isSkip(i)) {
							segmentStartInfo.skipsAndLoops.set(i, isLoop(i) ? loopCount(i) : -1);
						}
					} else {
						this.#singleNtBpIndices.push(i);
					}
					continue;
				}

				if (isLoop(i) || isSkip(i)) {
					const v = isLoop(i) ? loopCount(i) : -1;
					segmentStartInfo.skipsAndLoops.set(i, v);
				}

				if (isFreeEnd(nt, i) || isXoverExitEnd(nt, i)) {
					segmentsInStrand.push({
						startBpIdx: segmentStartInfo.bpIdx,
						endBpIdx: i,
						from: segmentStartInfo.from,
						to: isFreeEnd(nt, i) ? null : makePos(nt[2], nt[3], isScaf),
						skipsAndLoops: segmentStartInfo.skipsAndLoops,
					});
					segmentStartInfo = null;
				}
			}
			return segmentsInStrand;
		};

		const segment_scaf = buildSegmentsForStrand(this.scaf, true);
		const segment_stap = buildSegmentsForStrand(this.stap, false);

		const segments: [Set<SegmentInfo>, Set<SegmentInfo>] = [new Set(), new Set()];
		const scafIdx = isScafToStrandSetIdx(this.num, true) as 0 | 1;
		const stapIdx = (1 - scafIdx) as 0 | 1;
		segments[scafIdx] = new Set(segment_scaf);
		segments[stapIdx] = new Set(segment_stap);

		return segments;
	}

	getSegmentStartAt(strandIdx: 0 | 1, bpIdx: number): SegmentInfo | null {
		const segs = this.segments[strandIdx];
		for (const seg of segs) {
			if (seg.startBpIdx === bpIdx) return seg;
		}
		return null;
	}
}

export class CadnanoJSON {
	name: string;
	vstrands: VStrand[];
	// Private so it stays out of `JSON.stringify` on export.
	#shapeIssues: DesignIssue[] = [];

	/** Issues from the shape check when built with `fromRaw`; empty for pre-validated data. */
	get shapeIssues(): readonly DesignIssue[] {
		return this.#shapeIssues;
	}

	/** Warnings emitted during parsing: shape repairs and per-helix repairs. */
	get warnings(): string[] {
		return [
			...this.#shapeIssues.filter((i) => i.severity === 'warning').map((i) => i.message),
			...this.vstrands.flatMap((vs) => vs.warnings),
		];
	}

	constructor(name: string, vstrands: VStrandJSON[]) {
		this.name = name;
		this.vstrands = vstrands.map((vs) => new VStrand(vs));
	}

	/** Builds from untrusted parsed JSON (files, URLs): shape-checks first; throws `DesignCheckError`. */
	static fromRaw(raw: unknown): CadnanoJSON {
		const { name, vstrands, issues } = checkCadnanoJsonShape(raw);
		const cadnano = new CadnanoJSON(name, vstrands);
		cadnano.#shapeIssues = issues;
		return cadnano;
	}

	get info() {
		return `Cadnano JSON Name: ${this.name}`;
	}

	/** Lattices this file could be; two entries mean the caller must ask (see `cadnanoLattice.ts`). */
	latticeCandidates(): CadnanoLattice[] {
		return latticeCandidates(this.vstrands);
	}

	/** The lattice to build with: `requested` if the file allows it, else the only candidate. */
	private _resolveLattice(requested?: CadnanoLattice): CadnanoLattice {
		if (this.vstrands.length === 0) throw new Error('Cadnano data contains no virtual strands.');
		const numBases = this.vstrands[0].scaf.length;
		if (requested) {
			if (!latticesByLength(numBases).includes(requested)) {
				throw new Error(
					`A ${numBases}-base design can't be ${requested.toLowerCase()}: the length isn't a multiple of its repeat.`
				);
			}
			const candidates = this.latticeCandidates();
			if (!candidates.includes(requested)) {
				throw new Error(
					`This design's crossovers sit on ${candidates[0].toLowerCase()} crossover sites, not ${requested.toLowerCase()} ones.`
				);
			}
			return requested;
		}
		const candidates = this.latticeCandidates();
		if (candidates.length === 0) {
			throw new Error(`Unsupported cadnano lattice (numBases=${numBases})`);
		}
		if (candidates.length > 1) throw new AmbiguousLatticeError(numBases);
		return candidates[0];
	}

	/** A 1-nt strand isn't a valid design element and never becomes a segment, so reject the file
	 * rather than silently dropping those bases (and leaving their crossovers dangling). */
	private _assertNoSingleNtStrands(): void {
		const positions = this.vstrands.flatMap((vs) =>
			vs.singleNtBpIndices.map((bp) => `${vs.num}[${bp}]`)
		);
		if (positions.length > 0) {
			throw new Error(
				`Cadnano import contains 1-nt strands, which Foldnano doesn't support. Extend or remove them in cadnano first. Helix[base]: ${positions.join(', ')}`
			);
		}
	}

	toPart(options?: { lattice?: CadnanoLattice }) {
		const typeOfLattice = this._resolveLattice(options?.lattice);
		const numBases = this.vstrands[0].scaf.length;
		this._assertNoSingleNtStrands();
		const newPart = Part.forType(typeOfLattice, this.name, uuidv4(), numBases);
		const region = newPart.getDefaultRegion() as LatticedDesignRegion;
		this._populateLatticedRegion(newPart, region, 0);
		return newPart;
	}

	/**
	 * Repopulate an existing region with VHs and oligos from this CadnanoJSON.
	 * All VHs in the region must have been removed from the part before calling this.
	 * VH indices are used as-is (indexOffset = 0), preserving parity and cross-region connection points.
	 */
	replaceRegionInPart(part: Part, region: LatticedDesignRegion): void {
		// The region's own kind settles a length that fits both lattices.
		this._resolveLattice(region.kind);
		this._assertNoSingleNtStrands();
		this._populateLatticedRegion(part, region, 0);
	}

	/**
	 * Import the cadnano data as a NEW region inside the given existing Part, on the given Plane.
	 * The Plane must not yet be added to the part; this method calls part.addPlane and part.addRegion.
	 * VH indices are shifted by an even offset to avoid collision with existing VHs in the part
	 * (the parity convention used by isScafToStrandSetIdx is preserved).
	 */
	toRegionInPart(
		part: Part,
		plane: Plane,
		options?: { lattice?: CadnanoLattice }
	): LatticedDesignRegion {
		const typeOfLattice = this._resolveLattice(options?.lattice);
		const numBases = this.vstrands[0].scaf.length;
		this._assertNoSingleNtStrands();
		const name = part.nextRegionName(typeOfLattice);
		const region =
			typeOfLattice === 'SQUARE'
				? new SquareRegion(
						name,
						plane.id,
						undefined,
						[],
						undefined,
						undefined,
						undefined,
						undefined,
						numBases
					)
				: new HoneycombRegion(
						name,
						plane.id,
						undefined,
						[],
						undefined,
						undefined,
						undefined,
						undefined,
						numBases
					);

		// Compute even offset to avoid VH index collision while preserving parity convention.
		const existingIndices = part.virtualHelices.map((vh) => vh.index);
		const maxExisting = existingIndices.length > 0 ? Math.max(...existingIndices) : -1;
		const rawOffset = maxExisting + 1;
		const indexOffset = rawOffset % 2 === 0 ? rawOffset : rawOffset + 1;

		part.addPlane(plane);
		part.addRegion(region);
		this._populateLatticedRegion(part, region, indexOffset);
		return region;
	}

	private _populateLatticedRegion(
		part: Part,
		region: LatticedDesignRegion,
		indexOffset: number
	): void {
		const survivingIndices = new Set(
			part.virtualHelices.filter((vh) => vh.regionId !== region.id).map((vh) => vh.index)
		);
		const replacementIndices = new Set<number>();
		const duplicateReplacementIndices = new Set<number>();
		const collidingIndices = new Set<number>();
		for (const vstrandJson of this.vstrands) {
			const nextIndex = vstrandJson.num + indexOffset;
			if (replacementIndices.has(nextIndex)) {
				duplicateReplacementIndices.add(nextIndex);
			}
			replacementIndices.add(nextIndex);
			if (survivingIndices.has(nextIndex)) {
				collidingIndices.add(nextIndex);
			}
		}
		if (duplicateReplacementIndices.size > 0) {
			throw new Error(
				`Cadnano import contains duplicate virtual helix indices: ${[...duplicateReplacementIndices]
					.sort((a, b) => a - b)
					.join(', ')}`
			);
		}
		if (collidingIndices.size > 0) {
			throw new Error(
				`Cadnano import would collide with existing virtual helix indices outside the target region: ${[
					...collidingIndices,
				]
					.sort((a, b) => a - b)
					.join(', ')}`
			);
		}

		const numBases = this.vstrands[0].scaf.length;
		const startListRow = part.virtualHelices.length;

		// Create VirtualHelices and bind them to the target region.
		const newVhs = this.vstrands.map((vstrandJson, i) => {
			const vh = new VirtualHelix(
				part,
				vstrandJson.num + indexOffset,
				startListRow + i,
				numBases,
				vstrandJson.row,
				vstrandJson.col
			);
			vh.regionId = region.id;
			return vh;
		});
		part.virtualHelices = [...part.virtualHelices, ...newVhs];
		region.vhOrder = newVhs.map((v) => v.id);
		part.syncListRows();

		// vhByCadnanoNum is keyed by the cadnano vstrand.num so that connectivity references
		// inside SegmentInfo.from/to (which carry cadnano nums) resolve correctly even when an
		// indexOffset has been applied.
		const vhByCadnanoNum = new Map<number, VirtualHelix>();
		this.vstrands.forEach((vs, i) => vhByCadnanoNum.set(vs.num, newVhs[i]));
		const vsByNum = new Map<number, VStrand>();
		for (const vs of this.vstrands) vsByNum.set(vs.num, vs);

		const oligoSet = new Set<Oligo>();

		// First pass: start from free 5' ends
		for (const vstrand of this.vstrands) {
			for (const strandIdx of [0, 1] as const) {
				const segs = vstrand.segments[strandIdx];
				const colors =
					strandIdx === isScafToStrandSetIdx(vstrand.num, true)
						? vstrand.scaf_colors
						: vstrand.stap_colors;
				for (const segInfo of Array.from(segs)) {
					if (segInfo.from !== null) continue;
					const newOligo = new Oligo(part);
					const vh = vhByCadnanoNum.get(vstrand.num)!;
					const oligoSegment = new OligoSegment(part, vh, segInfo.startBpIdx, segInfo.endBpIdx);
					oligoSegment.skipsAndInserts = Array.from(segInfo.skipsAndLoops) ?? [];
					const thisColor = colors.find((c) => c[0] === segInfo.startBpIdx);
					const colorNum = thisColor ? thisColor[1] & 0xffffff : undefined;
					const colorString =
						colorNum !== undefined ? `#${colorNum.toString(16).padStart(6, '0')}` : undefined;
					newOligo.addSegment(oligoSegment);
					newOligo.color = colorString ?? newOligo.color;
					segs.delete(segInfo);

					if (segInfo.to) {
						extendThreePrime(part, vhByCadnanoNum, vsByNum, newOligo, oligoSegment, segInfo);
					}
					oligoSet.add(newOligo);
				}
			}
		}

		// Second pass: remaining segments form circular oligos
		for (const vstrand of this.vstrands) {
			for (const strandIdx of [0, 1] as const) {
				const segs = vstrand.segments[strandIdx];
				const colors =
					strandIdx === isScafToStrandSetIdx(vstrand.num, true)
						? vstrand.scaf_colors
						: vstrand.stap_colors;

				for (const segInfo of Array.from(segs)) {
					if (!segs.has(segInfo)) continue;
					const tempStart: Pos = { vhIdx: vstrand.num, bpIdx: segInfo.startBpIdx, strandIdx };
					const newOligo = new Oligo(part);
					const vh = vhByCadnanoNum.get(vstrand.num)!;
					const oligoSegment = new OligoSegment(part, vh, segInfo.startBpIdx, segInfo.endBpIdx);
					oligoSegment.skipsAndInserts = Array.from(segInfo.skipsAndLoops) ?? [];

					const thisColor = colors.find((c) => c[0] === segInfo.startBpIdx);
					const colorNum = thisColor ? thisColor[1] & 0xffffff : undefined;
					const colorString =
						colorNum !== undefined ? `#${colorNum.toString(16).padStart(6, '0')}` : undefined;
					newOligo.addSegment(oligoSegment);
					newOligo.color = colorString ?? newOligo.color;
					segs.delete(segInfo);

					if (segInfo.to) {
						extendThreePrime(
							part,
							vhByCadnanoNum,
							vsByNum,
							newOligo,
							oligoSegment,
							segInfo,
							tempStart
						);
					}

					const firstSegment = newOligo.segments.values().next().value;
					const lastSegment = Array.from(newOligo.segments).slice(-1)[0];
					lastSegment.threePrime.connectTo(firstSegment!.fivePrime);
					oligoSet.add(newOligo);
				}
			}
		}

		part.addOligosFromArray(Array.from(oligoSet));
		part.rebuildRspCaches();
	}

	static fromRegion(
		region: LatticedDesignRegion,
		part: Part
	): { json: CadnanoJSON; droppedCrossRegionConnections: number } {
		const regionVhs = part.virtualHelices.filter((vh) => vh.regionId === region.id);
		const regionVhIds = new Set(regionVhs.map((vh) => vh.id));
		const missingCoords = regionVhs.filter((vh) => !vh.latticeCoords);
		if (missingCoords.length > 0) {
			throw new Error(
				`Cannot export region "${region.name}": ${missingCoords.length} VH(s) lack latticeCoords.`
			);
		}

		// Helpers
		const makeEmptyNt = (): Nt => [-1, -1, -1, -1];
		const nextIndexFor = (strandIdx: 0 | 1, i: number) => (strandIdx === 0 ? i + 1 : i - 1);
		const prevIndexFor = (strandIdx: 0 | 1, i: number) => (strandIdx === 0 ? i - 1 : i + 1);
		const hexTo24bit = (c?: string): number | undefined => {
			if (!c) return undefined;
			const m = c.match(/^#([0-9a-fA-F]{6})$/);
			if (!m) return undefined;
			return parseInt(m[1], 16) & 0xffffff;
		};

		let droppedCrossRegion = 0;

		// Build VStrandJSONs for each VH in this region
		const vstrands: VStrandJSON[] = regionVhs
			.slice()
			.sort((a, b) => a.index - b.index)
			.map((vh) => {
				const L = vh.length;
				const scaf: Nt[] = Array.from({ length: L }, () => makeEmptyNt());
				const stap: Nt[] = Array.from({ length: L }, () => makeEmptyNt());
				const loop: number[] = new Array(L).fill(0);
				const skip: number[] = new Array(L).fill(0);
				// The importer currently reads `loop` and `skip`; keep per‑strand arrays too.
				const scaf_loop: number[] = new Array(L).fill(0);
				const stap_loop: number[] = new Array(L).fill(0);
				const stap_colors: Color[] = [];
				const scaf_colors: Color[] = [];

				const scafIdx = isScafToStrandSetIdx(vh.index, true) as 0 | 1;

				for (const strandIdx of [0, 1] as const) {
					const targetArr = strandIdx === scafIdx ? scaf : stap;
					const targetLoop = strandIdx === scafIdx ? scaf_loop : stap_loop;
					const targetColors = strandIdx === scafIdx ? scaf_colors : stap_colors;

					// Gather segments in this VH/strand (mirror oligos are repeat copies, not strands)
					for (const segId of vh.strandSets[strandIdx].segmentIds) {
						const seg = part.getSegmentById(segId);
						if (!seg || seg.oligo?.isMirror) continue;

						const fiveIdx = seg.fivePrime.index;
						const threeIdx = seg.threePrime.index;

						// Encode per-base connectivity
						const lo = Math.min(fiveIdx, threeIdx);
						const hi = Math.max(fiveIdx, threeIdx);
						for (let i = lo; i <= hi; i++) {
							const isFiveBase = i === fiveIdx;
							const isThreeBase = i === threeIdx;

							// Defaults: internal continuity within VH
							let fromVh = vh.index;
							let fromBp = prevIndexFor(strandIdx, i);
							let toVh = vh.index;
							let toBp = nextIndexFor(strandIdx, i);

							// 5' base: from = free or xover (drop if connected segment is in another region)
							if (isFiveBase) {
								const conn = seg.fivePrime.connectedSegment;
								if (conn && regionVhIds.has(conn.inVirtualHelix.id)) {
									fromVh = conn.inVirtualHelix.index;
									fromBp = conn.threePrime.index;
								} else {
									if (conn) droppedCrossRegion++;
									fromVh = -1;
									fromBp = -1;
								}
							}

							// 3' base: to = free or xover (drop if connected segment is in another region)
							if (isThreeBase) {
								const conn = seg.threePrime.connectedSegment;
								if (conn && regionVhIds.has(conn.inVirtualHelix.id)) {
									toVh = conn.inVirtualHelix.index;
									toBp = conn.fivePrime.index;
								} else {
									if (conn) droppedCrossRegion++;
									toVh = -1;
									toBp = -1;
								}
							}

							// Assign quadruple
							targetArr[i] = [fromVh, fromBp, toVh, toBp];
						}

						// Skips/loops on this strand
						for (const [bp, val] of seg.skipsAndInserts) {
							if (bp < 0 || bp >= L) continue;
							if (val > 0) {
								loop[bp] = val;
								targetLoop[bp] = val;
							} else if (val < 0) {
								skip[bp] = -1;
							}
						}
					}

					// Add color only at oligo 5' ends (or representative for circular oligos)
					// Build a set of oligos that have segments on this VH/strand.
					const oligosOnStrand = new Set<Oligo>();
					for (const segId of vh.strandSets[strandIdx].segmentIds) {
						const seg = part.getSegmentById(segId);
						if (seg?.oligo && !seg.oligo.isMirror) oligosOnStrand.add(seg.oligo);
					}
					for (const oligo of oligosOnStrand) {
						let colorSegment: OligoSegment | null = null;
						if (oligo.isCircular) {
							// Choose the segment on this VH/strand with smallest fivePrime index.
							for (const seg of oligo.segments) {
								if (seg.inVirtualHelix === vh && seg.inStrandIndex === strandIdx) {
									if (!colorSegment || seg.fivePrime.index < colorSegment.fivePrime.index) {
										colorSegment = seg;
									}
								}
							}
						} else {
							// Linear: find the segment whose fivePrime end is free (global 5' end).
							for (const seg of oligo.segments) {
								if (
									seg.inVirtualHelix === vh &&
									seg.inStrandIndex === strandIdx &&
									seg.fivePrime.isFree
								) {
									colorSegment = seg;
									break;
								}
							}
						}
						if (colorSegment) {
							const colorInt = hexTo24bit(oligo.color);
							if (colorInt !== undefined) {
								targetColors.push([colorSegment.fivePrime.index, colorInt]);
							}
						}
					}
				}

				const vs: VStrandJSON = {
					row: vh.latticeCoords!.row,
					col: vh.latticeCoords!.col,
					num: vh.index,
					scaf,
					stap,
					loop,
					skip,
					scafLoop: [], // matches upstream cadnano2's own convention; not used in cadnanoJSON export
					stapLoop: [], // matches upstream cadnano2's own convention; not used in cadnanoJSON export
					stap_colors,
					scaf_colors,
				};
				return vs;
			});

		return {
			json: new CadnanoJSON(part.name, vstrands),
			droppedCrossRegionConnections: droppedCrossRegion,
		};
	}
}

function extendThreePrime(
	part: Part,
	vhByIndex: Map<number, VirtualHelix>,
	vsByNum: Map<number, VStrand>,
	newOligo: Oligo,
	thisSegment: OligoSegment,
	segInfo: SegmentInfo,
	tempStart?: Pos | null
) {
	if (!segInfo.to) {
		return;
	}
	if (tempStart && areTwoPosEqual(tempStart, segInfo.to)) {
		return;
	}

	const nextVh = vhByIndex.get(segInfo.to.vhIdx);
	if (!nextVh) throw new Error(`VirtualHelix with index ${segInfo.to.vhIdx} not found.`);

	const nextVStrand = vsByNum.get(segInfo.to.vhIdx);
	if (!nextVStrand) throw new Error(`VStrand with num ${segInfo.to.vhIdx} not found.`);

	const nextSegmentInfo = nextVStrand.getSegmentStartAt(segInfo.to.strandIdx, segInfo.to.bpIdx);
	if (!nextSegmentInfo) {
		return;
	}

	const newSegment = new OligoSegment(
		part,
		nextVh,
		nextSegmentInfo.startBpIdx,
		nextSegmentInfo.endBpIdx
	);

	newSegment.skipsAndInserts = Array.from(nextSegmentInfo.skipsAndLoops) ?? [];
	thisSegment.threePrime.connectTo(newSegment.fivePrime);
	newOligo.addSegment(newSegment);

	nextVStrand.segments[segInfo.to.strandIdx].delete(nextSegmentInfo); // mark visited

	const canContinue =
		!tempStart || !nextSegmentInfo.to || !areTwoPosEqual(tempStart, nextSegmentInfo.to);
	if (nextSegmentInfo.to && canContinue) {
		extendThreePrime(part, vhByIndex, vsByNum, newOligo, newSegment, nextSegmentInfo, tempStart);
	}
}
