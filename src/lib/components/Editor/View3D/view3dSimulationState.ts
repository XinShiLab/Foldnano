import type { Part } from '$lib/model/Part';
import { buildBlocksAndConstraints } from '$lib/model/rbs/buildBlocks';
import type { BlockBuildResult, BlockTransformOverride } from '$lib/model/rbs/rbsTypes';
import type { RbsDiagnostics } from './rbs/rbsSimulation';

/** A relaxation result kept for a Part while another Part is active (transient, never saved). */
export interface PartRelaxation {
	overrides: Map<string, BlockTransformOverride>;
	stressMap: Map<string, number>;
	sig: string;
	diagnostics: RbsDiagnostics | null;
	/** "Use relaxed positions" was on when the Part was left. */
	shown: boolean;
}

const num = (n: number) => n.toFixed(4);
const vecSig = (v: { x: number; y: number; z: number }) => `${num(v.x)},${num(v.y)},${num(v.z)}`;

/**
 * Everything the solver is given (`BlockBuildResult`): each block's spans, rest center and
 * collision capsules, and each crossover constraint's blocks, attach points and rest length. A
 * result is current exactly while this is unchanged: welding a crossover, a twist offset, a helix
 * move or a plane move all show up here, ids or no ids.
 */
export function solverInputSignature({ blocks, constraints }: BlockBuildResult): string {
	const blockSig = blocks
		.map((b) => {
			const spans = b.spans
				.map((s) => `${s.spanId}:${s.vhIndex}.${s.strandIdx}:${s.lo}-${s.hi}`)
				.join(',');
			const capsules = b.collisionCapsules
				.map((c) => `${vecSig(c.localStart)}>${vecSig(c.localEnd)}r${num(c.radius)}`)
				.join(',');
			return `${b.blockId}[${spans}]@${vecSig(b.originalCenter)}{${capsules}}`;
		})
		.join('|');
	const constraintSig = constraints
		.map(
			(c) =>
				`${c.id}:${c.blockIdA}-${c.blockIdB}:${vecSig(c.localAttachA)}:${vecSig(c.localAttachB)}:${num(c.restLength)}`
		)
		.join('|');
	return `${blockSig}#${constraintSig}`;
}

/** `solverInputSignature` of the Part as it is now. Builds the solver input, so call it only when
 * there is a result to compare with. */
export function computeSimulationFreshnessSignature(part: Part): string {
	return solverInputSignature(buildBlocksAndConstraints(part));
}

/**
 * The design's layout as a replay maps it: planes, every helix's lab frame, every segment's range,
 * skips/inserts and crossover. A loaded oxDNA trajectory is stale once this changes; cheaper than
 * the solver input, and unlike it counts skips and inserts, which change the nucleotide count.
 */
export function designLayoutSignature(part: Part): string {
	const helices = part.virtualHelices
		.map((vh) => {
			const { origin, axis, radial0 } = part.getVirtualHelixFrame(vh);
			return `${vh.id}:${vecSig(origin)}:${vecSig(axis)}:${vecSig(radial0)}`;
		})
		.sort()
		.join('|');
	const segments = [...part.segmentsLookup.values()]
		.map(
			(seg) =>
				`${seg.id}:${seg.fivePrime.index}-${seg.threePrime.index}:${seg.skipsAndInserts.join(';')}>${seg.threePrime.connectedSegment?.id ?? ''}`
		)
		.sort()
		.join('|');
	const planes = part.planes
		.map((p) => `${p.id}:${vecSig(p.origin)}:${vecSig(p.u)}:${vecSig(p.v)}:${vecSig(p.normal)}`)
		.join('|');
	return `${planes}#${helices}#${segments}`;
}

/**
 * The relaxed poses a kept result gives a Part that isn't active: only while it is shown and the
 * Part's design still matches it, since no stale warning is on screen for that Part.
 */
export function keptRelaxedPoses(
	part: Part,
	kept: PartRelaxation | undefined
): Map<string, BlockTransformOverride> | undefined {
	if (!kept?.shown || kept.sig !== computeSimulationFreshnessSignature(part)) return undefined;
	return kept.overrides;
}

/** Relaxed poses by Part id: the active Part's shown result, and each other Part's kept one. */
export function relaxedPartPoses(
	parts: readonly Part[],
	active: { partId: string; overrides: Map<string, BlockTransformOverride> | undefined },
	kept: ReadonlyMap<string, PartRelaxation>
): Map<string, Map<string, BlockTransformOverride>> {
	const poses = new Map<string, Map<string, BlockTransformOverride>>();
	for (const part of parts) {
		const overrides =
			part.id === active.partId ? active.overrides : keptRelaxedPoses(part, kept.get(part.id));
		if (overrides?.size) poses.set(part.id, overrides);
	}
	return poses;
}
