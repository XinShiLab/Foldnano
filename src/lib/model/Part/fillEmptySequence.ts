import type OligoSegment from '../Oligo/OligoSegment.svelte';
import { generateRandomDNA } from '../sequences/sequences';
import type { Part } from './Part.svelte';

/** A strand-view cell whose nucleotides an empty-only fill assigned (mirror copies included). */
export interface FilledCell {
	vhId: string;
	strandIdx: 0 | 1;
	bpIndex: number;
}

export interface EmptyFillResult {
	cells: FilledCell[];
	/** Nucleotides assigned on real strands; mirror copies follow at the end of the `tx`. */
	filled: number;
	/** Of `filled`, the bases set by an already-assigned partner instead of drawn at random. */
	copied: number;
	/** Empty target nucleotides left 'N' because their partners demand different bases. */
	conflicts: number;
}

const COMPLEMENT: Readonly<Record<string, string>> = { A: 'T', T: 'A', G: 'C', C: 'G' };

type Slot = OligoSegment['slots'][number];

/** One nucleotide on a real (non-mirror) strand: what a mirror copy resolves to. */
interface Nt {
	key: string;
	segment: OligoSegment;
	slot: Slot;
	charIdx: number;
}

const ntOf = (segment: OligoSegment, slot: Slot, charIdx: number): Nt => ({
	key: `${segment.id}|${slot.bpIndex}|${charIdx}`,
	segment,
	slot,
	charIdx,
});

/** The real nucleotide behind (vh, strand, bp, charIdx): a mirror resolves to its source. */
function resolveNt(
	part: Part,
	vhId: string,
	strandIdx: 0 | 1,
	bpIndex: number,
	charIdx: number,
	slotLength: number
): { nt: Nt; viaMirror: boolean } | null {
	const { segment } = part.getEntitiesAtVh(vhId, strandIdx, bpIndex);
	if (!segment) return null;
	const tag = segment.oligo?.mirrorOf;
	if (!tag) {
		const slot = segment.slotForBp(bpIndex);
		if (!slot || slot.seq.length !== slotLength) return null;
		return { nt: ntOf(segment, slot, charIdx), viaMirror: false };
	}
	const offset = part
		.getRepeatGroup(tag.groupId)
		?.instances.find((i) => i.id === tag.instanceId)?.bpOffset;
	if (offset === undefined) return null;
	const sourceBp = bpIndex - offset;
	const { segment: source } = part.getEntitiesAtVh(vhId, strandIdx, sourceBp);
	if (!source || source.oligo?.id !== tag.sourceOligoId) return null;
	const slot = source.slotForBp(sourceBp);
	if (!slot || slot.seq.length !== slotLength) return null;
	return { nt: ntOf(source, slot, charIdx), viaMirror: true };
}

/** Bp positions where `segment`'s bases appear after the repeat-group sync: its own and each copy's. */
function copyOffsets(part: Part, segment: OligoSegment): number[] {
	const groupId = segment.oligo?.repeatGroupId;
	const group = groupId ? part.getRepeatGroup(groupId) : null;
	return [0, ...(group?.instances.map((i) => i.bpOffset) ?? [])];
}

/**
 * Assigns the 'N' nucleotides of `segments` without changing any assigned base, and without
 * creating a mismatch, including at linked mirror copies: once the repeat-group sync copies a
 * source's bases into its mirrors, each copy must still pair with whatever sits opposite it.
 *
 * Nucleotides that must pair (directly, or through a copy) form a component: one free choice,
 * fixed by any assigned base in it. A component whose assigned bases disagree is left empty.
 * Writes go to target nucleotides and to the 'N' directly opposite a target, except on scaffold
 * strands outside `segments`; never through a mirror into its source.
 */
export function fillEmptySequence(
	part: Part,
	segments: Iterable<OligoSegment>,
	gcContent: number
): EmptyFillResult {
	const targets = new Set([...segments].filter((segment) => !segment.oligo?.isMirror));
	const result: EmptyFillResult = { cells: [], filled: 0, copied: 0, conflicts: 0 };
	let emptyCount = 0;
	for (const segment of targets) emptyCount += segment.emptyNucleotideCount;
	if (emptyCount === 0) return result;
	// One draw per component that contains a target 'N', so the pool is never exhausted.
	const pool = generateRandomDNA(emptyCount, gcContent).primary5to3;
	let drawn = 0;

	const done = new Set<string>();
	const filledCells = new Set<string>();
	const addCells = (nt: Nt) => {
		const { segment, slot } = nt;
		for (const offset of copyOffsets(part, segment)) {
			const key = `${segment.inVirtualHelix.id}|${segment.inStrandIndex}|${slot.bpIndex + offset}`;
			if (filledCells.has(key)) continue;
			filledCells.add(key);
			result.cells.push({
				vhId: segment.inVirtualHelix.id,
				strandIdx: segment.inStrandIndex,
				bpIndex: slot.bpIndex + offset,
			});
		}
	};

	const mayWrite = (segment: OligoSegment) =>
		targets.has(segment) || (!!segment.oligo && !segment.oligo.isScaffold);

	for (const segment of targets) {
		for (const slot of segment.slots) {
			for (let charIdx = 0; charIdx < slot.seq.length; charIdx++) {
				if (slot.seq[charIdx] !== 'N') continue;
				const start = ntOf(segment, slot, charIdx);
				if (done.has(start.key)) continue;

				// Two-colour the pairing component: parity 1 means "complement of parity 0".
				const parity = new Map<string, 0 | 1>([[start.key, 0]]);
				const members: Nt[] = [start];
				const writable = new Set<string>([start.key]);
				let consistent = true;
				for (let i = 0; i < members.length; i++) {
					const nt = members[i];
					const p = parity.get(nt.key)!;
					const len = nt.slot.seq.length;
					const oppStrand = (1 - nt.segment.inStrandIndex) as 0 | 1;
					// Antiparallel: an insertion's i-th base pairs with the opposite slot's from its end.
					const oppChar = len - 1 - nt.charIdx;
					for (const offset of copyOffsets(part, nt.segment)) {
						const hit = resolveNt(
							part,
							nt.segment.inVirtualHelix.id,
							oppStrand,
							nt.slot.bpIndex + offset,
							oppChar,
							len
						);
						if (!hit) continue;
						const q = (1 - p) as 0 | 1;
						const seen = parity.get(hit.nt.key);
						if (seen === undefined) {
							parity.set(hit.nt.key, q);
							members.push(hit.nt);
						} else if (seen !== q) {
							consistent = false;
						}
						const direct = offset === 0 && !hit.viaMirror;
						if (direct && targets.has(nt.segment) && mayWrite(hit.nt.segment)) {
							writable.add(hit.nt.key);
						}
					}
				}

				let base0: string | null = null;
				for (const nt of members) {
					done.add(nt.key);
					const ch = nt.slot.seq[nt.charIdx];
					if (!COMPLEMENT[ch]) continue;
					const implied = parity.get(nt.key) === 0 ? ch : COMPLEMENT[ch];
					if (base0 === null) base0 = implied;
					else if (base0 !== implied) consistent = false;
				}

				const toWrite = members.filter(
					(nt) =>
						(writable.has(nt.key) || targets.has(nt.segment)) && nt.slot.seq[nt.charIdx] === 'N'
				);
				if (!consistent) {
					result.conflicts += toWrite.filter((nt) => targets.has(nt.segment)).length;
					continue;
				}
				const copied = base0 !== null;
				const base = base0 ?? pool[drawn++];
				for (const nt of toWrite) {
					const ch = parity.get(nt.key) === 0 ? base : COMPLEMENT[base];
					const chars = nt.slot.seq.split('');
					chars[nt.charIdx] = ch;
					nt.slot.seq = chars.join('');
					result.filled++;
					if (copied) result.copied++;
					addCells(nt);
				}
			}
		}
	}
	return result;
}
