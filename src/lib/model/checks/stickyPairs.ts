import type FoldnanoDocument from '../document.svelte';
import type { Part } from '../Part';
import {
	resolveRecord,
	stickyPairStatus,
	type ResolvedSide,
	type StickyRecord,
} from '../stickyEnds/stickyPairs';
import type { DesignIssue, DesignIssueAnchor } from './designIssue';

export type StickyPairRule = 'sticky-pair-broken' | 'sticky-pair-missing';

function anchorIn(part: Part, sides: (ResolvedSide | null)[]): DesignIssueAnchor | undefined {
	const side = sides.find((s) => s?.part.id === part.id);
	const base = side?.positions[0];
	if (!side || !base) return undefined;
	const vh = part.getVhById(base.vhId);
	return {
		regionId: vh?.regionId,
		vhId: base.vhId,
		vhIndex: vh?.index,
		strandIndex: base.strandIdx,
		bp: base.bpIndex,
		oligoId: side.oligoId,
	};
}

/**
 * Warnings for the saved sticky-end pairs reaching `part` (its own, and the assembly's that join
 * it to another Part) that no longer match or lost a side. Matches nobody paired are never
 * checked: unmarked sticky ends are normal. See docs/sticky-ends.md.
 */
export function checkStickyPairs(
	doc: FoldnanoDocument | undefined,
	part: Part
): DesignIssue<StickyPairRule>[] {
	const parts = doc?.parts ?? [part];
	const reaching = (record: StickyRecord) =>
		record.a.partId === part.id || record.b.partId === part.id;
	const saved: [Part | null, StickyRecord][] = [
		...part.stickyRecords.pairs.map((record): [Part, StickyRecord] => [part, record]),
		...(doc?.assembly.stickyRecords.pairs ?? [])
			.filter(reaching)
			.map((record): [null, StickyRecord] => [null, record]),
	];
	const issues: DesignIssue<StickyPairRule>[] = [];
	for (const [home, record] of saved) {
		const sides = resolveRecord(parts, home, record);
		const status = stickyPairStatus(sides);
		const anchor = anchorIn(part, sides);
		if (status === 'missing') {
			issues.push({
				rule: 'sticky-pair-missing',
				severity: 'warning',
				message: `A pair of sticky ends lost a side: its strand was deleted or shortened. Unpair it in the Sticky Ends panel if it is no longer meant.`,
				anchor,
			});
		} else if (status === 'broken' || status === 'partial') {
			issues.push({
				rule: 'sticky-pair-broken',
				severity: 'warning',
				message:
					status === 'broken'
						? `Paired sticky ends (${record.length} nt) are no longer complementary.`
						: `Paired sticky ends now match over only part of their ${record.length} nt.`,
				anchor,
			});
		}
	}
	return issues;
}
