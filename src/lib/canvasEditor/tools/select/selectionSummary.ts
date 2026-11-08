import type Oligo from '$lib/model/Oligo';
import type { OligoSegment, SegmentEnd } from '$lib/model/Oligo';

/** A connection whose two ends are both selected, oriented 3' → 5' like every crossover. */
export interface SelectedCrossover {
	from: SegmentEnd;
	to: SegmentEnd;
}

/** What an end selection reads as, using the same rules as Delete (`removeSelection`) and the
 * selection highlight: an oligo with every end selected counts as a whole oligo; otherwise a
 * segment with both ends selected, a connection with both ends selected, and leftover ends. */
export interface SelectionSummary {
	oligos: Oligo[];
	segments: OligoSegment[];
	crossovers: SelectedCrossover[];
	ends: SegmentEnd[];
	/** Every oligo the selection touches, whole or partly. */
	touchedOligos: Oligo[];
}

export function summarizeEndSelection(selected: ReadonlySet<SegmentEnd>): SelectionSummary {
	const selectedCountByOligo = new Map<Oligo, number>();
	for (const end of selected) {
		const oligo = end.segment.oligo;
		if (oligo) selectedCountByOligo.set(oligo, (selectedCountByOligo.get(oligo) ?? 0) + 1);
	}
	const touchedOligos = [...selectedCountByOligo.keys()];
	const oligos = touchedOligos.filter(
		(oligo) => selectedCountByOligo.get(oligo) === oligo.allEnds.size
	);
	const wholeOligos = new Set(oligos);

	const segments: OligoSegment[] = [];
	const crossovers: SelectedCrossover[] = [];
	const ends: SegmentEnd[] = [];
	const seenSegments = new Set<OligoSegment>();
	const seenCrossovers = new Set<SegmentEnd>();
	const coveredEnds = new Set<SegmentEnd>();

	for (const end of selected) {
		const segment = end.segment;
		if (segment.oligo && wholeOligos.has(segment.oligo)) continue;
		if (
			!seenSegments.has(segment) &&
			selected.has(segment.fivePrime) &&
			selected.has(segment.threePrime)
		) {
			seenSegments.add(segment);
			segments.push(segment);
			coveredEnds.add(segment.fivePrime).add(segment.threePrime);
		}
		const connected = end.connectedEnd;
		if (connected && selected.has(connected)) {
			const from = end.isThreePrime ? end : connected;
			if (!seenCrossovers.has(from)) {
				seenCrossovers.add(from);
				crossovers.push({ from, to: from === end ? connected : end });
				coveredEnds.add(end).add(connected);
			}
		}
	}
	for (const end of selected) {
		const oligo = end.segment.oligo;
		if (oligo && wholeOligos.has(oligo)) continue;
		if (!coveredEnds.has(end)) ends.push(end);
	}

	return { oligos, segments, crossovers, ends, touchedOligos };
}

export function selectionItemCount(summary: SelectionSummary): number {
	return (
		summary.oligos.length +
		summary.segments.length +
		summary.crossovers.length +
		summary.ends.length
	);
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** "2 oligos · 3 segments · 1 crossover", skipping kinds with no items. */
export function formatSelectionCounts(summary: SelectionSummary): string {
	const kinds: [number, string][] = [
		[summary.oligos.length, 'oligo'],
		[summary.segments.length, 'segment'],
		[summary.crossovers.length, 'crossover'],
		[summary.ends.length, 'end'],
	];
	return kinds
		.filter(([count]) => count > 0)
		.map(([count, noun]) => plural(count, noun))
		.join(' · ');
}

/** How many of `ends` carry each modification, in first-seen order. */
export function countModifications(ends: Iterable<SegmentEnd>): { name: string; count: number }[] {
	const counts = new Map<string, number>();
	for (const end of ends) {
		if (end.modification !== null) {
			counts.set(end.modification, (counts.get(end.modification) ?? 0) + 1);
		}
	}
	return [...counts].map(([name, count]) => ({ name, count }));
}
