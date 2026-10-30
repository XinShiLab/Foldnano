import type FoldnanoDocument from '../document.svelte';
import type { Part } from '../Part';
import type VirtualHelix from '../VirtualHelix';
import { isFrameOrthonormal } from '../geometry3d/dnaGeometry';
import type { DesignIssue } from './designIssue';

/** Rules for states the editor never creates itself (load, import and plugin results can). */
export const INTEGRITY_RULES = [
	'helix-cell-parity',
	'negative-cell',
	'shared-cell',
	'asymmetric-skip-insert',
	'skip-insert-on-crossover',
	'freeform-frame',
] as const;
export type IntegrityRule = (typeof INTEGRITY_RULES)[number];

const mod2 = (n: number) => ((n % 2) + 2) % 2;

function isConstrainedCrossoverAt(part: Part, vh: VirtualHelix, bp: number): boolean {
	if (!part.getRegionForVh(vh).supportsConstrainedXoverSites) return false;
	return ([0, 1] as const).some((strandIdx) => {
		const { end } = part.getEntitiesAtVh(vh.id, strandIdx, bp);
		return !!end && !end.isFree && end.isConstrained;
	});
}

function checkLatticeCells(
	part: Part,
	vhs: VirtualHelix[],
	issues: DesignIssue<IntegrityRule>[]
): void {
	const byCell = new Map<string, VirtualHelix>();
	for (const vh of vhs) {
		const cell = vh.latticeCoords;
		if (!cell || !part.getRegionForVh(vh).supportsLatticeGrid) continue;
		const anchor = { regionId: vh.regionId, vhId: vh.id, vhIndex: vh.index };
		if (cell.row < 0 || cell.col < 0) {
			issues.push({
				rule: 'negative-cell',
				severity: 'error',
				message: `Helix ${vh.index} sits at a negative lattice position (row ${cell.row}, col ${cell.col}).`,
				anchor,
			});
		}
		const key = `${vh.regionId}:${cell.row}:${cell.col}`;
		const other = byCell.get(key);
		if (other) {
			issues.push({
				rule: 'shared-cell',
				severity: 'error',
				message: `Helices ${other.index} and ${vh.index} share lattice position (row ${cell.row}, col ${cell.col}).`,
				anchor,
			});
		} else {
			byCell.set(key, vh);
		}
		const evenCell = mod2(cell.row) === mod2(cell.col);
		if (evenCell !== (mod2(vh.index) === 0)) {
			issues.push({
				rule: 'helix-cell-parity',
				severity: 'warning',
				message: `Helix ${vh.index} has an ${evenCell ? 'odd' : 'even'} number on an ${evenCell ? 'even' : 'odd'} lattice cell (row ${cell.row}, col ${cell.col}); cadnano export and crossover sites assume they match.`,
				anchor,
			});
		}
	}
}

function checkFreeformFrame(vh: VirtualHelix, issues: DesignIssue<IntegrityRule>[]): void {
	if (!vh.localFrame || isFrameOrthonormal(vh.localFrame)) return;
	issues.push({
		rule: 'freeform-frame',
		severity: 'warning',
		message: `Helix ${vh.index} has a frame whose axis or radial0 is not a unit vector, or whose radial0 is not perpendicular to the axis; the 3D view and export distort it. Set its roll in the Select panel to rebuild the frame.`,
		anchor: { regionId: vh.regionId, vhId: vh.id, vhIndex: vh.index },
	});
}

/** Slot length per strand at each base of `vh`; `undefined` where that strand has no segment. */
export function slotLengthsByBp(
	part: Part,
	vh: VirtualHelix
): Map<number, [number | undefined, number | undefined]> {
	const lengths = new Map<number, [number | undefined, number | undefined]>();
	for (const strandSet of vh.strandSets) {
		for (const segId of strandSet.segmentIds) {
			const seg = part.getSegmentById(segId);
			if (!seg) continue;
			for (const slot of seg.slots) {
				const pair = lengths.get(slot.bpIndex) ?? [undefined, undefined];
				pair[strandSet.strandIndex] = slot.seq.length;
				lengths.set(slot.bpIndex, pair);
			}
		}
	}
	return lengths;
}

function checkSkipsAndInserts(
	part: Part,
	vh: VirtualHelix,
	issues: DesignIssue<IntegrityRule>[]
): void {
	const lengths = slotLengthsByBp(part, vh);
	for (const [bp, [len0, len1]] of lengths) {
		const modified = (len0 !== undefined && len0 !== 1) || (len1 !== undefined && len1 !== 1);
		if (!modified) continue;
		const anchor = { regionId: vh.regionId, vhId: vh.id, vhIndex: vh.index, bp };
		// One strand alone may carry a skip/insert (its partner strand was deleted); only a mismatch counts.
		if (len0 !== undefined && len1 !== undefined && len0 !== len1) {
			issues.push({
				rule: 'asymmetric-skip-insert',
				severity: 'error',
				message: `Helix ${vh.index} base ${bp} has a different skip/insert on each strand (${len0 - 1} vs ${len1 - 1} extra bases).`,
				anchor,
			});
		}
		if (isConstrainedCrossoverAt(part, vh, bp)) {
			issues.push({
				rule: 'skip-insert-on-crossover',
				severity: 'error',
				message: `Helix ${vh.index} base ${bp} has a skip/insert on a constrained crossover site.`,
				anchor,
			});
		}
	}
}

/** Integrity issues of a Part, or of only the given regions. Never throws. */
export function checkPartIntegrity(
	part: Part,
	regionIds?: ReadonlySet<string>
): DesignIssue<IntegrityRule>[] {
	const vhs = part.virtualHelices.filter(
		(vh) => !regionIds || (vh.regionId !== undefined && regionIds.has(vh.regionId))
	);
	const issues: DesignIssue<IntegrityRule>[] = [];
	checkLatticeCells(part, vhs, issues);
	for (const vh of vhs) {
		checkSkipsAndInserts(part, vh, issues);
		checkFreeformFrame(vh, issues);
	}
	return issues;
}

export function checkDocumentIntegrity(doc: FoldnanoDocument): DesignIssue<IntegrityRule>[] {
	return doc.parts.flatMap((part) => checkPartIntegrity(part));
}
