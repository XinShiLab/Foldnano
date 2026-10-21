import { v4 as uuidv4 } from 'uuid';
import VirtualHelix, { type StrandSet } from '../VirtualHelix';
import { ThreePrimeEnd, FivePrimeEnd } from './SegmentEnd.svelte';
import type Oligo from './Oligo.svelte';
import type { Part } from '../Part';
import { generateComplementaryDNA, generateRandomDNA } from '../sequences/sequences';
export const SET_OWNER = Symbol('SET_OWNER');

/** The slot content a complementary strand must take to mirror a skip (`seqLen` 0) or an
 * insertion (`seqLen` > 1), keeping its own base where it has one. */
export function mirroredSkipInsertSeq(currentSeq: string, seqLen: number): string {
	return seqLen === 0 ? '' : (currentSeq[0] || 'N') + 'N'.repeat(seqLen - 1);
}

// Slot = one backbone position (5'->3'). seq length: 0=skip, 1=normal, >1 insertion(s).
class Slot {
	readonly segment: OligoSegment;
	readonly bpIndex: number;
	private _seq: string;

	constructor(segment: OligoSegment, bpIndex: number, seq: string) {
		this.segment = segment;
		this.bpIndex = bpIndex;
		this._seq = $state(seq);
	}

	get seq(): string {
		return this._seq;
	}

	set seq(value: string) {
		if (value === this._seq) return;
		this._seq = value;
		// sequence change unlocks the oligo
		const oligo = this.segment.oligo;
		if (oligo) oligo.isSequenceLocked = false;
	}
}

export default class OligoSegment {
	id: string;
	readonly inPart: Part;
	readonly inVirtualHelix: VirtualHelix;
	threePrime: ThreePrimeEnd;
	fivePrime: FivePrimeEnd;

	// canonical storage
	private _slots: Slot[] = $state([]);

	// legacy fields now derived (keep signatures for external code)
	get sequence(): string {
		return this.slots.map((s) => s.seq).join('');
	}
	set sequence(canonicalSeq: string) {
		this._assignSequenceAcrossSlots(canonicalSeq);
	}

	// derived legacy format: [bpIndex, count] (count<0 skip, count>0 insertions)
	get skipsAndInserts(): [number, number][] {
		return this.slots.reduce<[number, number][]>((acc, s) => {
			if (s.seq.length === 0) acc.push([s.bpIndex, -1]);
			else if (s.seq.length > 1) acc.push([s.bpIndex, s.seq.length - 1]);
			return acc;
		}, []);
	}

	/** Legacy setter to allow external assignment during import (cadnanoJSON). */
	set skipsAndInserts(entries: [number, number][]) {
		// reset all modified slots back to single nt (preserve first base if present)
		for (const slot of this.slots) {
			if (slot.seq.length === 0) slot.seq = 'N';
			else if (slot.seq.length > 1) slot.seq = slot.seq[0] || 'N';
		}
		if (!entries?.length) return;
		for (const [bpIndex, count] of entries) {
			const slot = this.slots.find((s) => s.bpIndex === bpIndex);
			if (!slot) continue;
			if (count < 0) {
				// skip
				slot.seq = '';
			} else if (count > 0) {
				// insertion(s): preserve existing first base (or N) then pad
				const first = slot.seq.length >= 1 ? slot.seq[0] : 'N';
				slot.seq = first + 'N'.repeat(count);
			}
		}
	}

	constructor(
		inPart: Part,
		inVirtualHelix: VirtualHelix,
		fivePrimeEndIndex: number,
		threePrimeEndIndex: number,
		id?: string
	) {
		this.id = id || uuidv4();
		this.inPart = inPart;
		this.inVirtualHelix = inVirtualHelix;
		this.threePrime = $state(new ThreePrimeEnd(inPart, this, threePrimeEndIndex));
		this.fivePrime = $state(new FivePrimeEnd(inPart, this, fivePrimeEndIndex));
		inVirtualHelix.strandSets[this.inStrandIndex].segmentIds.add(this.id);
		this.inPart.registerSegment(this);
		this._initSlotsFromIndices();
	}

	toJSON() {
		return {
			id: this.id,
			inVirtualHelixIndex: this.inVirtualHelix.index,
			fivePrime: this.fivePrime.toJSON(),
			threePrime: this.threePrime.toJSON(),
			sequence: this.sequence, // optional redundancy
			slots: this.slots.map((s) => ({ bpIndex: s.bpIndex, seq: s.seq })), // canonical snapshot
		};
	}

	static fromJSON(json: ReturnType<OligoSegment['toJSON']>, inPart: Part): OligoSegment {
		const vh = inPart.getVhByIndex(json.inVirtualHelixIndex);
		if (!vh)
			throw new Error(`VirtualHelix with index ${json.inVirtualHelixIndex} not found in Part.`);
		const segment = new OligoSegment(
			inPart,
			vh,
			json.fivePrime.index,
			json.threePrime.index,
			json.id
		);
		segment.fivePrime = FivePrimeEnd.fromJSON(json.fivePrime, segment);
		segment.threePrime = ThreePrimeEnd.fromJSON(json.threePrime, segment);

		// If slots provided, use them directly; else fallback to legacy reconstruction.
		if (Array.isArray(json.slots) && json.slots.length) {
			segment.slots = json.slots
				.map((s: { bpIndex: number; seq: string }) => new Slot(segment, s.bpIndex, s.seq))
				.sort((a, b) =>
					segment.inStrandIndex === 0 ? a.bpIndex - b.bpIndex : b.bpIndex - a.bpIndex
				);
			// If a separate sequence field exists and differs, allow it to overwrite slot seqs.
			if (
				json.sequence &&
				json.sequence.length === segment.slots.reduce((a, s) => a + s.seq.length, 0)
			) {
				const joined = segment.slots.map((s) => s.seq).join('');
				if (joined !== json.sequence) {
					segment._assignSequenceAcrossSlots(json.sequence);
				}
			}
		} else {
			// Legacy fallback: derive slots from indices & sequence only.
			segment._initSlotsFromIndices();
			if (json.sequence) segment._assignSequenceAcrossSlots(json.sequence);
		}
		return segment;
	}

	get oligo(): Oligo | null {
		return this.inPart.getOligoBySegment(this);
	}

	get ownerStrandSet(): StrandSet {
		return this.inVirtualHelix.strandSets[this.inStrandIndex];
	}

	get inStrandIndex(): 0 | 1 {
		if (this.fivePrime.index < this.threePrime.index) return 0;
		else return 1;
	}

	get inStrandSet(): StrandSet {
		return this.inVirtualHelix.strandSets[this.inStrandIndex];
	}

	get length(): number {
		// total nucleotides (was indexLength + inserts - skips handling); now direct sum of occupancies
		return this.totalNucleotides;
	}

	// new helper: number of backbone positions (slots)
	get backboneLength(): number {
		return this.slots.length;
	}

	// total nucleotides (joins slot seq lengths)
	get totalNucleotides(): number {
		return this.slots.reduce((a, s) => a + s.seq.length, 0);
	}

	// new: public read-only access to canonical slots (5'->3' order)
	get slots(): ReadonlyArray<Slot> {
		return this._slots;
	}

	set slots(newSlots: Slot[]) {
		const oligo = this.oligo;
		if (oligo) oligo.isSequenceLocked = false;
		this._slots = newSlots;
	}

	addSlot(bpIndex: number, seq: string): void {
		const oligo = this.oligo;
		if (oligo) oligo.isSequenceLocked = false;
		this._slots.push(new Slot(this, bpIndex, seq));
		// normalize order to 5'->3'
		this._slots.sort((a, b) =>
			this.inStrandIndex === 0 ? a.bpIndex - b.bpIndex : b.bpIndex - a.bpIndex
		);
	}

	removeSlotAt(bpIndex: number): void {
		const oligo = this.oligo;
		if (oligo) oligo.isSequenceLocked = false;
		this._slots = this._slots.filter((s) => s.bpIndex !== bpIndex);
	}

	// convenience: sequence at bp (may be '', length 1, or >1)
	slotSeq(bpIndex: number): string {
		const s = this.slotForBp(bpIndex);
		return s ? s.seq : '';
	}

	get lowIndex(): number {
		return Math.min(this.threePrime.index, this.fivePrime.index);
	}
	get highIndex(): number {
		return Math.max(this.fivePrime.index, this.threePrime.index);
	}
	get endNtIndex(): number {
		return this.threePrime.index;
	}
	get startNtIndex(): number {
		return this.fivePrime.index;
	}

	static areAdjacent(segmentA: OligoSegment, segmentB: OligoSegment): boolean {
		// check if two segments are adjacent
		return (
			segmentA.inVirtualHelix === segmentB.inVirtualHelix &&
			segmentA.inStrandIndex === segmentB.inStrandIndex &&
			(segmentA.highIndex + 1 === segmentB.lowIndex || segmentB.highIndex + 1 === segmentA.lowIndex)
		);
	}

	isAdjacentTo(otherSegment: OligoSegment): boolean {
		return OligoSegment.areAdjacent(this, otherSegment);
	}

	getIdxAtLengthOffset(fromIndex: number, lengthOffset: number): number {
		// interpret lengthOffset in nucleotides, map back to bp index via slots
		if (fromIndex < this.lowIndex || fromIndex > this.highIndex) {
			throw new Error('fromIndex out of range');
		}
		// establish traversal direction (5'->3')
		const slots = this.slots;
		const startSlotIdx = slots.findIndex((s) => s.bpIndex === fromIndex);
		if (startSlotIdx === -1) throw new Error('Start slot not found');
		let remaining = lengthOffset;
		let slotCursor = startSlotIdx;
		while (remaining !== 0) {
			slotCursor += this.inStrandIndex === 0 ? 1 : -1;
			if (slotCursor < 0 || slotCursor >= slots.length) throw new Error('Offset out of range');
			remaining -= Math.max(1, slots[slotCursor].seq.length); // treat multi-nt slot as one step for bp movement
		}
		return slots[slotCursor].bpIndex;
	}

	fromBpIdxToSeqIdx(bpIndex: number): number[] {
		const slotIdx = this.slots.findIndex((s) => s.bpIndex === bpIndex);
		if (slotIdx === -1) throw new Error('bpIndex out of range');
		const slot = this.slots[slotIdx];
		if (slot.seq.length === 0) return [-1];
		// nucleotide offset = sum of prior slot seq lengths
		const prior = this.slots.slice(0, slotIdx).reduce((a, s) => a + s.seq.length, 0);
		return Array.from({ length: slot.seq.length }, (_, i) => prior + i);
	}

	/** `newSegmentId` names the segment a mid-segment break creates. */
	breakSegmentAt(index: number, newSegmentId?: string): OligoSegment | null {
		if (index < this.lowIndex || index > this.highIndex) throw new Error('Index out of range');
		if (index === this.threePrime.index) {
			const connectedSegment = this.threePrime.connectedSegment;
			if (connectedSegment) this.threePrime.disconnect();
			return connectedSegment || null;
		}
		if (index === this.fivePrime.index) {
			const connectedSegment = this.fivePrime.connectedSegment;
			if (connectedSegment) this.fivePrime.disconnect();
			return this;
		}
		// split slots at break backbone position
		const splitIdx = this.slots.findIndex((s) => s.bpIndex === index);
		if (splitIdx === -1) throw new Error('Break index slot not found');
		const newStartBp = this.inStrandIndex === 0 ? index + 1 : index - 1;
		const newSegment = this.inVirtualHelix.createNewSegment(
			newStartBp,
			this.threePrime.index,
			newSegmentId
		);
		const threePrimeConnection = this.threePrime.connectedSegment;
		this.threePrime.disconnect();
		if (threePrimeConnection) newSegment.threePrime.connectTo(threePrimeConnection.fivePrime);
		this.threePrime = new ThreePrimeEnd(this.inPart, this, index);

		// distribute slots
		const keepSlots = this.slots.filter((s) =>
			this.inStrandIndex === 0 ? s.bpIndex <= index : s.bpIndex >= index
		);
		const moveSlots = this.slots.filter((s) =>
			this.inStrandIndex === 0 ? s.bpIndex > index : s.bpIndex < index
		);
		this.slots = keepSlots;
		(newSegment as OligoSegment).slots = moveSlots; // internal assignment

		return newSegment;
	}

	addSkipOrInsertion(atIndex: number, count: number): void {
		const slot = this.slotForBp(atIndex);
		if (!slot) throw new Error(`No backbone slot at bp ${atIndex}`);
		this._assertCanModifySkipOrInsertionAt(atIndex);
		const compSlot = this._complementarySlotForBp(atIndex);
		if (!compSlot) {
			throw new Error(`Cannot add insert/skip at bp ${atIndex}: complementary slot is missing`);
		}
		if (count < 0) {
			// skip: slots must be in normal state
			if (slot.seq.length !== 1) {
				throw new Error(`Cannot add skip at bp ${atIndex}: slot is already modified`);
			}
			if (compSlot.seq.length !== 1) {
				throw new Error(`Cannot add skip at bp ${atIndex}: complementary slot is modified`);
			}
			slot.seq = '';
			compSlot.seq = '';
		} else if (count > 0) {
			if (slot.seq.length === 0) {
				throw new Error(`Cannot insert on a skip at bp ${atIndex}`);
			}
			if (slot.seq.length !== compSlot.seq.length) {
				throw new Error(`Slot mismatch at bp ${atIndex}: strands out of sync`);
			}
			// cumulative: append to existing insert or normal slot
			slot.seq += 'N'.repeat(count);
			compSlot.seq += 'N'.repeat(count);
		}
		// count==0 -> no-op
	}

	removeSkipOrInsertion(atIndex: number): void {
		const slot = this.slotForBp(atIndex);
		if (!slot) return;
		const compSlot = this._complementarySlotForBp(atIndex);
		if (!compSlot) {
			throw new Error(`Cannot remove insert/skip at bp ${atIndex}: complementary slot is missing`);
		}
		if (slot.seq.length === 0) {
			// remove skip -> restore single backbone nt placeholder
			slot.seq = 'N';
		} else if (slot.seq.length > 1) {
			// remove insertion -> keep first nt (or 'N' if empty)
			slot.seq = slot.seq[0] || 'N';
		} else {
			// already normal
		}

		if (compSlot.seq.length === 0) {
			compSlot.seq = 'N';
		} else if (compSlot.seq.length > 1) {
			compSlot.seq = compSlot.seq[0] || 'N';
		}
	}

	updateSlotsAfterEndMove(): void {
		this.clearInvalidSkipsAndInserts();
		this.addMissingSlotsAfterEndMove();
		this.fillNsFromComplementary();
	}

	clearInvalidSkipsAndInserts(): void {
		// now implicit; validate slots within range
		const slotsToRemove = this.slots.filter(
			(s) => s.bpIndex < this.lowIndex || s.bpIndex > this.highIndex
		);
		this.slots = this.slots.filter(
			(s) => s.bpIndex >= this.lowIndex && s.bpIndex <= this.highIndex
		);
		slotsToRemove.forEach((s) => {
			if (s.seq.length === 1) return; // plain slot: nothing to mirror-clear
			// Restore the complementary segment's slot directly rather than going through
			// compSeg.removeSkipOrInsertion(), which re-derives *this* segment's slot at the
			// same bp via the spatial index — but it was just filtered out of `this.slots`
			// above (and may also be transiently uncached during a Part-driven move), so that
			// re-lookup always fails.
			const complementaryStrandIdx = (1 - this.inStrandIndex) as 0 | 1;
			const { segment: compSeg } = this.inPart.getEntitiesAt(
				this.inVirtualHelix.listRow,
				complementaryStrandIdx,
				s.bpIndex
			);
			const compSlot = compSeg?.slotForBp(s.bpIndex);
			if (!compSlot) return;
			if (compSlot.seq.length === 0) compSlot.seq = 'N';
			else if (compSlot.seq.length > 1) compSlot.seq = compSlot.seq[0] || 'N';
		});
	}

	/** Read-only check: can every skip/insert slot on this segment be relocated to `bpIndex + delta`
	 * without conflict? Plain (single-nt) slots never need this — they don't force complementary
	 * sync. Mirrors the same invariants `addSkipOrInsertion` enforces for a fresh skip/insert.
	 *
	 * `coMovingSegments` (segment -> delta) names every segment translating in the same batch —
	 * e.g. both strands of a duplex dragged together. When a slot's current complementary
	 * partner is itself co-moving by this same delta, the pairing is preserved automatically
	 * (both sides shift in lockstep) and needs no cross-segment check or mutation. */
	canTranslateSlotsBy(
		delta: number,
		coMovingSegments?: ReadonlyMap<OligoSegment, number>
	): boolean {
		if (delta === 0) return true;
		const complementaryStrandIdx = (1 - this.inStrandIndex) as 0 | 1;
		for (const s of this.slots) {
			if (s.seq.length === 1) continue;
			const { segment: currentPartner } = this.inPart.getEntitiesAtVh(
				this.inVirtualHelix.id,
				complementaryStrandIdx,
				s.bpIndex
			);
			if (currentPartner && coMovingSegments?.get(currentPartner) === delta) continue;
			const newBp = s.bpIndex + delta;
			if (this._hasConstrainedEndAt(newBp)) return false;
			const { segment: compSeg } = this.inPart.getEntitiesAtVh(
				this.inVirtualHelix.id,
				complementaryStrandIdx,
				newBp
			);
			const compSlot = compSeg?.slotForBp(newBp);
			if (!compSlot || compSlot.seq.length !== 1) return false;
		}
		return true;
	}

	/** Returns the distinct complementary-strand segments touched (at old and new positions) by
	 * translating this segment's skip/insert slots by `delta`. Used to build a correct history
	 * scope before mutating. */
	affectedComplementarySegmentsForTranslate(delta: number): OligoSegment[] {
		const complementaryStrandIdx = (1 - this.inStrandIndex) as 0 | 1;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const seen = new Set<OligoSegment>();
		for (const s of this.slots) {
			if (s.seq.length === 1) continue;
			for (const bp of [s.bpIndex, s.bpIndex + delta]) {
				const { segment: compSeg } = this.inPart.getEntitiesAtVh(
					this.inVirtualHelix.id,
					complementaryStrandIdx,
					bp
				);
				if (compSeg) seen.add(compSeg);
			}
		}
		return Array.from(seen);
	}

	/** Precompute the complementary-strand mirror mutations needed for translating this segment
	 * by `delta`, as deferred thunks — restoring vacated old positions to normal and applying the
	 * skip/insert state at the new positions, for every slot whose partner is *not* itself
	 * co-moving (see `canTranslateSlotsBy`). Must be called for every segment in a translate batch
	 * before any of them actually move (via `shiftOwnSlotsBy`) — resolving "who currently sits at
	 * this bp" only works while every segment's position is still accurate. The returned thunks
	 * are safe to run in any order, any time after every segment's own slots have shifted. */
	planTranslateMirrorOps(
		delta: number,
		coMovingSegments: ReadonlyMap<OligoSegment, number>
	): Array<() => void> {
		if (delta === 0) return [];
		const complementaryStrandIdx = (1 - this.inStrandIndex) as 0 | 1;
		const ops: Array<() => void> = [];
		for (const s of this.slots) {
			if (s.seq.length === 1) continue;
			const { segment: compSeg } = this.inPart.getEntitiesAtVh(
				this.inVirtualHelix.id,
				complementaryStrandIdx,
				s.bpIndex
			);
			if (compSeg && coMovingSegments.get(compSeg) === delta) continue;

			const compSlot = compSeg?.slotForBp(s.bpIndex);
			if (compSlot) {
				ops.push(() => {
					if (compSlot.seq.length === 0) compSlot.seq = 'N';
					else if (compSlot.seq.length > 1) compSlot.seq = compSlot.seq[0] || 'N';
				});
			}

			const newBp = s.bpIndex + delta;
			const { segment: newCompSeg } = this.inPart.getEntitiesAtVh(
				this.inVirtualHelix.id,
				complementaryStrandIdx,
				newBp
			);
			const newCompSlot = newCompSeg?.slotForBp(newBp);
			if (newCompSlot) {
				const seqLen = s.seq.length;
				ops.push(() => {
					newCompSlot.seq = mirroredSkipInsertSeq(newCompSlot.seq, seqLen);
				});
			}
		}
		return ops;
	}

	/** Shift this segment's own slots by `delta` bp — carries sequence and skip/insert content to
	 * the new positions (instead of the clear-and-reinitialize semantics of a single-end resize).
	 * Purely local: no cross-segment reads or writes. Call `planTranslateMirrorOps` first (for
	 * every segment in the batch, before any of them shift) to capture whatever complementary-
	 * strand mutations are needed, then run those thunks after. */
	shiftOwnSlotsBy(delta: number): void {
		if (delta === 0) return;
		const shifted = this.slots.map((s) => new Slot(this, s.bpIndex + delta, s.seq));
		this.slots = shifted.sort((a, b) =>
			this.inStrandIndex === 0 ? a.bpIndex - b.bpIndex : b.bpIndex - a.bpIndex
		);
	}

	/** Add new backbone slots (initialized with 'N') for any bp indices now covered by the
	 * moved ends but missing from this segment. Returns number of slots added.
	 * Call after adjusting fivePrime/threePrime indices (and optionally after clearInvalidSkipsAndInserts).
	 */
	addMissingSlotsAfterEndMove(): number {
		const start = this.fivePrime.index;
		const end = this.threePrime.index;
		const ascending = this.inStrandIndex === 0;
		const desired: number[] = [];
		if (ascending) {
			for (let i = start; i <= end; i++) desired.push(i);
		} else {
			for (let i = start; i >= end; i--) desired.push(i);
		}
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const existingSet = new Set(this.slots.map((s) => s.bpIndex));
		let added = 0;
		for (const bp of desired) {
			if (!existingSet.has(bp)) {
				this.addSlot(bp, 'N');
				added++;
			}
		}
		// normalize order to 5'->3'
		// this.slots.sort((a, b) => (this.inStrandIndex === 0 ? a.bpIndex - b.bpIndex : b.bpIndex - a.bpIndex));
		return added;
	}

	updateOwnSequence(startIdx: number, sequence: string): string {
		// fill sequence starting at backbone bpIndex startIdx (5'->3' orientation of this segment)
		if (!this.slots.length) return sequence;
		const startSlotIdx = this.slots.findIndex((s) => s.bpIndex === startIdx);
		if (startSlotIdx === -1) throw new Error('startIdx not found in slots');
		let remaining = sequence;
		for (let i = startSlotIdx; i < this.slots.length && remaining.length; i++) {
			const slot = this.slots[i];
			const need = slot.seq.length;
			if (need === 0) continue;
			slot.seq = remaining.slice(0, need);
			remaining = remaining.slice(need);
		}
		return remaining;
	}

	clearOwnSequence() {
		for (const slot of this.slots) {
			if (slot.seq.length > 0) slot.seq = 'N'.repeat(slot.seq.length);
		}
	}

	/**
	 * Fill this segment's slots with the provided sequence.
	 * Returns:
	 *  leftover: extra bases not used (input longer than needed) or ''.
	 *  missing: number of nucleotides still unfilled (input shorter than needed) or 0.
	 * For partial fills (missing > 0) no complementary propagation occurs.
	 */
	fillSequence(sequence: string, onlyEmpty = false): { leftover: string; missing: number } {
		const needed = this.totalNucleotides;
		if (!needed) return { leftover: sequence, missing: 0 };

		if (onlyEmpty) {
			const vhRow = this.inVirtualHelix.listRow;
			const complementaryStrandIdx = (1 - this.inStrandIndex) as 0 | 1;
			const emptySlots = this.slots.filter((s) => s.seq.length > 0 && /^N+$/.test(s.seq));
			const totalEmpty = emptySlots.reduce((a, s) => a + s.seq.length, 0);
			let remaining = sequence;
			for (const slot of emptySlots) {
				if (remaining.length === 0) break;
				const need = slot.seq.length;
				if (remaining.length >= need) {
					const filled = remaining.slice(0, need);
					slot.seq = filled;
					remaining = remaining.slice(need);
					const { segment: compSeg } = this.inPart.getEntitiesAt(
						vhRow,
						complementaryStrandIdx,
						slot.bpIndex
					);
					if (compSeg) {
						const compSlot = compSeg.slotForBp(slot.bpIndex);
						if (compSlot && compSlot.seq.length === need) {
							compSlot.seq = generateComplementaryDNA(filled);
						}
					}
				} else {
					const chars = slot.seq.split('');
					for (let i = 0; i < remaining.length; i++) chars[i] = remaining[i];
					slot.seq = chars.join('');
					remaining = '';
					break;
				}
			}
			const applied = sequence.length - remaining.length;
			return { leftover: remaining, missing: Math.max(0, totalEmpty - applied) };
		}

		if (sequence.length >= needed) {
			// full (or over) supply
			const applied = sequence.slice(0, needed);
			this._assignSequenceAcrossSlots(applied);
			const leftover = sequence.slice(needed);

			// propagate complement only when fully filled
			const complementarySequence = generateComplementaryDNA(applied);
			let compLeftover = complementarySequence;
			let currentBp = this.threePrime.index;
			const vhRow = this.inVirtualHelix.listRow;
			const complementaryStrandIdx = (1 - this.inStrandIndex) as 0 | 1;
			const movingForward = complementaryStrandIdx === 0 ? 1 : -1;
			const currentBpWithinBounds = (currentBp: number, complementarySeg: OligoSegment) => {
				return complementarySeg.inStrandIndex === 0
					? currentBp <= complementarySeg.threePrime.index &&
							currentBp >= complementarySeg.fivePrime.index
					: currentBp >= complementarySeg.threePrime.index &&
							currentBp <= complementarySeg.fivePrime.index;
			};
			while (compLeftover.length > 0 && currentBpWithinBounds(currentBp, this)) {
				// let segment: OligoSegment;
				const { segment } = this.inPart.getEntitiesAt(vhRow, complementaryStrandIdx, currentBp);
				if (!segment) {
					// move forward to next bp and check
					currentBp += movingForward;
					// remove first base from compLeftover since no segment to apply to
					compLeftover = compLeftover.slice(1);
					continue;
					// break
				} //break;
				compLeftover = segment.updateOwnSequence(currentBp, compLeftover);
				currentBp =
					complementaryStrandIdx === 0
						? segment.threePrime.index + 1
						: segment.threePrime.index - 1;
			}

			return { leftover, missing: 0 };
		} else {
			// partial supply
			let remaining = sequence;
			for (const slot of this.slots) {
				if (!remaining.length) break;
				const need = slot.seq.length;
				if (need === 0) continue;
				const piece = remaining.slice(0, need);
				if (piece.length === need) {
					slot.seq = piece;
				} else {
					// fill prefix; keep existing (likely 'N') for rest
					const chars = slot.seq.split('');
					for (let i = 0; i < piece.length; i++) chars[i] = piece[i];
					slot.seq = chars.join('');
				}
				remaining = remaining.slice(piece.length);
			}
			const appliedLen = sequence.length;
			return { leftover: '', missing: needed - appliedLen };
		}
	}

	fillRandomSequence(gcContent: number = 0.5, onlyEmpty = false): string | null {
		if (onlyEmpty) {
			const emptyCount = this.slots
				.filter((s) => s.seq.length > 0 && /^N+$/.test(s.seq))
				.reduce((a, s) => a + s.seq.length, 0);
			if (emptyCount === 0) return '';
			const randomSequence = generateRandomDNA(emptyCount, gcContent);
			const { missing } = this.fillSequence(randomSequence.primary5to3, true);
			return missing === 0 ? randomSequence.primary5to3 : null;
		}
		const randomSequence = generateRandomDNA(this.totalNucleotides, gcContent);
		const { missing } = this.fillSequence(randomSequence.primary5to3);
		return missing === 0 ? randomSequence.primary5to3 : null;
	}

	// Replace 'N' bases in this segment using reverse-complement of the complementary segment at each bp.
	// Returns the number of nucleotides filled.
	fillNsFromComplementary(): number {
		const vhRow = this.inVirtualHelix.listRow;
		const complementaryStrandIdx = (1 - this.inStrandIndex) as 0 | 1;
		let filled = 0;

		for (const slot of this.slots) {
			if (slot.seq.length === 0) continue; // skip positions have no nucleotides to fill
			const ent = this.inPart.getEntitiesAt(vhRow, complementaryStrandIdx, slot.bpIndex);
			const compSeg = ent?.segment as OligoSegment | undefined;
			if (!compSeg) continue;
			const compSlot = compSeg.slotForBp(slot.bpIndex);
			if (!compSlot) continue;

			// Align positions by reverse-complementing complementary slot to our 5'->3' order
			const rc = OligoSegment._reverseComplement(compSlot.seq);
			const minLen = Math.min(slot.seq.length, rc.length);
			if (minLen === 0) continue;

			const chars = slot.seq.split('');
			for (let i = 0; i < minLen; i++) {
				if (chars[i] === 'N') {
					const donor = rc[i];
					if (donor === 'A' || donor === 'C' || donor === 'G' || donor === 'T') {
						chars[i] = donor;
						filled += 1;
					}
				}
			}
			slot.seq = chars.join('');
		}

		return filled;
	}

	// Segment-level takeover: merge slots/sequences from source into this segment.
	// Assumes source is adjacent and being merged away.
	takeOverSlotsFrom(source: OligoSegment): void {
		// Must be on same VH and strand orientation to safely merge slots
		if (this.inVirtualHelix !== source.inVirtualHelix) {
			throw new Error('Cannot take over slots: segments on different VirtualHelix');
		}
		if (this.inStrandIndex !== source.inStrandIndex) {
			throw new Error('Cannot take over slots: segments on different strand index');
		}

		// Validate range overlap/inclusion: require at least overlap, prefer inclusion for already-extended segment.
		const targetLow = this.lowIndex;
		const targetHigh = this.highIndex;
		const sourceLow = source.lowIndex;
		const sourceHigh = source.highIndex;

		const overlaps = !(sourceHigh < targetLow || sourceLow > targetHigh);
		if (!overlaps) {
			throw new Error(
				'Cannot take over slots: source segment does not overlap current segment range'
			);
		}
		const included = sourceLow >= targetLow && sourceHigh <= targetHigh;
		// Optional: warn if only partially overlapping (not fully included)
		if (!included) {
			console.warn(
				'takeOverSlotsFrom: source only partially overlaps target; taking over only overlapping bp indices.'
			);
		}

		const inRange = (bp: number) =>
			this.inStrandIndex === 0
				? bp >= this.lowIndex && bp <= this.highIndex
				: bp <= this.lowIndex && bp >= this.highIndex;

		for (const s of (source as OligoSegment).slots) {
			if (!inRange(s.bpIndex)) continue;
			const target = this.slotForBp(s.bpIndex);
			if (!target) {
				// create new slot within our range, copy source seq as-is
				this.addSlot(s.bpIndex, s.seq);
			} else {
				// merge behavior:
				// - if source is skip, force target to skip
				// - else set target length to max(source.len, target.len) and copy source bases, padding with 'N'
				if (s.seq.length === 0) {
					target.seq = '';
				} else {
					const targetLen = target.seq.length;
					const sourceLen = s.seq.length;
					const newLen = Math.max(targetLen, sourceLen);
					// ensure target length
					if (targetLen !== newLen) {
						const first = targetLen ? target.seq[0] || 'N' : 'N';
						target.seq = first + 'N'.repeat(newLen - 1);
					}
					// copy source bases into target (prefix), leave rest as existing/N
					const chars = target.seq.split('');
					const copyLen = Math.min(sourceLen, chars.length);
					for (let i = 0; i < copyLen; i++) {
						chars[i] = s.seq[i] || 'N';
					}
					target.seq = chars.join('');
				}
			}
		}

		// normalize order to 5'->3' and keep only slots within our current indices
		this.slots = this.slots
			.filter(
				(slot) =>
					(slot.bpIndex >= this.lowIndex && slot.bpIndex <= this.highIndex) || // strand 0 range
					(slot.bpIndex <= this.lowIndex && slot.bpIndex >= this.highIndex)
			) // strand 1 range
			.sort((a, b) => (this.inStrandIndex === 0 ? a.bpIndex - b.bpIndex : b.bpIndex - a.bpIndex));
	}

	// helpers --------------------------------------------------

	private _complementarySlotForBp(bpIndex: number): Slot | undefined {
		const complementaryStrandIdx = (1 - this.inStrandIndex) as 0 | 1;
		const { segment: compSeg } = this.inPart.getEntitiesAtVh(
			this.inVirtualHelix.id,
			complementaryStrandIdx,
			bpIndex
		);
		return compSeg?.slotForBp(bpIndex);
	}

	// Strict, both-sides-assigned mismatch check: flags a bp only when this segment and its
	// complementary strand both carry an assigned single base ('N' means "not assigned yet",
	// not a mismatch) that isn't Watson-Crick complementary. Skip/insert slots are excluded —
	// that invariant is already hard-enforced elsewhere; this is only about carried-over sequence.
	mismatchedBps(): number[] {
		const result: number[] = [];
		for (const slot of this.slots) {
			if (slot.seq.length !== 1 || slot.seq === 'N') continue;
			const compSlot = this._complementarySlotForBp(slot.bpIndex);
			if (!compSlot || compSlot.seq.length !== 1 || compSlot.seq === 'N') continue;
			if (OligoSegment._complementBase(slot.seq) !== compSlot.seq) {
				result.push(slot.bpIndex);
			}
		}
		return result;
	}

	private _hasConstrainedEndAt(bpIndex: number): boolean {
		for (const strandIdx of [0, 1] as const) {
			const { end } = this.inPart.getEntitiesAtVh(this.inVirtualHelix.id, strandIdx, bpIndex);
			if (end && !end.isFree && end.isConstrained) return true;
		}
		return false;
	}

	private _assertCanModifySkipOrInsertionAt(bpIndex: number): void {
		if (this._hasConstrainedEndAt(bpIndex)) {
			throw new Error(`Cannot add insert/skip at constrained crossover site bp ${bpIndex}`);
		}
	}

	private static _complementBase(b: string): string {
		switch (b) {
			case 'A':
				return 'T';
			case 'T':
				return 'A';
			case 'C':
				return 'G';
			case 'G':
				return 'C';
			default:
				return 'N';
		}
	}

	private static _reverseComplement(seq: string): string {
		// reverse then complement
		let out = '';
		for (let i = seq.length - 1; i >= 0; i--) {
			out += OligoSegment._complementBase(seq[i]);
		}
		return out;
	}

	private _initSlotsFromIndices(): void {
		// const low = this.lowIndex;
		// const high = this.highIndex;
		const ascending = this.inStrandIndex === 0;
		const indices: number[] = [];
		if (ascending) {
			for (let i = this.fivePrime.index; i <= this.threePrime.index; i++) indices.push(i);
		} else {
			for (let i = this.fivePrime.index; i >= this.threePrime.index; i--) indices.push(i);
		}
		this.slots = indices
			.sort((a, b) => (this.inStrandIndex === 0 ? a - b : b - a)) // normalize 5'->3'
			.map((bp) => new Slot(this, bp, 'N')); // default occupancy 1
	}

	private _applyLegacySkipsInserts(entries: [number, number][]): void {
		if (!entries?.length) return;
		for (const [bpIndex, count] of entries) {
			const slot = this.slots.find((s) => s.bpIndex === bpIndex);
			if (!slot) continue;
			if (count < 0)
				slot.seq = ''; // skip
			else if (count > 0) slot.seq = 'N'.repeat(1 + count);
		}
	}

	private _assignSequenceAcrossSlots(canonicalSeq: string): void {
		let cursor = 0;
		for (const slot of this.slots) {
			const need = slot.seq.length;
			if (need === 0) continue;
			slot.seq = canonicalSeq.slice(cursor, cursor + need);
			cursor += need;
		}
		if (cursor !== canonicalSeq.length) {
			// leftover ignored (mismatch), could throw
		}
	}

	slotForBp(bpIndex: number): Slot | undefined {
		return this.slots.find((s) => s.bpIndex === bpIndex);
	}

	bpToSeqRange(bpIndex: number): [number, number] | null {
		const slotIdx = this.slots.findIndex((s) => s.bpIndex === bpIndex);
		if (slotIdx === -1) return null;
		const start = this.slots.slice(0, slotIdx).reduce((a, s) => a + s.seq.length, 0);
		return [start, start + this.slots[slotIdx].seq.length];
	}

	seqIdxToBp(seqIdx: number): { bpIndex: number; offset: number } | null {
		if (seqIdx < 0 || seqIdx >= this.totalNucleotides) return null;
		let running = 0;
		for (const slot of this.slots) {
			const len = slot.seq.length;
			if (seqIdx < running + len) return { bpIndex: slot.bpIndex, offset: seqIdx - running };
			running += len;
		}
		return null;
	}

	/** remove this segment from its owning virtualHelix */
	destroy(): void {
		this.inVirtualHelix.removeSegment(this);
	}
}
