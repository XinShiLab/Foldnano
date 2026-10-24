import type { Part } from '../Part';
import type { DesignRegion } from '../Part/DesignRegion';
import { checkCadnanoProfile } from './cadnano';
import type { DesignIssue, DesignIssueSeverity } from './designIssue';
import { checkPartIntegrity } from './integrity';
import { checkSimulationProfile } from './simulation';

/** Which checks the editor's issue overlay runs. */
export interface DesignCheckSelection {
	integrity: boolean;
	simulation: boolean;
	/** Runs on the active region only: cadnano export is region-scoped. */
	cadnano: boolean;
}

const SEVERITY_ORDER: Record<DesignIssueSeverity, number> = { error: 0, warning: 1, info: 2 };

const issueKey = (issue: DesignIssue) => {
	const a = issue.anchor;
	return `${issue.rule}|${a?.regionId}|${a?.vhId}|${a?.strandIndex}|${a?.bp}`;
};

/**
 * The selected checks' issues for `part`, without duplicates (the profiles repeat some integrity
 * rules), errors first. Never throws.
 */
export function collectDesignIssues(
	part: Part | undefined,
	activeRegion: DesignRegion | null,
	selection: DesignCheckSelection
): DesignIssue[] {
	if (!part) return [];
	const issues: DesignIssue[] = [];
	if (selection.integrity) issues.push(...checkPartIntegrity(part));
	if (selection.simulation) issues.push(...checkSimulationProfile(part));
	if (selection.cadnano && activeRegion) issues.push(...checkCadnanoProfile(part, activeRegion));
	const seen = new Set<string>();
	return issues
		.filter((issue) => {
			const key = issueKey(issue);
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		})
		.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
