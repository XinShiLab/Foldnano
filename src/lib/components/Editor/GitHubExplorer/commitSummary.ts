/** Outcome of committing several staged files, one GitHub commit per file. */
export interface CommitAllResult {
	committed: string[];
	/** Changed on GitHub since the last sync; not committed. */
	conflicts: string[];
	failed: { name: string; reason: string }[];
}

export interface CommitSummary {
	kind: 'success' | 'partial' | 'failure';
	title: string;
	/** One line per group of files that didn't go through, plus what to do next. */
	details: string[];
}

function plural(n: number, word: string): string {
	return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function summarizeCommitAll(result: CommitAllResult): CommitSummary {
	const done = result.committed.length;
	const notDone = result.conflicts.length + result.failed.length;
	const total = done + notDone;

	if (notDone === 0) {
		return { kind: 'success', title: `Committed ${plural(done, 'file')}`, details: [] };
	}

	const details: string[] = [];
	if (result.conflicts.length > 0) {
		details.push(
			`Changed on GitHub since your last sync (open each one and pull or review the diff first): ${result.conflicts.join(', ')}`
		);
	}
	for (const { name, reason } of result.failed) {
		details.push(`${name}: ${reason}`);
	}
	details.push('Files that were not committed stay in Changes; commit them again when ready.');

	return {
		kind: done > 0 ? 'partial' : 'failure',
		title: done > 0 ? `Committed ${done} of ${plural(total, 'file')}` : 'Nothing was committed',
		details,
	};
}
