import type { Part } from '../Part';
import type { DesignIssue } from './designIssue';
import { checkPartIntegrity, slotLengthsByBp, type IntegrityRule } from './integrity';

/** Fine in the editor, but the NT model (and so oxDNA / mrDNA) can't place it. */
export const SIMULATION_RULES = ['unpaired-skip-insert'] as const;
export type SimulationRule = (typeof SIMULATION_RULES)[number];

// The integrity errors that also break the NT model's paired-layer geometry.
const SIMULATION_INTEGRITY_RULES: ReadonlySet<IntegrityRule> = new Set([
	'asymmetric-skip-insert',
	'skip-insert-on-crossover',
]);

/** Everything that keeps `part` from building a simulation NT model. Never throws. */
export function checkSimulationProfile(part: Part): DesignIssue<IntegrityRule | SimulationRule>[] {
	const issues: DesignIssue<IntegrityRule | SimulationRule>[] = checkPartIntegrity(part).filter(
		(issue) => SIMULATION_INTEGRITY_RULES.has(issue.rule)
	);
	for (const vh of part.virtualHelices) {
		for (const [bp, [len0, len1]] of slotLengthsByBp(part, vh)) {
			const lone = len0 === undefined ? len1 : len1 === undefined ? len0 : undefined;
			if (lone === undefined || lone === 1) continue;
			issues.push({
				rule: 'unpaired-skip-insert',
				severity: 'error',
				message:
					lone === 0
						? `Helix ${vh.index} base ${bp} has a skip on one strand only. Make the single-stranded DNA explicit in the design (shorten the strand instead of skipping a base), or remove the skip for simulation.`
						: `Helix ${vh.index} base ${bp} has an insert on one strand only. Make the single-stranded DNA explicit in the design (draw the extra bases as strand bases, not as an insert), or remove the insert for simulation.`,
				anchor: { regionId: vh.regionId, vhId: vh.id, vhIndex: vh.index, bp },
			});
		}
	}
	return issues;
}

/** Throws the first simulation-profile error, for the NT model builder and the exporters. */
export function assertSimulationReady(part: Part): void {
	const error = checkSimulationProfile(part).find((issue) => issue.severity === 'error');
	if (error) throw new Error(`Cannot export simulation model: ${error.message}`);
}
