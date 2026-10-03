// Shared by the two published-corpus report generators (cadnano round-trip and sequence comparison).
// Both commit their reports, so both need locale-independent ordering and an all-or-nothing write.

import * as fs from 'fs';

/** `localeCompare` is locale-dependent, so it would reorder a committed report on another machine. */
export function byCodeUnit(left: string, right: string): number {
	if (left < right) return -1;
	return left > right ? 1 : 0;
}

export interface ReportFile {
	path: string;
	contents: string;
}

/**
 * Replace every report or none. A plain sequence of writes can leave a new markdown report beside a
 * stale JSON one, which the freshness test then reports as a content difference rather than a failed
 * write.
 */
export function writeReportFilesAtomically(files: readonly ReportFile[]): void {
	const suffix = `${process.pid}.${Date.now()}`;
	const staged: Array<{ destination: string; temp: string }> = [];
	try {
		for (const file of files) {
			const temp = `${file.path}.tmp-${suffix}`;
			fs.writeFileSync(temp, file.contents);
			staged.push({ destination: file.path, temp });
		}
	} catch (error) {
		for (const { temp } of staged) fs.rmSync(temp, { force: true });
		throw error;
	}

	// Every file is on disk now, so only the renames remain. Back each destination up first so a
	// failure part-way through restores what was there instead of leaving a mixed set.
	const installed: Array<{ destination: string; backup: string | null }> = [];
	try {
		for (const { destination, temp } of staged) {
			let backup: string | null = null;
			if (fs.existsSync(destination)) {
				backup = `${destination}.bak-${suffix}`;
				fs.copyFileSync(destination, backup);
			}
			// Registered before the rename is attempted: if the rename itself throws, this entry
			// still needs the catch block below to clean up the backup it just made (rename is
			// atomic, so `destination` itself is untouched either way).
			installed.push({ destination, backup });
			fs.renameSync(temp, destination);
		}
	} catch (error) {
		// A backup is deleted only once it's confirmed restored (or was never needed). If restoring
		// one itself throws, that backup is left on disk rather than deleted, so the original content
		// isn't lost — the destination is broken either way, but recoverably rather than silently.
		const unrestored: string[] = [];
		for (const { destination, backup } of [...installed].reverse()) {
			try {
				if (backup) {
					fs.copyFileSync(backup, destination);
					fs.rmSync(backup, { force: true });
				} else {
					fs.rmSync(destination, { force: true });
				}
			} catch {
				if (backup) unrestored.push(backup);
			}
		}
		for (const { temp } of staged) fs.rmSync(temp, { force: true });
		if (unrestored.length > 0) {
			const original = error instanceof Error ? error.message : String(error);
			throw new Error(
				`report write failed (${original}); also failed to restore from backup(s), left in place for manual recovery: ${unrestored.join(', ')}`
			);
		}
		throw error;
	}
	for (const { backup } of installed) if (backup) fs.rmSync(backup, { force: true });
	for (const { temp } of staged) fs.rmSync(temp, { force: true });
}

/**
 * Compares against the actual expected corpus, not just a count: a run over ten unique but wrong
 * names (or with one design duplicated in place of another) would otherwise pass silently.
 */
export function designSetProblems(
	names: readonly string[],
	expectedNames: readonly string[]
): string[] {
	const distinct = new Set(names);
	const expected = new Set(expectedNames);
	const problems: string[] = [];
	if (names.length !== expectedNames.length || distinct.size !== expected.size) {
		problems.push(
			`${names.length} result(s) covering ${distinct.size} distinct design(s), expected ${expectedNames.length} of each`
		);
	}
	const missing = [...expected].filter((name) => !distinct.has(name)).sort(byCodeUnit);
	if (missing.length > 0) problems.push(`missing design(s): ${missing.join(', ')}`);
	const unexpected = [...distinct].filter((name) => !expected.has(name)).sort(byCodeUnit);
	if (unexpected.length > 0) {
		problems.push(`design(s) not in the corpus: ${unexpected.join(', ')}`);
	}
	return problems;
}
