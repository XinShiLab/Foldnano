import { describe, expect, it } from 'vitest';
import { computeLayout, pickGraphBranches, rowInstructions, type CommitNode } from './gitGraph';
import type { GitHubBranch, GitHubCommit } from './types';

function commit(sha: string, ...parents: string[]): GitHubCommit {
	return {
		sha,
		commit: { message: sha, author: null, committer: null },
		html_url: '',
		author: null,
		parents: parents.map((p) => ({ sha: p, url: '' })),
	};
}

function branch(name: string, sha: string): GitHubBranch {
	return { name, commit: { sha, url: '' }, protected: false };
}

function layout(commits: GitHubCommit[], branches: GitHubBranch[] = []): Map<string, CommitNode> {
	return new Map(computeLayout(commits, branches, 'main').map((n) => [n.sha, n]));
}

function kinds(node: CommitNode): string[] {
	return rowInstructions(node).map((i) => i.type);
}

describe('computeLayout', () => {
	it('keeps a linear history in lane 0 with straight lines only', () => {
		const rows = layout([commit('c', 'b'), commit('b', 'a'), commit('a')]);
		for (const node of rows.values()) {
			expect(node.lane).toBe(0);
			expect(node.joiningLanes).toEqual([]);
			expect(kinds(node)).not.toContain('path');
		}
	});

	it('keeps a branch lane open down to its fork point and joins it there', () => {
		// main: m2 → base; feature: f2 → f1 → base
		const rows = layout(
			[commit('m2', 'base'), commit('f2', 'f1'), commit('f1', 'base'), commit('base')],
			[branch('main', 'm2'), branch('feature', 'f2')]
		);
		expect(rows.get('m2')!.lane).toBe(0);
		expect(rows.get('f2')!.lane).toBe(1);
		// f1's parent is already tracked by lane 0, but the feature lane carries on straight down
		expect(rows.get('f1')!.parentLanes).toEqual([1]);
		expect(kinds(rows.get('f1')!)).not.toContain('path');

		const base = rows.get('base')!;
		expect(base.lane).toBe(0);
		expect(base.joiningLanes).toEqual([1]);
		expect(kinds(base)).toContain('path');
	});

	it('draws a merge second parent as an elbow into a new lane', () => {
		// merge(m1, f1); f1 → base; m1 → base
		const rows = layout([
			commit('merge', 'm1', 'f1'),
			commit('m1', 'base'),
			commit('f1', 'base'),
			commit('base'),
		]);
		const merge = rows.get('merge')!;
		expect(merge.parentLanes).toEqual([0, 1]);
		expect(kinds(merge).filter((k) => k === 'path')).toHaveLength(1);
		expect(rows.get('base')!.joiningLanes).toEqual([1]);
	});

	it('joins several branches that fork from the same commit', () => {
		const rows = layout([
			commit('a', 'base'),
			commit('b', 'base'),
			commit('c', 'base'),
			commit('base'),
		]);
		expect([rows.get('a')!.lane, rows.get('b')!.lane, rows.get('c')!.lane]).toEqual([0, 1, 2]);
		const base = rows.get('base')!;
		expect(base.lane).toBe(0);
		expect(base.joiningLanes).toEqual([1, 2]);
		expect(base.exiting).toEqual([]);
	});

	it('reuses a lane freed by a join for a merge parent in the same row', () => {
		// x is both a fork point (joined by lane 1) and a merge commit with a new second parent
		const rows = layout([
			commit('a', 'x'),
			commit('b', 'x'),
			commit('x', 'p', 'q'),
			commit('p'),
			commit('q'),
		]);
		const x = rows.get('x')!;
		expect(x.joiningLanes).toEqual([1]);
		expect(x.parentLanes).toEqual([0, 1]);
		// lane 1 changes sha in this row, so it must not be drawn as a pass-through
		const verticalsInLane1 = rowInstructions(x).filter(
			(i) => i.type === 'line' && i.x1 === i.x2 && i.y1 === 0 && i.y2 === 28 && i.x1 !== 8
		);
		expect(verticalsInLane1).toHaveLength(0);
	});
});

describe('rowInstructions', () => {
	it('draws the dot last so lines never cover it', () => {
		const rows = layout([commit('merge', 'm1', 'f1'), commit('m1'), commit('f1')]);
		const instrs = rowInstructions(rows.get('merge')!);
		expect(instrs.at(-1)!.type).toBe('dot');
	});

	it('uses a rounded corner rather than a diagonal for lane changes', () => {
		const rows = layout([commit('merge', 'm1', 'f1'), commit('m1'), commit('f1')]);
		const path = rowInstructions(rows.get('merge')!).find((i) => i.type === 'path');
		expect(path).toBeDefined();
		if (path?.type !== 'path') return;
		// dot (8, 14) → horizontal → arc → vertical down lane 1 (x = 24)
		expect(path.d).toBe('M 8 14 H 16 A 8 8 0 0 1 24 22 V 28');
		const diagonals = rowInstructions(rows.get('merge')!).filter(
			(i) => i.type === 'line' && i.x1 !== i.x2
		);
		expect(diagonals).toHaveLength(0);
	});
});

describe('pickGraphBranches', () => {
	const names = (bs: GitHubBranch[]) => bs.map((b) => b.name);
	const all = ['a', 'b', 'c', 'develop', 'main', 'z'].map((n) => branch(n, n));

	it('puts the current and default branches first, then GitHub order, up to the limit', () => {
		expect(names(pickGraphBranches(all, 'z', 'main', 4))).toEqual(['z', 'main', 'a', 'b']);
	});

	it('does not repeat a branch that is both current and default', () => {
		expect(names(pickGraphBranches(all, 'main', 'main', 3))).toEqual(['main', 'a', 'b']);
	});

	it('works without a known default branch', () => {
		expect(names(pickGraphBranches(all, 'develop', null, 2))).toEqual(['develop', 'a']);
	});
});
