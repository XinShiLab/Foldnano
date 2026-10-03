import { v4 as uuidv4 } from 'uuid';
// import Strand from "./Strand";

import OligoSegment from './OligoSegment.svelte';
import type VirtualHelix from '../VirtualHelix';
import { SvelteSet } from 'svelte/reactivity';
import type { Part } from '../Part';
import type { SegmentEnd } from './SegmentEnd.svelte';
import { generateRandomOKLCHColor } from '../colorGenerator';
import { generateRandomDNA } from '../sequences/sequences'; // added

// export const CONNECT_OLIGOS = Symbol('CONNECT_OLIGOS')

/** Marks an oligo as a mirror: a derived copy of `sourceOligoId` shifted by its repeat
 * instance's offset. `structure` is its shift-normalized structural fingerprint when it was
 * generated, so a direct edit to the mirror can be told apart from a change to its source. */
export interface MirrorTag {
	groupId: string;
	instanceId: string;
	sourceOligoId: string;
	structure: string;
}

export default class Oligo {
	/**
	 *
	 * Oligo is a group of OligoSegments that are connected via 5' and/or 3'
	 * connections. It corresponds to the physical DNA strand, and is thus
	 * used tracking and storing properties that are common to a single strand,
	 * such as its color.
	 *
	 * Operations should be applied on a oligo level, and oligo will manage its segments.
	 * Hence only Oligo should be export in index.ts
	 */

	// strands: Strand[] = []; // we now use segments instead of strands
	id: string;
	// segments: OligoSegment[] = [];
	// color: string = '#FFA500'; // default orange color // later should move color information to another dedicated class, it is not part of the model
	segments = $state<SvelteSet<OligoSegment>>(new SvelteSet());
	color = $state<string>('#FFA500'); // default orange color // later should move color information to another dedicated class, it is not part of the model
	isScaffold = $state<boolean>(false);
	isSequenceLocked = $state<boolean>(false);
	name = $state<string>(''); // optional name for the oligo
	/** Set on the originals of a repeat group (see docs/repeat-units.md). */
	repeatGroupId = $state<string | null>(null);
	mirrorOf = $state.raw<MirrorTag | null>(null);
	readonly inPart: Part;

	// new oligo can only have one segment at the start
	constructor(part: Part, id?: string, newSegment?: OligoSegment, color?: string) {
		// const newSegment = new OligoSegment(inVirtualHelix, inStrand, startNtIndex, endNtIndex);
		this.id = id || uuidv4();
		this.inPart = part;
		if (newSegment) this.segments.add(newSegment);
		this.color = color ?? generateRandomOKLCHColor();
	}

	toJSON() {
		return {
			id: this.id,
			segments: Array.from(this.segments).map((segment) => segment.toJSON()),
			color: this.color,
			isScaffold: this.isScaffold,
			isSequenceLocked: this.isSequenceLocked,
			name: this.name,
			// Omitted when unset so files without repeat groups serialize exactly as before.
			...(this.repeatGroupId ? { repeatGroupId: this.repeatGroupId } : {}),
			...(this.mirrorOf ? { mirrorOf: { ...this.mirrorOf } } : {}),
		};
	}

	get isMirror(): boolean {
		return this.mirrorOf !== null;
	}

	static fromJSON(json: ReturnType<Oligo['toJSON']>, inPart: Part): Oligo {
		const oligo = new Oligo(inPart, json.id);
		// oligo.id = json.id;
		oligo.color = json.color;
		oligo.isScaffold = json.isScaffold;
		oligo.isSequenceLocked = json.isSequenceLocked;
		oligo.name = json.name;
		oligo.repeatGroupId = json.repeatGroupId ?? null;
		oligo.mirrorOf = json.mirrorOf ?? null;
		for (const segmentJson of json.segments) {
			const segment = OligoSegment.fromJSON(segmentJson, inPart);
			oligo.segments.add(segment);
		}
		return oligo;
	}

	static createNewOligo(
		inPart: Part,
		inVirtualHelix: VirtualHelix,
		fivePrimeEndIndex: number,
		threePrimeEndIndex: number,
		color?: string,
		oligoId?: string,
		segmentId?: string
	): Oligo {
		if (oligoId && inPart.getOligoById(oligoId)) {
			throw new Error(`Oligo id ${oligoId} already exists in Part ${inPart.id}`);
		}
		const newSegment = inVirtualHelix.createNewSegment(
			fivePrimeEndIndex,
			threePrimeEndIndex,
			segmentId
		);
		const newId = oligoId || uuidv4();
		const newOligo = new Oligo(inPart, newId, newSegment, color);
		return newOligo;
	}

	get threePrimeEndSegment(): OligoSegment | null {
		for (const segment of this.segments) {
			if (segment.threePrime.isFree) {
				return segment;
			}
		}
		return null;
	}

	get fivePrimeEndSegment(): OligoSegment | null {
		for (const segment of this.segments) {
			if (segment.fivePrime.isFree) {
				return segment;
			}
		}
		return null;
	}

	get threePrime() {
		const segment = this.threePrimeEndSegment;
		return segment ? segment.threePrime : null;
	}

	get fivePrime() {
		const segment = this.fivePrimeEndSegment;
		return segment ? segment.fivePrime : null;
	}

	/** allEnds returns all ends in a oligo, including freeEnds and connected ends */
	get allEnds(): Set<SegmentEnd> {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const ends = new Set<SegmentEnd>();
		this.segments.forEach((segment) => {
			ends.add(segment.fivePrime);
			ends.add(segment.threePrime);
		});
		return ends;
	}

	get freeEnds(): Set<SegmentEnd> {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const ends = new Set<SegmentEnd>();
		const threePrime = this.threePrime;
		if (threePrime) ends.add(threePrime);
		const fivePrime = this.fivePrime;
		if (fivePrime) ends.add(fivePrime);
		return ends;
	}

	get isCircular(): boolean {
		// an oligo is circular if it does not have any free 5' or 3' ends and 5'-end or 3'-end segments
		return this.fivePrimeEndSegment === null && this.threePrimeEndSegment === null;
	}

	get length(): number {
		let totalLength = 0;
		for (const segment of this.segments) {
			totalLength += segment.length;
		}
		return totalLength;
	}
	// clearSegments() {
	//   this.segments.clear();
	// }

	get sequence(): string {
		// concatenate sequences of all segments in this oligo
		let seq = '';
		let nextSegment: OligoSegment | null = this.fivePrimeEndSegment;
		while (nextSegment) {
			seq += nextSegment.sequence;
			nextSegment = nextSegment.threePrime.connectedSegment;
			if (nextSegment === this.fivePrimeEndSegment) {
				// circular oligo, stop here
				break;
			}
		}
		// for (const segment of this.segments) {
		//   seq += segment.sequence;
		// }
		return seq;
	}

	addSegment(newSegment: OligoSegment): void {
		if (!this.segments.has(newSegment)) {
			this.segments.add(newSegment);
		}
	}

	// this is wrong because removing a segment in the middle will create two new oligos, this should be handled in Part

	// removeSegment(segmentToRemove: OligoSegment): void {
	//   // first check if the segment belongs to this oligo
	//   if (!this.segments.has(segmentToRemove)) {
	//     throw new Error("The segment doesn't belong to this oligo");
	//   }
	//   // disconnect this segment from any connections
	//   segmentToRemove.fivePrime.disconnect();
	//   segmentToRemove.threePrime.disconnect();

	//   // remove the segment from this oligo
	//   this.segments.delete(segmentToRemove);
	//   segmentToRemove.destroy();
	// }

	/** A Oligo can only remove its end Segment, because this doesn't create new oligos. Removing segments in the middle will create two oligos,
	 *  therefore it should be handled in Part.
	 */
	removeEndSegment(endSegment: OligoSegment): void {
		// first check if the segment belongs to this oligo
		if (!this.segments.has(endSegment)) {
			throw new Error("The segment doesn't belong to this oligo");
		}
		// check if the segment is an end segment
		if (!endSegment.fivePrime.isFree && !endSegment.threePrime.isFree) {
			throw new Error('The segment is not an end segment');
		}
		// disconnect this segment from any connections
		endSegment.fivePrime.disconnect();
		endSegment.threePrime.disconnect();

		// remove the segment from this oligo
		this.segments.delete(endSegment);
		endSegment.destroy();
	}

	// this is wrong because removing a segment in the middle will create two new oligos, this should be handled in Part
	// private removeSegment(segmentToRemove: OligoSegment) {
	// 	// first check if the segment belongs to this oligo
	// 	if (!this.segments.has(segmentToRemove)) {
	// 		throw new Error("The segment doesn't belong to this oligo");
	// 	}
	// 	// disconnect this segment from any connections
	// 	segmentToRemove.fivePrime.disconnect();
	// 	segmentToRemove.threePrime.disconnect();

	// 	// remove the segment from this oligo
	// 	this.segments.delete(segmentToRemove);
	// 	segmentToRemove.destroy();
	// }

	destroy() {
		//clear all segments in this oligo

		// remove each segments from their Vh
		for (const segment of this.segments) {
			segment.destroy();
		}

		// do not use .remove() because it will also remove connections on those segments even if they are connected to other oligos already
		this.segments.clear();

		// oligo needs to be removed from its owning part from Part
	}

	private addConnectedSegmentsFrom3Prime(startSegment: OligoSegment): void {
		// if (!this.segments.has(startSegment)) {
		// 	this.segments.add(startSegment);
		// }
		let currentSegment: OligoSegment | null = startSegment.threePrime.connectedSegment;

		// add until the currentSegment is null or already in this.segments
		while (currentSegment && !this.segments.has(currentSegment)) {
			const originalOligo = currentSegment.oligo;
			if (originalOligo && originalOligo !== this) {
				originalOligo.segments.delete(currentSegment);
			}
			this.segments.add(currentSegment);
			// remove current segment from its original oligo

			const nextSegment: OligoSegment | null = currentSegment.threePrime.connectedSegment;
			currentSegment = nextSegment;
		}
	}

	/** This implementation assumes connections are always made from the 3' end of this oligo to the 5' end of the other oligo.
	 * It also handles the case where the other oligo is the same as this oligo (circularization).
	 * Note: This oligo remains the primary one, while `otherOligo` will be cleared.
	 * The caller is responsible for removing `otherOligo` from any associated Part. */
	connectOligos(otherOligo: Oligo) {
		if (!this.threePrime || !otherOligo.fivePrime) {
			throw new Error('Both oligos must have free ends to connect.');
		}

		// Connecting oligos is a structural change that should unlock sequences
		this.isSequenceLocked = false;
		if (otherOligo !== this) {
			otherOligo.isSequenceLocked = false;
		}

		// const this3PrimeEndSegRef = this.threePrimeEndSegment;
		const this3PrimeSegRef = this.threePrime.segment;

		if (this.threePrime.isAdjacentTo(otherOligo.fivePrime)) {
			// merge segments (mergeTo will also unlock via addSlot, but we already unlocked above)
			this.threePrime.mergeTo(otherOligo.fivePrime);
		} else {
			// console.log('orinal segments in oligoA:', Array(...this.segments).map((seg) => {
			// 	return {
			// 		threePrimeEnd: seg.threePrime.index,
			// 		threePrimeConnectedSegment: seg.threePrime.connectedSegment?.id,
			// 		fivePrimeEnd: seg.fivePrime.index,
			// 		fivePrimeConnectedSegment: seg.fivePrime.connectedSegment?.id
			// 	}
			// }));
			//
			// // just connect
			this.threePrime.connectTo(otherOligo.fivePrime);

			// console.log(' segments in oligoA after connection:', Array(...this.segments).map((seg) => {
			// 	return {
			// 		threePrimeEnd: seg.threePrime.index,
			// 		threePrimeConnectedSegment: seg.threePrime.connectedSegment?.id,
			// 		fivePrimeEnd: seg.fivePrime.index,
			// 		fivePrimeConnectedSegment: seg.fivePrime.connectedSegment?.id
			// 	}
			// }));
		}

		// Self-connection (circularization): nothing to import or delete
		if (otherOligo === this) {
			return;
		}

		// add all segments in otherOligo to this oligo
		this.addConnectedSegmentsFrom3Prime(this3PrimeSegRef);

		// console.log('segments in oligoA after adding new segments:', Array(...this.segments).map((seg) => {
		// 	return {
		// 		threePrimeEnd: seg.threePrime.index,
		// 		threePrimeConnectedSegment: seg.threePrime.connectedSegment?.id,
		// 		fivePrimeEnd: seg.fivePrime.index,
		// 		fivePrimeConnectedSegment: seg.fivePrime.connectedSegment?.id
		// 	}
		// }));

		return this;
		// The caller (methods in Part) is responsible for removing `otherOligo` from any associated Part.
	}

	/* break this oligo at the given segment and index, return new oligo created at the broken end
	 * if this oligo is circular, breaking at one segment doesn't creates two new oligos
	 * if this oligo is not circular, create new oligo with newSegment and add all connected segments to it
	 */
	breakOligoAt(segment: OligoSegment, index: number, opts?: { newOligoId?: string }): Oligo {
		const isOldOligoCircular = this.isCircular; // check if this oligo is circular before breaking

		// if ths is a free end of this oligo, do nothing
		if (
			(segment === this.fivePrimeEndSegment && index === segment.fivePrime.index) ||
			(segment === this.threePrimeEndSegment && index === segment.threePrime.index) ||
			(Math.abs(segment.threePrime.index - index) === 1 && segment.threePrime.isFree)
			// ||
			// (Math.abs(segment.fivePrime.index -index) === 1 && segment.fivePrime.isFree)
		) {
			return this;
		}

		// breakSegmentAt handles crossover connections: transfers the 3' connection to the
		// new stub segment and disconnects/returns the connected segment when breaking at an end.

		const newSegment = segment.breakSegmentAt(index);

		if (!newSegment) {
			// no new segment created, return this oligo
			return this;
		}
		// if oligo is circular, breaking at one segment doesn't creates two new oligos
		if (isOldOligoCircular) {
			this.addSegment(newSegment);
			return this;
		}

		// if this oligo is not circular, create new oligo with newSegment
		const newId = opts?.newOligoId ?? uuidv4();
		const newOligo = new Oligo(this.inPart, newId, newSegment, '#26bf40');
		newOligo.repeatGroupId = this.repeatGroupId;

		// add all segments that are connected to newSegment to newOligo
		newOligo.addConnectedSegmentsFrom3Prime(newSegment);

		// remove newOligo segments from this oligo
		// this.segments = this.segments.filter((segment) => !newOligo.segments.includes(segment));
		for (const seg of newOligo.segments) {
			this.segments.delete(seg);
		}
		return newOligo;

		// add newOligo to part - handled by caller
	}

	fillSequence(
		sequence: string,
		lockSequence: boolean = false,
		onlyEmpty: boolean = false
	): { leftover: string; missing: number } {
		// Fill across segments in true 5'->3' oligo order, mirroring get sequence traversal.
		const needed = this.length;
		if (needed === 0) return { leftover: sequence, missing: 0 };

		let remaining = sequence;

		// Start from the free 5' end; if none (circular), do not fill.
		const start = this.fivePrimeEndSegment;
		if (!start) {
			return { leftover: sequence, missing: needed };
		}

		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const visited = new Set<OligoSegment>();
		let seg: OligoSegment | null = start;

		if (onlyEmpty) {
			let totalMissing = 0;
			while (seg && !visited.has(seg)) {
				visited.add(seg);
				const { leftover, missing } = seg.fillSequence(remaining, true);
				remaining = leftover;
				totalMissing += missing;
				seg = seg.threePrime.connectedSegment;
			}
			if (lockSequence) this.isSequenceLocked = true;
			return { leftover: remaining, missing: totalMissing };
		}

		while (seg && !visited.has(seg) && remaining.length > 0) {
			visited.add(seg);
			const { leftover, missing } = seg.fillSequence(remaining);
			remaining = leftover;
			// If this segment couldn't be fully filled, stop here.
			if (missing > 0) break;
			seg = seg.threePrime.connectedSegment;
		}

		const applied = sequence.length - remaining.length;
		const missing = Math.max(0, needed - applied);

		if (lockSequence) {
			this.isSequenceLocked = true;
		}
		return { leftover: remaining, missing };
	}

	fillRandomSequence(gcContent: number = 0.5, onlyEmpty = false): string {
		if (onlyEmpty) {
			const start = this.fivePrimeEndSegment;
			if (!start) return '';
			let emptyCount = 0;
			// eslint-disable-next-line svelte/prefer-svelte-reactivity
			const visited = new Set<OligoSegment>();
			let seg: OligoSegment | null = start;
			while (seg && !visited.has(seg)) {
				visited.add(seg);
				emptyCount += seg.slots
					.filter((s) => s.seq.length > 0 && /^N+$/.test(s.seq))
					.reduce((a, s) => a + s.seq.length, 0);
				seg = seg.threePrime.connectedSegment;
			}
			if (emptyCount === 0) return '';
			const random = generateRandomDNA(emptyCount, gcContent);
			const seq = random.primary5to3;
			this.fillSequence(seq, false, true);
			return seq;
		}
		const needed = this.length;
		if (needed === 0) return '';
		const random = generateRandomDNA(needed, gcContent);
		const seq = random.primary5to3;
		const { leftover, missing } = this.fillSequence(seq);
		if (missing !== 0 || leftover.length !== 0) {
			throw new Error('Unexpected incomplete fill in fillRandomSequence');
		}
		return seq;
	}

	/** this method update oligo's own sequence without changing the complementary strand */
	updateOwnSequence(sequence: string): void {
		const needed = this.length;
		if (sequence.length !== needed) {
			throw new Error(`Sequence length ${sequence.length} does not match oligo length ${needed}`);
		}
		let remaining = sequence;
		for (const segment of this.segments) {
			const segLength = segment.length;
			const segSeq = remaining.slice(0, segLength);
			segment.updateOwnSequence(segment.fivePrime.index, segSeq);
			remaining = remaining.slice(segLength);
		}
	}

	clearOwnSequence(): void {
		for (const segment of this.segments) {
			segment.clearOwnSequence();
		}
	}
}
