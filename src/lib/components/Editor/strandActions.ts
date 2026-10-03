import type { Part } from '$lib/model/Part';
import type { HistoryStack } from '../../commands/history.svelte';
import type Oligo from '../../model/Oligo';
import type { EndSelection } from './context/EditorViewContext.svelte';
import type { OligoSegment } from '$lib/model/Oligo';
import type { SelectionToggle } from './context/types';
import type { EditorViewContext } from './context/EditorViewContext.svelte';
import { toast } from 'svelte-sonner';
import { duplicateSnapStep, findNextValidDuplicateDelta } from '$lib/model/Part/duplicateOffsets';

/** Oligos to copy from the selection: those passing the SCAF/STAP toggles, which must be
 * selected whole. Null (after a toast) when nothing usable is selected. */
function wholeSelectedOligos(editorCtx: EditorViewContext): Oligo[] | null {
	const { selected, selectionToggles } = editorCtx.strandViewContext;
	const includeScaffold = selectionToggles.includes('SCAF');
	const includeStaple = selectionToggles.includes('STAP');

	const touched = new Set<Oligo>();
	for (const end of selected.ends) {
		const oligo = end.segment?.oligo;
		if (!oligo) continue;
		if ((oligo.isScaffold && includeScaffold) || (!oligo.isScaffold && includeStaple)) {
			touched.add(oligo);
		}
	}
	if (touched.size === 0) return null;

	const oligos = [...touched];
	if (oligos.some((o) => !selected.includesAll([...o.allEnds]))) {
		toast.error('Duplicate needs whole oligos. Select every strand of each oligo to copy.');
		return null;
	}
	return oligos;
}

/** The repeat group a linked duplicate of `oligos` extends: null for a new group (no oligo
 * grouped yet), the group id when `oligos` are exactly its originals, undefined (after a
 * toast) for any other mix. */
function targetGroupFor(part: Part, oligos: Oligo[]): string | null | undefined {
	const groupIds = new Set(oligos.map((o) => o.repeatGroupId));
	if (groupIds.size === 1 && groupIds.has(null)) return null;
	const [groupId] = groupIds;
	if (groupIds.size === 1 && groupId) {
		const originals = part.realOligos.filter((o) => o.repeatGroupId === groupId);
		if (originals.length === oligos.length) return groupId;
		const name = part.getRepeatGroup(groupId)?.name ?? 'the repeat group';
		toast.error(`Select all originals of ${name} to add another mirror copy.`);
		return undefined;
	}
	toast.error(
		'Mirror copies need either oligos outside any repeat group, or all originals of one group.'
	);
	return undefined;
}

/** Enters DUPLICATE mode, previewing copies at the first valid offset to the right. Plain
 * duplicates copy the selected whole oligos; `linked` places mirror copies of the selection
 * (or, with `groupId`, another copy of that group's originals). */
export function startDuplicate(
	part: Part,
	editorCtx: EditorViewContext,
	opts: { linked?: boolean; groupId?: string } = {}
): void {
	if (editorCtx.editorMode !== 'SELECT') return;

	let oligos: Oligo[] | null;
	let groupId: string | null = null;
	if (opts.groupId) {
		groupId = opts.groupId;
		oligos = part.realOligos.filter((o) => o.repeatGroupId === groupId);
	} else {
		oligos = wholeSelectedOligos(editorCtx);
		if (!oligos) return;
		if (opts.linked) {
			const target = targetGroupFor(part, oligos);
			if (target === undefined) return;
			groupId = target;
		}
	}
	if (oligos.length === 0) return;

	const snapStep = duplicateSnapStep(part, oligos);
	const delta = findNextValidDuplicateDelta(part, oligos, 0, 1, snapStep);
	if (delta === null) {
		toast.error('No free position to place a copy to the right.');
		return;
	}

	editorCtx.strandViewContext.duplicateState = {
		oligos,
		linked: Boolean(opts.linked || opts.groupId),
		groupId,
		snapStep,
		anchorBp: null,
		baseDelta: delta,
		delta,
		check: { ok: true },
	};
	editorCtx.editorMode = 'DUPLICATE';
}

export function removeSelection(
	part: Part,
	selected: EndSelection,
	selectionToggles: SelectionToggle[],
	history: HistoryStack
) {
	const selectedEnds = selected.ends;
	const includeScaffold = selectionToggles.includes('SCAF');
	const includeStaple = selectionToggles.includes('STAP');

	// ── Step 1: Classify each touched oligo ──────────────────────────────
	const oligoStats = new Map<string, { oligo: Oligo; totalEnds: number; selectedCount: number }>();
	for (const end of selectedEnds) {
		const oligo = end.segment?.oligo;
		if (!oligo) continue;
		if (!oligoStats.has(oligo.id)) {
			let total = 0;
			for (const _seg of oligo.segments) total += 2;
			oligoStats.set(oligo.id, { oligo, totalEnds: total, selectedCount: 0 });
		}
		oligoStats.get(oligo.id)!.selectedCount++;
	}

	const oligosToDelete: Oligo[] = [];
	const partialOligoIds = new Set<string>();
	for (const { oligo, totalEnds, selectedCount } of oligoStats.values()) {
		const include = (includeScaffold && oligo.isScaffold) || (includeStaple && !oligo.isScaffold);
		if (!include) continue;
		if (selectedCount === totalEnds) oligosToDelete.push(oligo);
		else partialOligoIds.add(oligo.id);
	}

	// ── Step 2: Collect segment removals and crossover breaks ─────────────
	const segmentsToRemove: OligoSegment[] = [];
	const fullySelectedSegments = new Set<OligoSegment>();

	for (const end of selectedEnds) {
		const segment = end.segment;
		if (!segment?.oligo || !partialOligoIds.has(segment.oligo.id)) continue;
		if (fullySelectedSegments.has(segment)) continue;
		if (selectedEnds.has(segment.fivePrime) && selectedEnds.has(segment.threePrime)) {
			fullySelectedSegments.add(segment);
			segmentsToRemove.push(segment);
		}
	}

	const crossoversToBreak: { segment: OligoSegment; atIndex: number }[] = [];
	const seenCrossovers = new Set<string>();
	for (const end of selectedEnds) {
		const connectedEnd = end.connectedEnd;
		if (!connectedEnd) continue;
		// Both crossover ends must be selected to break the connection.
		if (!selectedEnds.has(connectedEnd)) continue;

		const segment = end.segment;
		if (!segment?.oligo || !partialOligoIds.has(segment.oligo.id)) continue;
		if (fullySelectedSegments.has(segment)) continue;
		const connectedSegment = connectedEnd.segment;
		if (connectedSegment && fullySelectedSegments.has(connectedSegment)) continue;

		// Canonicalize the pair so we don't enqueue the same crossover from both sides.
		// (After the first break the connected segment moves to a new oligo; the second
		//  attempt would use a stale oligo ref and throw.)
		const key = [segment.id, connectedSegment?.id ?? ''].sort().join('#');
		if (seenCrossovers.has(key)) continue;
		seenCrossovers.add(key);
		crossoversToBreak.push({ segment, atIndex: end.index });
	}

	if (!oligosToDelete.length && !segmentsToRemove.length && !crossoversToBreak.length) return;

	// ── Step 3: Execute in a single history transaction ───────────────────
	// Segment removals and crossover breaks resolve segment.oligo at execution
	// time (not pre-collected) so that earlier operations in the loop cannot
	// leave a stale reference for later ones.
	history.tx('Delete selection', (rec) => {
		// 3a: Full oligo deletions
		for (const oligo of oligosToDelete) {
			const scope = rec.capturePartScope(part, {
				oligoIds: [oligo.id],
				vhIndices: Array.from(oligo.segments, (s) => s.inVirtualHelix.index),
			});
			part.removeOligo(oligo);
			scope.commit();
		}

		// 3b: Segment removals — re-read segment.oligo each iteration because a
		// prior removal in the same batch may have split the original oligo.
		for (const segment of segmentsToRemove) {
			const oligo = segment.oligo;
			if (!oligo) continue;
			const scope = rec.capturePartScope(part, {
				oligoIds: [oligo.id],
				segmentIds: [segment.id],
				vhIndices: [segment.inVirtualHelix.index],
			});
			part.removeSegmentFromOligo(oligo, segment);
			scope.commit();
		}

		// 3c: Crossover breaks — re-read segment.oligo after all segment removals.
		for (const { segment, atIndex } of crossoversToBreak) {
			const oligo = segment.oligo;
			if (!oligo) continue;
			const scope = rec.capturePartScope(part, {
				oligoIds: [oligo.id],
				segmentIds: [segment.id],
				vhIndices: [segment.inVirtualHelix.index],
			});
			part.breakOligoAt(oligo, segment, atIndex);
			scope.commit();
		}
	});

	selected.clear();
}
