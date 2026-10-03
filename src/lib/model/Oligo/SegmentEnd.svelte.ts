import type OligoSegment from './OligoSegment.svelte';
import type VirtualHelix from '../VirtualHelix';
import type { NtIndices, Part, RspCoord } from '../Part/Part.svelte';
import { InvalidOperationError } from '../../errors';

/** Whether `end` can sit at `candidateIdx` while its segment's other end stays at `otherIdx`.
 * Equal is rejected: a 1-bp segment has no 5'→3' direction, so `inStrandIndex` can't tell its
 * strand (it would read as strand 1), and 1-nt strands aren't a valid design element anyway. */
export function keepsSegmentDirection(
	end: SegmentEnd,
	candidateIdx: number,
	otherIdx: number
): boolean {
	const ascending = end.inStrandIndex === 0;
	return end.isThreePrime === ascending ? candidateIdx > otherIdx : candidateIdx < otherIdx;
}

export class SegmentEnd {
	readonly inPart: Part;
	readonly segmentId: string;
	#segment: OligoSegment;
	readonly isThreePrime: boolean = false;
	// protected _index: number; // index on the virtual helix
	// protected _connectedSegment: OligoSegment | null = null;

	/** index within the VH (or say StrandSet) */
	protected _index = $state<number>(0);
	protected _connectedSegmentId = $state<string | null>(null);
	modification: string | null = $state<string | null>(null);

	/** debounce flag for slot sync after index change */
	private _pendingSlotSync = false;

	private _scheduleSlotSync(): void {
		if (this._pendingSlotSync) return;
		this._pendingSlotSync = true;

		// In Vitest environment, run synchronously to avoid missing microtask flushes in tests.
		if (typeof process !== 'undefined' && process.env?.VITEST_WORKER_ID) {
			this._pendingSlotSync = false;
			this.segment.updateSlotsAfterEndMove?.();
			return;
		}

		// Fallback to microtask scheduling across environments.
		Promise.resolve().then(() => {
			this._pendingSlotSync = false;
			this.segment.updateSlotsAfterEndMove?.();
		});
	}

	/** Ends that connect to an spatially adjacent segment, they have to move together. and only to potential Xover sites to maintain the adjacency */
	// isConstrained: boolean = $state<boolean>(false);
	isConstrained: boolean = $derived.by<boolean>(() => {
		if (this.connectedEnd === null) return false;
		return this.inPart.canEndsBeConstrained(this, this.connectedEnd);
	});

	constructor(inPart: Part, segment: OligoSegment, isThreePrime: boolean, index: number) {
		this.inPart = inPart;
		this.segmentId = segment.id;
		this.#segment = segment;
		this.isThreePrime = isThreePrime;
		this._index = index;
	}

	toJSON() {
		return {
			segmentId: this.segmentId,
			isThreePrime: this.isThreePrime,
			index: this._index,
			connectedSegmentId: this._connectedSegmentId,
			modification: this.modification,
			isConstrained: this.isConstrained,
		};
	}

	get _connectedSegment(): OligoSegment | null {
		if (this._connectedSegmentId === null) {
			return null;
		}
		return this.inPart.getSegmentById(this._connectedSegmentId);
	}

	get connectedEnd(): SegmentEnd | null {
		if (this._connectedSegment === null) {
			return null;
		}
		if (this.isThreePrime) {
			return this._connectedSegment.fivePrime;
		} else {
			return this._connectedSegment.threePrime;
		}
	}

	get ntIndices(): NtIndices {
		return {
			vhIdx: this.#segment.inVirtualHelix.index,
			rowIdx: this.#segment.inVirtualHelix.listRow,
			strandIdx: this.#segment.inStrandIndex,
			bpIdx: this._index,
		};
	}

	/** rowIdx is listRow (model position), not a display/view row. */
	get modelCoord(): RspCoord {
		return {
			rowIdx: this.#segment.inVirtualHelix.listRow,
			strandIdx: this.#segment.inStrandIndex,
			bpIdx: this._index,
		};
	}

	/** return index that is 1nt from the end, on the same segment */
	get minus1Index(): number {
		if (this.isThreePrime) {
			return this._index - (this.#segment.inStrandIndex === 0 ? 1 : -1);
		} else {
			return this._index + (this.#segment.inStrandIndex === 0 ? 1 : -1);
		}
	}

	get segment(): OligoSegment {
		return this.#segment;
	}

	get index(): number {
		return this._index;
	}

	set index(newIndex: number) {
		if (!this.canMoveTo(newIndex, true)) {
			throw new InvalidOperationError(
				`Cannot move: position ${this.inVirtualHelix.index}[${newIndex}] isn't a valid destination for this end (occupied, out of bounds, or not a matching crossover site).`
			);
		}
		// console.log(`Setting index of ${this.inVirtualHelix}[${this.index}] to ${newIndex}`);
		const prev = this._index;
		this._index = newIndex;
		if (
			this.isConstrained &&
			this.connectedEnd &&
			this.connectedEnd.isConstrained &&
			this.connectedEnd.index !== newIndex
		) {
			// propagate constrained move
			this.connectedEnd.index = newIndex;
		}
		if (prev !== newIndex) this._scheduleSlotSync();
	}

	canMoveTo(newIndex: number, _looseRules: boolean = false, ignoreSegment?: OligoSegment): boolean {
		// bounds
		if (newIndex < 0 || newIndex >= this.segment.inVirtualHelix.length) return false;
		// check if new index is occupied in the StrandSet
		const occupiedBy = this.segment.ownerStrandSet.isRangeOccupiedBy(this._index, newIndex);
		if (occupiedBy instanceof Set) {
			occupiedBy.delete(this.segment);
			// ignore occupancy by the segment being merged into
			if (ignoreSegment) occupiedBy.delete(ignoreSegment);
			if (occupiedBy.size > 0) {
				console.error(
					`Cannot move: position ${this.inVirtualHelix.index}[${newIndex}] occupied by other segments`,
					occupiedBy
				);
				return false;
			}
		}
		const oppositeEnd = this.isThreePrime ? this.segment.fivePrime : this.segment.threePrime;
		if (!keepsSegmentDirection(this, newIndex, oppositeEnd.index)) return false;

		// potential crossover site check not implemented yet

		// if the current end is constrained, then only allow to move to another potential crossover site that maintains the adjacency
		// if the current potential crossover site isRight, the new one must also be isRight, same for isLeft
		if (this.isConstrained) {
			const part = this.inPart;
			const otherEnd = this.connectedEnd;
			if (otherEnd === null) {
				throw new Error('Inconsistent state: isConstrained is true but connectedEnd is null');
			}

			const allPotentialXoverSitesInVh = part.potentialXoverSites(this.inVirtualHelix.index)[
				this.inStrandIndex
			];
			const isCurrentRight = allPotentialXoverSitesInVh.find(
				(site) => site.bpIdx === this.index
			)?.right;
			const isNewIdxPotentialXoverSite = allPotentialXoverSitesInVh.find(
				(site) =>
					site.bpIdx === newIndex &&
					site.toVhIdx === otherEnd.inVirtualHelix.index &&
					site.right === isCurrentRight
			);
			if (!isNewIdxPotentialXoverSite) {
				// console.log('Cannot move: not a valid potential crossover site maintaining adjacency direction');
				return false;
			}

			// 	if (
			// 		!part.isConnectionConstrained(
			// 			{
			// 				vhIdx: this.segment.inVirtualHelix.index,
			// 				strandIdx: this.segment.inStrandIndex,
			// 				bpIdx: newIndex
			// 			},
			// 			{
			// 				vhIdx: otherEnd.segment.inVirtualHelix.index,
			// 				strandIdx: otherEnd.segment.inStrandIndex,
			// 				bpIdx: otherEnd.index
			// 			}
			// 		)
			// 	) {
			//     console.log('Cannot move: constrained to maintain adjacency');
			// 		return false;
			// 	}
			// }
		}

		return true;
	}

	/** Set this end's index without scheduling a slot-sync and without propagating to a crossover
	 * partner — for a Part-driven multi-end move (e.g. translating a whole segment, or a batch of
	 * crossover-connected segments together) that will resync slots itself once every end
	 * involved has settled. `canMoveTo`'s constrained-end check only reads the partner's *VH
	 * identity* (stable) and this end's own pre-move index, never the partner's live position, so
	 * it's safe to validate and move a constrained end this way regardless of processing order —
	 * but the caller is responsible for also moving the connected partner end to this same
	 * `newIndex` (typically because it's independently being translated by the same delta in the
	 * same batch); this method does not do that for you. */
	moveIndexWithoutSlotSync(newIndex: number): void {
		if (!this.canMoveTo(newIndex, true)) {
			throw new InvalidOperationError(
				`Cannot move: position ${this.inVirtualHelix.index}[${newIndex}] isn't a valid destination for this end (occupied, out of bounds, or not a matching crossover site).`
			);
		}
		this._index = newIndex;
	}

	// Set index specifically for merge operations: ignore occupancy by the merged segment and keep slot sync behavior.
	protected _setIndexByMerge(newIndex: number, mergedSegment: OligoSegment): void {
		if (!this.canMoveTo(newIndex, true, mergedSegment)) {
			throw new Error(
				`Cannot merge: invalid move from ${this.inVirtualHelix.index}[${this.index}] to ${newIndex}`
			);
		}
		const prev = this._index;
		this._index = newIndex;
		// propagate constrained move if applicable
		if (
			this.isConstrained &&
			this.connectedEnd &&
			this.connectedEnd.isConstrained &&
			this.connectedEnd.index !== newIndex
		) {
			this.connectedEnd._index = newIndex; // direct set to avoid recursive validation during merge
			this.connectedEnd._scheduleSlotSync?.();
		}
		if (prev !== newIndex) this._scheduleSlotSync();
	}

	isIndexOccupied(newIndex: number) {
		// check if new index is occupied in the StrandSet
		if (this.#segment.ownerStrandSet.isRangeOccupied(this._index, newIndex)) {
			throw new Error('Cannot set index: position occupied in StrandSet');
		}
		this._index = newIndex;
	}

	get connectedSegment(): OligoSegment | null {
		return this._connectedSegment;
	}

	get inVirtualHelix(): VirtualHelix {
		return this.#segment.inVirtualHelix;
	}

	get inStrandIndex(): 0 | 1 {
		return this.#segment.inStrandIndex;
	}

	get isFree(): boolean {
		return this._connectedSegment === null;
	}

	/** disconnect method takes care of clearing the connection of the other connected segments */
	disconnect(): void {
		if (this._connectedSegment === null) {
			return;
		}
		const otherSegment = this._connectedSegment;
		// Clear the connection on both ends
		this._connectedSegmentId = null;
		if (this.isThreePrime) {
			otherSegment.fivePrime._connectedSegmentId = null;
		} else {
			otherSegment.threePrime._connectedSegmentId = null;
		}

		this.isConstrained = false;
	}

	isAdjacentTo(otherEnd: SegmentEnd): boolean {
		if (this.#segment.inVirtualHelix !== otherEnd.#segment.inVirtualHelix) {
			return false;
		}
		if (this.#segment.inStrandIndex !== otherEnd.#segment.inStrandIndex) {
			return false;
		}
		return Math.abs(this.index - otherEnd.index) === 1;
	}

	// canMoveTo(newIndex: number): boolean {
	// 	const occupiedBy = this.segment.ownerStrandSet.isIndexOccupiedBy(newIndex);

	// 	if (occupiedBy && occupiedBy !== this.segment) {
	// 		return false;
	// 	}
	// 	if (newIndex < 0 || newIndex >= this.segment.inVirtualHelix.length) {
	// 		return false;
	// 	}
	// 	if (this.isThreePrime) {
	// 		if (this.segment.inStrandIndex === 0 && newIndex <= this.segment.fivePrime.index) {
	// 			return false;
	// 		}
	// 		if (this.segment.inStrandIndex === 1 && newIndex >= this.segment.fivePrime.index) {
	// 			return false;
	// 		}
	// 	} else {
	// 		if (this.segment.inStrandIndex === 0 && newIndex >= this.segment.threePrime.index) {
	// 			return false;
	// 		}
	// 		if (this.segment.inStrandIndex === 1 && newIndex <= this.segment.threePrime.index) {
	// 			return false;
	// 		}
	// 	}
	// 	return true;
	// }
}

export class ThreePrimeEnd extends SegmentEnd {
	constructor(inPart: Part, segment: OligoSegment, index: number) {
		super(inPart, segment, true, index);
	}

	static fromJSON(json: ReturnType<SegmentEnd['toJSON']>, segment: OligoSegment): ThreePrimeEnd {
		const end = new ThreePrimeEnd(segment.inPart, segment, json.index);
		end._connectedSegmentId = json.connectedSegmentId;
		end.modification = json.modification;
		end.isConstrained = json.isConstrained;
		return end;
	}

	get connectedSegment(): OligoSegment | null {
		return this._connectedSegment;
	}

	set connectedSegment(otherSegment: OligoSegment | null) {
		if (this._connectedSegment !== null && otherSegment !== null) {
			throw new Error('This end is already connected to another segment');
		}
		if (otherSegment === null) {
			this.disconnect();
			return;
		}
		this.connectTo(otherSegment.fivePrime);
	}

	connectTo(otherEnd: SegmentEnd): void {
		// connectTo should not work if the otherEnd is on the same segment
		if (otherEnd.segment === this.segment) {
			throw new Error(
				`Cannot connect segment end to another end on the same segment: ${this.inVirtualHelix.index}[${this.index}] -> ${otherEnd.inVirtualHelix.index}[${otherEnd.index}]`
			);
		}

		// connectTo method takes care of setting both ends' connectedSegment properties

		if (this._connectedSegment !== null) {
			throw new Error(
				`this end ${this.segment}[${this.isThreePrime ? "3'" : "5'"}}] is already connected to something else`
			);
		}
		if (!(otherEnd instanceof FivePrimeEnd)) {
			throw new Error('Can only connect ThreePrimeEnd to FivePrimeEnd');
		}
		this._connectedSegmentId = otherEnd.segment.id;
		otherEnd.connectedSegment = this.segment;

		// only Part can decide whether the ends are constrained
		// const part = this.inPart;
		// if (part.canEndsBeConstrained(this, otherEnd)) {
		//   this.isConstrained = true;
		//   otherEnd.isConstrained = true;
		// }
	}

	mergeTo(otherEnd: SegmentEnd): void {
		if (!(otherEnd instanceof FivePrimeEnd)) {
			throw new Error('Can only merge ThreePrimeEnd to FivePrimeEnd');
		}
		// Move this end to the other segment's 3' index, ignoring occupancy caused by the segment being merged
		this._setIndexByMerge(otherEnd.segment.threePrime.index, otherEnd.segment);

		// Segment-level takeover of slots/sequences from the merged segment
		// Implement takeOverSlotsFrom in OligoSegment to reassign sequences/slots from source to target.
		this.segment.takeOverSlotsFrom?.(otherEnd.segment);

		// Ensure slots are consistent after the move and takeover
		this.segment.updateSlotsAfterEndMove?.();

		// Fix connections: preserve adjacency if the merged segment was connected further
		const nextSeg = otherEnd.segment.threePrime.connectedSegment;
		if (nextSeg) {
			nextSeg.fivePrime.disconnect();
			this.connectTo(nextSeg.fivePrime);
		}

		// Finally remove the merged segment from the oligo
		otherEnd.segment.oligo?.removeEndSegment(otherEnd.segment);
	}
}

export class FivePrimeEnd extends SegmentEnd {
	constructor(inPart: Part, segment: OligoSegment, index: number) {
		super(inPart, segment, false, index);
	}

	static fromJSON(json: ReturnType<SegmentEnd['toJSON']>, segment: OligoSegment): FivePrimeEnd {
		const end = new FivePrimeEnd(segment.inPart, segment, json.index);
		end._connectedSegmentId = json.connectedSegmentId;
		end.modification = json.modification;
		end.isConstrained = json.isConstrained;
		return end;
	}

	get connectedSegment(): OligoSegment | null {
		return this._connectedSegment;
	}

	set connectedSegment(otherSegment: OligoSegment | null) {
		if (this._connectedSegment !== null && otherSegment !== null) {
			throw new Error('This end is already connected to another segment');
		}
		if (otherSegment === null) {
			this.disconnect();
			return;
		}
		// throw new Error('FivePrimeEnd can only be connected from ThreePrimeEnd, cannote initiate connection');
		this._connectedSegmentId = otherSegment.id;
	}
}
