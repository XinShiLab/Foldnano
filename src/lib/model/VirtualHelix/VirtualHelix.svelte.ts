import OligoSegment from '../Oligo/OligoSegment.svelte';
import type { Part } from '../Part';
import StrandSet from './StrandSet.svelte';
import { v4 as uuidv4 } from 'uuid';
import type { VirtualHelixFrame } from '../geometry3d/dnaGeometry';

/**
 * from original cadnano documentation:
 * VirtualHelix is a container class for **two StrandSet** objects (one scaffold
 * and one staple). The Strands all share the same helix axis. It is called
 * "virtual" because many different Strands (i.e. sub-oligos) combine to
 * form the "helix", just as many fibers may be braided together to
 * form a length of rope.
 *
 * A virtualHelix with Even Parity has even index, the 1st strandSet (index 0) is the scaffold
 *
 */
export default class VirtualHelix {
	readonly id: string;
	index: number = 0; // index within the Part's virtual helix array
	inPart: Part; // the Part that contains this VirtualHelix
	listRow: number;
	regionId = $state<string | undefined>(undefined);
	latticeCoords = $state<{ row: number; col: number } | undefined>(undefined);
	localFrame = $state<VirtualHelixFrame | undefined>(undefined);
	strandSets: [StrandSet, StrandSet] = [new StrandSet(this, 0), new StrandSet(this, 1)]; // 0: left to right 5'→3', 1: right to left 3'←5'
	private _length: number;

	constructor(
		ownerPart: Part,
		index: number,
		listRow: number,
		length: number,
		row?: number,
		col?: number,
		id?: string
	) {
		this.inPart = ownerPart;
		this.id = id || uuidv4();
		this.listRow = $state(listRow);
		this.latticeCoords = row !== undefined && col !== undefined ? { row, col } : undefined;
		this._length = $state(length);
		this.index = index;
	}

	toJSON() {
		return {
			id: this.id,
			index: this.index,
			listRow: this.listRow,
			regionId: this.regionId,
			latticeCoords: this.latticeCoords,
			localFrame: this.localFrame,
			length: this.length,
			strandSets: this.strandSets.map((ss) => ss.toJSON()),
		};
	}

	static fromJSON(json: ReturnType<VirtualHelix['toJSON']>, inPart: Part): VirtualHelix {
		// Pre-Phase-3 documents have no id field; constructor generates a new UUID in that case.
		const vh = new VirtualHelix(
			inPart,
			json.index,
			json.listRow,
			json.length,
			json.latticeCoords?.row,
			json.latticeCoords?.col,
			json.id
		);
		vh.strandSets = json.strandSets.map((ssJson) => StrandSet.fromJSON(ssJson, vh)) as [
			StrandSet,
			StrandSet,
		];
		vh.regionId = json.regionId;
		if (json.localFrame) vh.localFrame = json.localFrame;
		return vh;
	}

	get isEvenParity(): boolean {
		if (!this.latticeCoords) throw new Error('VH has no latticeCoords (freeform VH)');
		return this.latticeCoords.row % 2 === this.latticeCoords.col % 2;
	}

	get isOddParity(): boolean {
		if (!this.latticeCoords) throw new Error('VH has no latticeCoords (freeform VH)');
		return !!((this.latticeCoords.row % 2) ^ (this.latticeCoords.col % 2));
	}

	get scaffoldStrandIndex(): 0 | 1 {
		return this.isEvenParity ? 0 : 1;
	}

	get length(): number {
		return this._length;
	}

	set length(newLength: number) {
		// for now new length must be longer than current length
		// if (newLength < this.length) {
		//   throw new Error('Decreasing VirtualHelix length not supported yet.');
		// }
		this._length = newLength;
	}

	get usedLength(): number {
		let maxUsedIndex = 0;
		for (const strandSet of this.strandSets) {
			for (const id of strandSet.segmentIds) {
				const segment = this.inPart.getSegmentById(id);
				if (!segment) continue;
				const maxIdx = Math.max(segment.fivePrime.index, segment.threePrime.index);
				if (maxIdx > maxUsedIndex) {
					maxUsedIndex = maxIdx;
				}
			}
		}
		return maxUsedIndex;
	}

	get scaffoldStrandSet(): StrandSet {
		return this.strandSets[this.scaffoldStrandIndex];
	}

	/**  this is equivalent to new OligoSegment() */
	createNewSegment(fivePrimeEndIndex: number, threePrimeEndIndex: number, id?: string) {
		if (id && this.inPart.getSegmentById(id)) {
			throw new Error(`Segment id ${id} already exists in Part ${this.inPart.id}`);
		}
		if (
			fivePrimeEndIndex < 0 ||
			threePrimeEndIndex < 0 ||
			fivePrimeEndIndex >= this.length ||
			threePrimeEndIndex >= this.length
		) {
			throw new Error('Segment end indices out of bounds.');
		}
		if (fivePrimeEndIndex === threePrimeEndIndex) {
			throw new Error('Segment must have > 1 length.');
		}
		const newSegment = new OligoSegment(
			this.inPart,
			this,
			fivePrimeEndIndex,
			threePrimeEndIndex,
			id
		);
		this.strandSets[newSegment.inStrandIndex].segmentIds.add(newSegment.id);
		return newSegment;
	}

	removeSegment(segment: OligoSegment) {
		// test if the given segment is in this virtual helix
		if (segment.inVirtualHelix !== this) {
			throw new Error('OligoSegment does not belong to this VirtualHelix.');
		}
		// console.log('Removing segment', segment.id, 'from VirtualHelix', this.index);
		this.strandSets[segment.inStrandIndex].segmentIds.delete(segment.id);
	}
}
