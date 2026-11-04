import type { HistoryStack } from '$lib/commands/history.svelte';
import { fillEmptySequenceCmd } from '$lib/commands/strands';
import type Oligo from '$lib/model/Oligo';
import type { OligoSegment } from '$lib/model/Oligo';
import type { Part } from '$lib/model/Part';
import type { EditorViewContext } from '$lib/components/Editor/context/EditorViewContext.svelte';

type StrandViewContext = EditorViewContext['strandViewContext'];

/**
 * Segments the "Fill empty" button targets: those owning selected ends (whole oligos when the
 * OLIGO toggle is on), or every strand in the design when nothing is selected. The SCAF/STAP
 * toggles filter both.
 */
export function emptyFillTargets(part: Part, strandCtx: StrandViewContext): OligoSegment[] {
	const filter = strandCtx.selectionFilter;
	const kindAllowed = (oligo: Oligo) => filter.has(oligo.isScaffold ? 'SCAF' : 'STAP');
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

/** Random-fills the empty nucleotides of `segments` and records them for the highlight. */
export function fillEmptyAndHighlight(
	part: Part,
	segments: Iterable<OligoSegment>,
	strandCtx: StrandViewContext,
	history: HistoryStack
): void {
	const { gcContent } = strandCtx.sequenceContext;
	const result = fillEmptySequenceCmd({ part, segments, gcContent }, history);
	strandCtx.sequenceContext.fillResults = [];
	strandCtx.recentFill = { ...result, revision: history.revision };
}
