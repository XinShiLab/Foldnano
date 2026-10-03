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
export type DrawInstruction = DrawLine | DrawDot;

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
	entering: (string | null)[];
	exiting: (string | null)[];
	/** Total lane count for this row (determines SVG width). */
	maxLanes: number;
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

		// Find or assign a lane for this commit
		let lane = activeLanes.indexOf(rawCommit.sha);
		if (lane === -1) {
			lane = firstFreeSlot();
			setSlot(lane, rawCommit.sha);
		}

		// Assign lanes to parents
		const parentLanes: number[] = [];
		const parents = rawCommit.parents ?? [];

		for (let i = 0; i < parents.length; i++) {
			const parentSha = parents[i].sha;

			// Check if this parent is already tracked in a different lane
			let existingLane = -1;
			for (let k = 0; k < activeLanes.length; k++) {
				if (k !== lane && activeLanes[k] === parentSha) {
					existingLane = k;
					break;
				}
			}

			if (existingLane !== -1) {
				// Parent already tracked — commit's lane merges into it
				if (i === 0) activeLanes[lane] = null; // free commit's lane
				parentLanes.push(existingLane);
			} else if (i === 0) {
				// First parent, not yet tracked — continue in same lane
				activeLanes[lane] = parentSha;
				parentLanes.push(lane);
			} else {
				// Non-first parent, not yet tracked — open a new lane
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
			entering,
			exiting,
			maxLanes,
		});
	}

	return rows;
}

// ─── Drawing instructions ────────────────────────────────────────────────────

/**
 * Compute SVG draw instructions for a single commit row.
 */
export function rowInstructions(node: CommitNode): DrawInstruction[] {
	const Y_TOP = 0;
	const Y_MID = HALF_ROW;
	const Y_BOT = ROW_HEIGHT;
	const { lane, entering, exiting, parentLanes } = node;

	const instructions: DrawInstruction[] = [];

	const maxK = Math.max(entering.length, exiting.length, lane + 1, node.maxLanes);

	// Pass-through lanes (not this commit's lane)
	for (let k = 0; k < maxK; k++) {
		if (k === lane) continue;
		const hasIn = k < entering.length && entering[k] !== null;
		const hasOut = k < exiting.length && exiting[k] !== null;
		if (hasIn && hasOut) {
			instructions.push({
				type: 'line',
				x1: lx(k),
				y1: Y_TOP,
				x2: lx(k),
				y2: Y_BOT,
				color: laneColor(k),
			});
		}
	}

	// Entering line: top → dot (only if lane was active entering this row)
	const hadEntering = lane < entering.length && entering[lane] !== null;
	if (hadEntering) {
		instructions.push({
			type: 'line',
			x1: lx(lane),
			y1: Y_TOP,
			x2: lx(lane),
			y2: Y_MID,
			color: laneColor(lane),
		});
	}

	// Dot
	instructions.push({ type: 'dot', cx: lx(lane), cy: Y_MID, color: laneColor(lane) });

	// Parent connections: dot → bottom of each parent lane
	for (const pLane of parentLanes) {
		instructions.push({
			type: 'line',
			x1: lx(lane),
			y1: Y_MID,
			x2: lx(pLane),
			y2: Y_BOT,
			color: laneColor(pLane),
		});
	}

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
