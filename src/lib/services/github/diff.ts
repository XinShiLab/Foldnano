/**
 * Line-based diff engine: linear-space Myers (divide and conquer on the middle snake).
 *
 * Input: two strings (a = left, b = right).
 * Output: array of hunks, each tagged as 'equal' | 'added' | 'removed', or null when the
 * inputs differ in more than `maxChanges` lines (too different to show line by line).
 *
 * 'added'   — lines present in b but not a (green in a two-column diff: right side)
 * 'removed' — lines present in a but not b (red in a two-column diff: left side)
 * 'equal'   — lines present in both
 *
 * Memory is O(N+M) and the change cap bounds time, so large design JSONs can't exhaust the tab
 * (see docs/github-integration.md § Diff engine).
 */

export type HunkType = 'equal' | 'added' | 'removed';

export interface DiffHunk {
	type: HunkType;
	lines: string[];
	/** 1-based line number in the left (local) file; null for 'added' hunks */
	leftStart: number | null;
	/** 1-based line number in the right (remote) file; null for 'removed' hunks */
	rightStart: number | null;
}

/** Past this many changed lines a line-by-line view is unreadable; computeDiff returns null. */
export const MAX_DIFF_CHANGES = 5000;

export interface DiffOptions {
	maxChanges?: number;
}

// ---------------------------------------------------------------------------
// Edit script
// ---------------------------------------------------------------------------

const EQUAL = 0;
const REMOVED = -1;
const ADDED = 1;
type Op = typeof EQUAL | typeof REMOVED | typeof ADDED;

/** A run of `count` lines of one op, starting at a[aStart] / b[bStart]. */
interface Run {
	op: Op;
	aStart: number;
	bStart: number;
	count: number;
}

class TooManyChanges extends Error {}

class EditScript {
	readonly runs: Run[] = [];

	push(op: Op, aStart: number, bStart: number, count: number): void {
		if (count <= 0) return;
		const last = this.runs.at(-1);
		if (last && last.op === op) last.count += count;
		else this.runs.push({ op, aStart, bStart, count });
	}
}

/** Maps each distinct line to a small integer so comparisons are number compares. */
function intern(aLines: string[], bLines: string[]): [Int32Array, Int32Array] {
	const ids = new Map<string, number>();
	const encode = (lines: string[]) =>
		Int32Array.from(lines, (line) => {
			let id = ids.get(line);
			if (id === undefined) ids.set(line, (id = ids.size));
			return id;
		});
	return [encode(aLines), encode(bLines)];
}

/**
 * Appends the edit script for a[aLo:aHi] → b[bLo:bHi] to `out`. `maxD` caps the search at the
 * top level only; sub-problems are smaller than their parent, so they always finish.
 */
function diffRange(
	a: Int32Array,
	b: Int32Array,
	aLo: number,
	aHi: number,
	bLo: number,
	bHi: number,
	out: EditScript,
	maxD: number
): void {
	// Common prefix and suffix.
	let prefix = 0;
	while (aLo + prefix < aHi && bLo + prefix < bHi && a[aLo + prefix] === b[bLo + prefix]) prefix++;
	out.push(EQUAL, aLo, bLo, prefix);
	aLo += prefix;
	bLo += prefix;
	let suffix = 0;
	while (aHi - suffix > aLo && bHi - suffix > bLo && a[aHi - suffix - 1] === b[bHi - suffix - 1])
		suffix++;
	const aEnd = aHi - suffix;
	const bEnd = bHi - suffix;

	if (aLo === aEnd) {
		out.push(ADDED, aLo, bLo, bEnd - bLo);
	} else if (bLo === bEnd) {
		out.push(REMOVED, aLo, bLo, aEnd - aLo);
	} else {
		const split = bisect(a, b, aLo, aEnd, bLo, bEnd, maxD);
		if (split) {
			diffRange(a, b, aLo, split[0], bLo, split[1], out, Infinity);
			diffRange(a, b, split[0], aEnd, split[1], bEnd, out, Infinity);
		} else {
			// No common line at all.
			out.push(REMOVED, aLo, bLo, aEnd - aLo);
			out.push(ADDED, aEnd, bLo, bEnd - bLo);
		}
	}

	out.push(EQUAL, aEnd, bEnd, suffix);
}

/**
 * Myers' middle snake (after diff-match-patch's `diff_bisect`): runs the forward and reverse
 * searches until they overlap and returns that split point, or null when the ranges share no
 * line. Throws TooManyChanges once the edit distance must exceed `maxD`.
 */
function bisect(
	a: Int32Array,
	b: Int32Array,
	aLo: number,
	aHi: number,
	bLo: number,
	bHi: number,
	maxD: number
): [number, number] | null {
	const n = aHi - aLo;
	const m = bHi - bLo;
	const maxSteps = Math.ceil((n + m) / 2);
	// Each step d covers up to two edits (one per direction).
	const stepLimit = Math.min(maxSteps, Math.ceil(maxD / 2) + 1);
	const offset = maxSteps;
	const size = 2 * maxSteps + 2;
	const v1 = new Int32Array(size).fill(-1);
	const v2 = new Int32Array(size).fill(-1);
	v1[offset + 1] = 0;
	v2[offset + 1] = 0;
	const delta = n - m;
	// Odd delta: check for overlap on the forward pass, otherwise on the reverse pass.
	const front = delta % 2 !== 0;
	let k1start = 0;
	let k1end = 0;
	let k2start = 0;
	let k2end = 0;

	for (let d = 0; d < maxSteps; d++) {
		if (d >= stepLimit) throw new TooManyChanges();

		for (let k1 = -d + k1start; k1 <= d - k1end; k1 += 2) {
			const k1i = offset + k1;
			let x1 = k1 === -d || (k1 !== d && v1[k1i - 1] < v1[k1i + 1]) ? v1[k1i + 1] : v1[k1i - 1] + 1;
			let y1 = x1 - k1;
			while (x1 < n && y1 < m && a[aLo + x1] === b[bLo + y1]) {
				x1++;
				y1++;
			}
			v1[k1i] = x1;
			if (x1 > n) k1end += 2;
			else if (y1 > m) k1start += 2;
			else if (front) {
				const k2i = offset + delta - k1;
				if (k2i >= 0 && k2i < size && v2[k2i] !== -1 && x1 >= n - v2[k2i]) {
					return [aLo + x1, bLo + y1];
				}
			}
		}

		for (let k2 = -d + k2start; k2 <= d - k2end; k2 += 2) {
			const k2i = offset + k2;
			let x2 = k2 === -d || (k2 !== d && v2[k2i - 1] < v2[k2i + 1]) ? v2[k2i + 1] : v2[k2i - 1] + 1;
			let y2 = x2 - k2;
			while (x2 < n && y2 < m && a[aHi - x2 - 1] === b[bHi - y2 - 1]) {
				x2++;
				y2++;
			}
			v2[k2i] = x2;
			if (x2 > n) k2end += 2;
			else if (y2 > m) k2start += 2;
			else if (!front) {
				const k1i = offset + delta - k2;
				if (k1i >= 0 && k1i < size && v1[k1i] !== -1) {
					const x1 = v1[k1i];
					const y1 = offset + x1 - k1i;
					if (x1 >= n - x2) return [aLo + x1, bLo + y1];
				}
			}
		}
	}
	return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute a line-by-line diff between two text strings.
 * Returns hunks in document order, or null when more than `maxChanges` lines differ.
 */
export function computeDiff(
	local: string,
	remote: string,
	{ maxChanges = MAX_DIFF_CHANGES }: DiffOptions = {}
): DiffHunk[] | null {
	const aLines = local.split('\n');
	const bLines = remote.split('\n');

	// Remove trailing empty line caused by a trailing newline
	if (aLines[aLines.length - 1] === '') aLines.pop();
	if (bLines[bLines.length - 1] === '') bLines.pop();

	const [a, b] = intern(aLines, bLines);
	const script = new EditScript();
	try {
		diffRange(a, b, 0, a.length, 0, b.length, script, maxChanges);
	} catch (e) {
		if (e instanceof TooManyChanges) return null;
		throw e;
	}

	let changed = 0;
	const hunks: DiffHunk[] = [];
	for (const { op, aStart, bStart, count } of script.runs) {
		if (op === EQUAL) {
			hunks.push({
				type: 'equal',
				lines: aLines.slice(aStart, aStart + count),
				leftStart: aStart + 1,
				rightStart: bStart + 1,
			});
		} else if (op === REMOVED) {
			changed += count;
			hunks.push({
				type: 'removed',
				lines: aLines.slice(aStart, aStart + count),
				leftStart: aStart + 1,
				rightStart: null,
			});
		} else {
			changed += count;
			hunks.push({
				type: 'added',
				lines: bLines.slice(bStart, bStart + count),
				leftStart: null,
				rightStart: bStart + 1,
			});
		}
	}
	// The search cap is per direction step, so the exact count can slightly exceed it.
	return changed > maxChanges ? null : hunks;
}

/**
 * Generate a conflict-marker text from local and remote strings.
 * Produces the standard Git conflict format:
 *   <<<<<<< Local
 *   ...local content...
 *   =======
 *   ...remote content...
 *   >>>>>>> Remote
 */
export function generateConflictMarkers(local: string, remote: string): string {
	return `<<<<<<< Local\n${local}\n=======\n${remote}\n>>>>>>> Remote`;
}
