import type { Part } from '../Part';
import type { DesignRegion } from '../Part/DesignRegion';
import type OligoSegment from '../Oligo/OligoSegment.svelte';
import { latticesByLength } from '../io/cadnanoLattice';
import type { DesignIssue } from './designIssue';
import { checkPartIntegrity, type IntegrityRule } from './integrity';

/** What `CadnanoJSON.fromRegion` can't write faithfully. */
export const CADNANO_RULES = [
	'cadnano-no-lattice',
	'cadnano-strand-class',
	'cadnano-cross-region',
	'cadnano-mirror-oligo',
	'cadnano-lattice-length',
	'cadnano-metadata',
] as const;
export type CadnanoRule = (typeof CADNANO_RULES)[number];
export type CadnanoProfileIssue = DesignIssue<IntegrityRule | CadnanoRule>;

const LATTICE_REPEAT = { HONEYCOMB: 21, SQUARE: 32 } as const;

// cadnano allows (and our importer relocates) skips on crossover bases, so that rule doesn't apply here.
const CADNANO_INTEGRITY_RULES: ReadonlySet<IntegrityRule> = new Set([
	'helix-cell-parity',
	'negative-cell',
	'shared-cell',
	'asymmetric-skip-insert',
]);

/** cadnano keeps scaffold and staple paths in separate arrays, chosen by helix and strand parity. */
const cadnanoArrayOf = (seg: OligoSegment): 'scaf' | 'stap' =>
	(seg.inVirtualHelix.index + seg.inStrandIndex) % 2 === 0 ? 'scaf' : 'stap';

const anchorOf = (seg: OligoSegment, bp: number) => ({
	regionId: seg.inVirtualHelix.regionId,
	vhId: seg.inVirtualHelix.id,
	vhIndex: seg.inVirtualHelix.index,
	strandIndex: seg.inStrandIndex,
	bp,
	segmentId: seg.id,
	oligoId: seg.oligo?.id,
});

/** Issues exporting `region` to cadnano JSON would hit, worst first within each rule. Never throws. */
export function checkCadnanoProfile(part: Part, region: DesignRegion): CadnanoProfileIssue[] {
	if (!region.supportsLatticeGrid) {
		return [
			{
				rule: 'cadnano-no-lattice',
				severity: 'error',
				message: `Region "${region.name}" isn't a lattice region; cadnano can only hold honeycomb or square lattices.`,
				anchor: { regionId: region.id },
			},
		];
	}
	const vhs = part.virtualHelices.filter((vh) => vh.regionId === region.id);
	const issues: CadnanoProfileIssue[] = [];
	for (const vh of vhs.filter((vh) => !vh.latticeCoords)) {
		issues.push({
			rule: 'cadnano-no-lattice',
			severity: 'error',
			message: `Helix ${vh.index} has no lattice position.`,
			anchor: { regionId: region.id, vhId: vh.id, vhIndex: vh.index },
		});
	}
	issues.push(
		...checkPartIntegrity(part, new Set([region.id])).filter((issue) =>
			CADNANO_INTEGRITY_RULES.has(issue.rule)
		)
	);

	const regionVhIds = new Set(vhs.map((vh) => vh.id));
	const segments = vhs.flatMap((vh) =>
		vh.strandSets.flatMap((ss) =>
			Array.from(ss.segmentIds, (id) => part.getSegmentById(id)).filter(
				(seg): seg is OligoSegment => !!seg
			)
		)
	);
	const mirrorOligos = new Set<string>();
	let crossRegion = 0;
	for (const seg of segments) {
		if (seg.oligo?.isMirror) {
			mirrorOligos.add(seg.oligo.id);
			continue;
		}
		const next = seg.threePrime.connectedSegment;
		if (next && !next.oligo?.isMirror) {
			if (!regionVhIds.has(next.inVirtualHelix.id)) {
				crossRegion++;
			} else if (cadnanoArrayOf(seg) !== cadnanoArrayOf(next)) {
				issues.push({
					rule: 'cadnano-strand-class',
					severity: 'error',
					message: `The connection from helix ${seg.inVirtualHelix.index} base ${seg.threePrime.index} to helix ${next.inVirtualHelix.index} base ${next.fivePrime.index} joins a cadnano scaffold path to a staple path, which cadnano can't store.`,
					anchor: anchorOf(seg, seg.threePrime.index),
				});
			}
		}
		const prev = seg.fivePrime.connectedSegment;
		if (prev && !regionVhIds.has(prev.inVirtualHelix.id)) crossRegion++;
	}
	if (crossRegion > 0) {
		issues.push({
			rule: 'cadnano-cross-region',
			severity: 'warning',
			message: `${crossRegion} connection(s) to other regions will be cut; cadnano can't link regions.`,
			anchor: { regionId: region.id },
		});
	}
	if (mirrorOligos.size > 0) {
		issues.push({
			rule: 'cadnano-mirror-oligo',
			severity: 'warning',
			message: `${mirrorOligos.size} repeat-group copy oligo(s) will be left out; cadnano has no repeat groups.`,
			anchor: { regionId: region.id },
		});
	}

	const length = vhs[0]?.length ?? region.maxBase;
	const kind = region.kind as keyof typeof LATTICE_REPEAT;
	if (length % LATTICE_REPEAT[kind] !== 0) {
		issues.push({
			rule: 'cadnano-lattice-length',
			severity: 'error',
			message: `Helices are ${length} bases long, not a multiple of ${LATTICE_REPEAT[kind]}; cadnano can't open a ${kind.toLowerCase()} design of that length.`,
			anchor: { regionId: region.id },
		});
	} else if (latticesByLength(length).length > 1) {
		// cadnano can't tell either: it asks "is this design in square lattice?" when opening it.
		const other = kind === 'HONEYCOMB' ? 'square' : 'honeycomb';
		issues.push({
			rule: 'cadnano-lattice-length',
			severity: 'warning',
			message: `Helices are ${length} bases long, which also fits a ${other} lattice, so cadnano asks whether the design is square when it opens the file. Answer ${kind === 'SQUARE' ? 'yes' : 'no'} to keep it ${kind.toLowerCase()}. Foldnano works it out on its own.`,
			anchor: { regionId: region.id },
		});
	}

	const kept = segments.filter((seg) => !seg.oligo?.isMirror);
	const lost: string[] = [];
	if (kept.some((seg) => seg.slots.some((slot) => /[ACGTU]/i.test(slot.seq))))
		lost.push('sequences');
	if (kept.some((seg) => seg.fivePrime.modification || seg.threePrime.modification)) {
		lost.push('modifications');
	}
	if (kept.some((seg) => seg.oligo?.name)) lost.push('oligo names');
	if (kept.some((seg) => seg.oligo?.isScaffold)) lost.push('the scaffold label');
	if (lost.length > 0) {
		issues.push({
			rule: 'cadnano-metadata',
			severity: 'info',
			message: `Not stored in cadnano JSON: ${lost.join(', ')}.`,
			anchor: { regionId: region.id },
		});
	}
	return issues;
}
