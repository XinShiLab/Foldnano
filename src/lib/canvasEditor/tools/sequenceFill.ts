import type { HistoryStack } from '$lib/commands/history.svelte';
import { fillEmptySequenceCmd } from '$lib/commands/strands';
import type Oligo from '$lib/model/Oligo';
import type { OligoSegment } from '$lib/model/Oligo';
import type { Part } from '$lib/model/Part';
import type { DnaBase, FilledCell } from '$lib/model/Part/fillEmptySequence';
import type { EditorViewContext } from '$lib/components/Editor/context/EditorViewContext.svelte';

type StrandViewContext = EditorViewContext['strandViewContext'];

/**
 * Segments the "Fill empty" buttons target: those owning selected ends (whole oligos when the
 * OLIGO toggle is on), or every strand in the design when nothing is selected. The SCAF/STAP
 * toggles filter both; `staplesOnly` drops the scaffold whatever its toggle says.
 */
export function emptyFillTargets(
	part: Part,
	strandCtx: StrandViewContext,
	{ staplesOnly = false } = {}
): OligoSegment[] {
	const filter = strandCtx.selectionFilter;
	const kindAllowed = (oligo: Oligo) =>
		oligo.isScaffold ? !staplesOnly && filter.has('SCAF') : filter.has('STAP');
	const ends = strandCtx.selected.ends;
	if (ends.size === 0) {
		return part.realOligos.filter(kindAllowed).flatMap((oligo) => [...oligo.segments]);
	}
	const wholeOligo = filter.has('OLIGO');
	const segments = new Set<OligoSegment>();
	for (const end of ends) {
		const oligo = end.segment.oligo;
		if (!oligo || oligo.isMirror || !kindAllowed(oligo)) continue;
		if (wholeOligo) for (const segment of oligo.segments) segments.add(segment);
		else segments.add(end.segment);
	}
	return [...segments];
}

/** Fills the empty nucleotides of `segments` (randomly, or with `base`) and records them for the highlight. */
export function fillEmptyAndHighlight(
	part: Part,
	segments: Iterable<OligoSegment>,
	strandCtx: StrandViewContext,
	history: HistoryStack,
	base?: DnaBase
): void {
	const { gcContent } = strandCtx.sequenceContext;
	const result = fillEmptySequenceCmd({ part, segments, gcContent, base }, history);
	strandCtx.sequenceContext.fillResults = [];
	strandCtx.recentFill = { ...result, revision: history.revision };
}

interface CellBases {
	cell: FilledCell;
	seq: string;
	isMirror: boolean;
}

function snapshotBases(part: Part): Map<string, CellBases> {
	const out = new Map<string, CellBases>();
	for (const oligo of part.oligos) {
		for (const segment of oligo.segments) {
			const vhId = segment.inVirtualHelix.id;
			const strandIdx = segment.inStrandIndex;
			for (const slot of segment.slots) {
				const cell = { vhId, strandIdx, bpIndex: slot.bpIndex };
				out.set(`${vhId}|${strandIdx}|${slot.bpIndex}`, {
					cell,
					seq: slot.seq,
					isMirror: oligo.isMirror,
				});
			}
		}
	}
	return out;
}

/**
 * Runs a sequence edit and highlights every cell whose bases it set, opposite strands and
 * mirror copies included. For edits without their own fill report (whole-strand fills).
 */
export function withFillHighlight<T>(
	part: Part,
	strandCtx: StrandViewContext,
	history: HistoryStack,
	run: () => T
): T {
	const before = snapshotBases(part);
	const out = run();
	const cells: FilledCell[] = [];
	let filled = 0;
	for (const [key, now] of snapshotBases(part)) {
		const was = before.get(key)?.seq;
		if (was === now.seq) continue;
		let set = 0;
		for (let i = 0; i < now.seq.length; i++) {
			if (now.seq[i] !== 'N' && now.seq[i] !== was?.[i]) set++;
		}
		if (set === 0) continue;
		cells.push(now.cell);
		if (!now.isMirror) filled += set;
	}
	strandCtx.recentFill =
		cells.length > 0
			? { cells, filled, copied: 0, conflicts: 0, revision: history.revision }
			: null;
	return out;
}
