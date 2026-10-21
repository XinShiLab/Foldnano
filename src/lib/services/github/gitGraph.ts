/**
 * Git graph layout engine.
 *
 * Takes a list of commits (topological order, newest-first) and branch refs,
 * and computes per-row lane assignments + SVG drawing instructions for rendering
 * a commit DAG similar to `git log --graph`.
 */

import type { GitHubCommit, GitHubBranch } from './types';

// ─── Constants ───────────────────────────────────────────────────────────────

export const LANE_WIDTH = 16; // px between lane centres
export const ROW_HEIGHT = 28; // px per commit row
export const DOT_RADIUS = 4; // px
export const HALF_ROW = ROW_HEIGHT / 2; // y of dot
export const CORNER_RADIUS = 8; // px, rounded elbow where a line changes lane
export const GRAPH_BRANCH_LIMIT = 12; // branches whose history is fetched (one request each)

export const LANE_COLORS = [
	'#4183f5', // blue
	'#e94235', // red
	'#33a853', // green
	'#f9a825', // amber
	'#9c27b0', // purple
	'#00bcd4', // cyan
	'#ff7043', // deep-orange
	'#795548', // brown
];

export function laneColor(laneIdx: number): string {
	return LANE_COLORS[laneIdx % LANE_COLORS.length];
}

/** x-centre of lane k in the SVG */
export function lx(k: number): number {
	return k * LANE_WIDTH + LANE_WIDTH / 2;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DrawLine {
	type: 'line';
	x1: number;
	y1: number;
	x2: number;
	y2: number;
	color: string;
}
export interface DrawDot {
	type: 'dot';
	cx: number;
	cy: number;
	color: string;
}
export interface DrawPath {
	type: 'path';
	d: string;
	color: string;
}
export type DrawInstruction = DrawLine | DrawPath | DrawDot;

export interface CommitNode {
	sha: string;
	shortSha: string;
	shortMessage: string; // first line, max 72 chars
	authorName: string | null;
	authorDate: string | null; // ISO string
	branchLabels: string[];
	isCurrentBranch: boolean; // at least one label === currentBranch
	lane: number;
	parentLanes: number[];
	/** Other lanes that were also waiting for this commit; they end here, joining the dot. */
	joiningLanes: number[];
	entering: (string | null)[];
	exiting: (string | null)[];
	/** Total lane count for this row (determines SVG width). */
	maxLanes: number;
}

// ─── Branch selection ────────────────────────────────────────────────────────

/**
 * The branches whose history the graph loads: the current and default branches always, then the
 * rest in the order GitHub listed them, up to `limit`.
 */
export function pickGraphBranches(
	branches: GitHubBranch[],
	currentBranch: string,
	defaultBranch: string | null,
	limit = GRAPH_BRANCH_LIMIT
): GitHubBranch[] {
	const pinned = [currentBranch, defaultBranch];
	const first = pinned.flatMap((name) => branches.filter((b) => b.name === name));
	const rest = branches.filter((b) => !pinned.includes(b.name));
	return [...new Set([...first, ...rest])].slice(0, limit);
}

// ─── Layout ──────────────────────────────────────────────────────────────────

/**
 * Given commits in topological (newest-first) order and branch tip refs,
 * return a CommitNode for each commit.
 */
export function computeLayout(
	commits: GitHubCommit[],
	branches: GitHubBranch[],
	currentBranch: string
): CommitNode[] {
	// sha → branch names
	const branchMap = new Map<string, string[]>();
	for (const b of branches) {
		const arr = branchMap.get(b.commit.sha) ?? [];
		arr.push(b.name);
		branchMap.set(b.commit.sha, arr);
	}

	// activeLanes[k] = sha that lane k is "looking for" going downward (null = free)
	const activeLanes: (string | null)[] = [];

	function firstFreeSlot(exclude = -1): number {
		for (let i = 0; i < activeLanes.length; i++) {
			if (i !== exclude && activeLanes[i] === null) return i;
		}
		return activeLanes.length;
	}

	function setSlot(idx: number, value: string | null) {
		if (idx === activeLanes.length) activeLanes.push(value);
		else activeLanes[idx] = value;
	}

	const rows: CommitNode[] = [];

	for (const rawCommit of commits) {
		// Capture state entering this row
		const entering: (string | null)[] = [...activeLanes];

		// Every lane waiting for this commit converges on its dot; the lowest one carries on
		const waiting: number[] = [];
		for (let k = 0; k < activeLanes.length; k++) {
			if (activeLanes[k] === rawCommit.sha) waiting.push(k);
		}
		let lane: number;
		if (waiting.length > 0) {
			lane = waiting[0];
		} else {
			lane = firstFreeSlot();
			setSlot(lane, rawCommit.sha);
		}
		const joiningLanes = waiting.slice(1);
		for (const k of joiningLanes) activeLanes[k] = null;

		const parentLanes: number[] = [];
		const parents = rawCommit.parents ?? [];

		for (let i = 0; i < parents.length; i++) {
			const parentSha = parents[i].sha;

			if (i === 0) {
				// Stay in this lane even if another lane already tracks the parent, so the branch
				// line runs straight down to its fork point and joins there.
				activeLanes[lane] = parentSha;
				parentLanes.push(lane);
				continue;
			}

			let existingLane = -1;
			for (let k = 0; k < activeLanes.length; k++) {
				if (k !== lane && activeLanes[k] === parentSha) {
					existingLane = k;
					break;
				}
			}
			if (existingLane !== -1) {
				parentLanes.push(existingLane);
			} else {
				const slot = firstFreeSlot(lane);
				setSlot(slot, parentSha);
				parentLanes.push(slot);
			}
		}

		if (parents.length === 0) {
			// Root commit — free the lane
			activeLanes[lane] = null;
		}

		// Trim trailing nulls
		while (activeLanes.length > 0 && activeLanes[activeLanes.length - 1] === null) {
			activeLanes.pop();
		}

		const exiting: (string | null)[] = [...activeLanes];

		const maxLanes = Math.max(
			entering.length,
			exiting.length,
			lane + 1,
			...parentLanes.map((l) => l + 1)
		);

		const branchLabels = branchMap.get(rawCommit.sha) ?? [];
		const firstLine = rawCommit.commit.message.split('\n')[0];

		rows.push({
			sha: rawCommit.sha,
			shortSha: rawCommit.sha.slice(0, 7),
			shortMessage: firstLine.length > 80 ? firstLine.slice(0, 80) + '…' : firstLine,
			authorName: rawCommit.commit.author?.name ?? null,
			authorDate: rawCommit.commit.author?.date ?? null,
			branchLabels,
			isCurrentBranch: branchLabels.includes(currentBranch),
			lane,
			parentLanes,
			joiningLanes,
			entering,
			exiting,
			maxLanes,
		});
	}

	return rows;
}

// ─── Drawing instructions ────────────────────────────────────────────────────

/** Rounded elbow from the dot sideways into lane x1, then down to the row's bottom edge. */
function elbowDown(x0: number, x1: number): string {
	const r = Math.min(CORNER_RADIUS, Math.abs(x1 - x0), HALF_ROW);
	const s = Math.sign(x1 - x0);
	const sweep = s > 0 ? 1 : 0;
	return `M ${x0} ${HALF_ROW} H ${x1 - s * r} A ${r} ${r} 0 0 ${sweep} ${x1} ${HALF_ROW + r} V ${ROW_HEIGHT}`;
}

/** Rounded elbow from the top of lane x1 down, then sideways into the dot at x0. */
function elbowUp(x0: number, x1: number): string {
	const r = Math.min(CORNER_RADIUS, Math.abs(x1 - x0), HALF_ROW);
	const s = Math.sign(x1 - x0);
	const sweep = s > 0 ? 1 : 0;
	return `M ${x1} 0 V ${HALF_ROW - r} A ${r} ${r} 0 0 ${sweep} ${x1 - s * r} ${HALF_ROW} H ${x0}`;
}

/**
 * Compute SVG draw instructions for a single commit row. Lines that change lane are drawn as
 * a horizontal run plus a rounded corner, never a diagonal; the dot comes last so it sits on top.
 */
export function rowInstructions(node: CommitNode): DrawInstruction[] {
	const { lane, entering, exiting, parentLanes, joiningLanes } = node;
	const instructions: DrawInstruction[] = [];
	const x0 = lx(lane);

	// Pass-through lanes: same sha above and below, untouched by this commit
	const maxK = Math.max(entering.length, exiting.length);
	for (let k = 0; k < maxK; k++) {
		if (k === lane) continue;
		const above = entering[k] ?? null;
		if (above !== null && above === (exiting[k] ?? null)) {
			instructions.push({
				type: 'line',
				x1: lx(k),
				y1: 0,
				x2: lx(k),
				y2: ROW_HEIGHT,
				color: laneColor(k),
			});
		}
	}

	if ((entering[lane] ?? null) !== null) {
		instructions.push({
			type: 'line',
			x1: x0,
			y1: 0,
			x2: x0,
			y2: HALF_ROW,
			color: laneColor(lane),
		});
	}

	for (const k of joiningLanes) {
		instructions.push({ type: 'path', d: elbowUp(x0, lx(k)), color: laneColor(k) });
	}

	for (const pLane of parentLanes) {
		if (pLane === lane) {
			instructions.push({
				type: 'line',
				x1: x0,
				y1: HALF_ROW,
				x2: x0,
				y2: ROW_HEIGHT,
				color: laneColor(lane),
			});
		} else {
			instructions.push({ type: 'path', d: elbowDown(x0, lx(pLane)), color: laneColor(pLane) });
		}
	}

	instructions.push({ type: 'dot', cx: x0, cy: HALF_ROW, color: laneColor(lane) });

	return instructions;
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

/** Format ISO date as relative time string (e.g. "3 days ago"). */
export function relativeDate(iso: string | null): string {
	if (!iso) return '';
	const diff = Date.now() - new Date(iso).getTime();
	const minutes = Math.floor(diff / 60_000);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days}d ago`;
	const months = Math.floor(days / 30);
	if (months < 12) return `${months}mo ago`;
	return `${Math.floor(months / 12)}y ago`;
}
