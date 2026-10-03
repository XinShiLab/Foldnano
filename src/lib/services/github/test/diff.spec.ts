import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { computeDiff as computeDiffOrNull, generateConflictMarkers, type DiffHunk } from '../diff';

/** computeDiff for inputs well under the change cap. */
function computeDiff(local: string, remote: string): DiffHunk[] {
	const hunks = computeDiffOrNull(local, remote);
	if (hunks === null) throw new Error('unexpected: too many changes');
	return hunks;
}

/** Rebuilds both sides from the hunks: left from equal + removed, right from equal + added. */
function sides(hunks: DiffHunk[]): { left: string[]; right: string[] } {
	const left: string[] = [];
	const right: string[] = [];
	for (const h of hunks) {
		if (h.type !== 'added') left.push(...h.lines);
		if (h.type !== 'removed') right.push(...h.lines);
	}
	return { left, right };
}

/** Deterministic PRNG so failures reproduce. */
function rng(seed: number): () => number {
	return () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
}

describe('computeDiff', () => {
	it('identical strings → all equal hunks', () => {
		const text = 'line1\nline2\nline3';
		const hunks = computeDiff(text, text);
		expect(hunks.every((h) => h.type === 'equal')).toBe(true);
		expect(hunks.flatMap((h) => h.lines)).toEqual(['line1', 'line2', 'line3']);
	});

	it('empty strings → no hunks', () => {
		expect(computeDiff('', '')).toEqual([]);
	});

	it('added lines only → correct added hunks, no removed', () => {
		const local = 'line1\nline3';
		const remote = 'line1\nline2\nline3';
		const hunks = computeDiff(local, remote);
		expect(hunks.some((h) => h.type === 'removed')).toBe(false);
		const addedLines = hunks.filter((h) => h.type === 'added').flatMap((h) => h.lines);
		expect(addedLines).toContain('line2');
	});

	it('removed lines only → correct removed hunks, no added', () => {
		const local = 'line1\nline2\nline3';
		const remote = 'line1\nline3';
		const hunks = computeDiff(local, remote);
		expect(hunks.some((h) => h.type === 'added')).toBe(false);
		const removedLines = hunks.filter((h) => h.type === 'removed').flatMap((h) => h.lines);
		expect(removedLines).toContain('line2');
	});

	it('mixed changes → correct interleaved hunk sequence', () => {
		const local = 'a\nb\nc\nd';
		const remote = 'a\nB\nc\nD';
		const hunks = computeDiff(local, remote);
		const types = hunks.map((h) => h.type);
		// Should have equal(a), removed(b)/added(B), equal(c), removed(d)/added(D)
		expect(types).toContain('equal');
		expect(types).toContain('added');
		expect(types).toContain('removed');
	});

	it('all equal lines come out in order', () => {
		const text = ['alpha', 'beta', 'gamma'].join('\n');
		const hunks = computeDiff(text, text);
		const lines = hunks.flatMap((h) => h.lines);
		expect(lines).toEqual(['alpha', 'beta', 'gamma']);
	});

	it('single-line change', () => {
		const hunks = computeDiff('hello', 'world');
		const removed = hunks.filter((h) => h.type === 'removed').flatMap((h) => h.lines);
		const added = hunks.filter((h) => h.type === 'added').flatMap((h) => h.lines);
		expect(removed).toEqual(['hello']);
		expect(added).toEqual(['world']);
	});

	it('left line numbers start at 1 for equal hunks', () => {
		const text = 'a\nb\nc';
		const [first] = computeDiff(text, text);
		expect(first.leftStart).toBe(1);
		expect(first.rightStart).toBe(1);
	});

	it('removed hunk has null rightStart', () => {
		const hunks = computeDiff('a\nb', 'a');
		const removed = hunks.find((h) => h.type === 'removed');
		expect(removed).toBeDefined();
		expect(removed!.rightStart).toBeNull();
	});

	it('added hunk has null leftStart', () => {
		const hunks = computeDiff('a', 'a\nb');
		const added = hunks.find((h) => h.type === 'added');
		expect(added).toBeDefined();
		expect(added!.leftStart).toBeNull();
	});

	it('real-world fixture: cadnano-like JSON diff detects changed field', () => {
		const base = JSON.stringify({ id: 'abc', name: 'Design A', parts: [] }, null, 2);
		const modified = JSON.stringify({ id: 'abc', name: 'Design B', parts: [] }, null, 2);
		const hunks = computeDiff(base, modified);
		const removedLines = hunks.filter((h) => h.type === 'removed').flatMap((h) => h.lines);
		const addedLines = hunks.filter((h) => h.type === 'added').flatMap((h) => h.lines);
		expect(removedLines.some((l) => l.includes('Design A'))).toBe(true);
		expect(addedLines.some((l) => l.includes('Design B'))).toBe(true);
	});

	it('round-trips random edits: hunks rebuild both inputs with correct line numbers', () => {
		const rand = rng(42);
		for (let trial = 0; trial < 200; trial++) {
			const a = Array.from({ length: Math.floor(rand() * 40) }, () => `l${Math.floor(rand() * 8)}`);
			const b = a.flatMap((line) => {
				const r = rand();
				if (r < 0.15) return [];
				if (r < 0.3) return [line, `new${Math.floor(rand() * 8)}`];
				if (r < 0.4) return [`chg${Math.floor(rand() * 8)}`];
				return [line];
			});
			const hunks = computeDiff(a.join('\n'), b.join('\n'));
			expect(sides(hunks)).toEqual({ left: a, right: b });
			let left = 1;
			let right = 1;
			for (const h of hunks) {
				if (h.type !== 'added') expect(h.leftStart).toBe(left);
				if (h.type !== 'removed') expect(h.rightStart).toBe(right);
				if (h.type !== 'added') left += h.lines.length;
				if (h.type !== 'removed') right += h.lines.length;
			}
		}
	});

	it('returns a single equal hunk for identical inputs', () => {
		expect(computeDiff('a\nb\nc', 'a\nb\nc').map((h) => h.type)).toEqual(['equal']);
	});

	it('returns null when more lines differ than the cap', () => {
		const a = Array.from({ length: 50 }, (_, i) => `a${i}`).join('\n');
		const b = Array.from({ length: 50 }, (_, i) => `b${i}`).join('\n');
		expect(computeDiffOrNull(a, b, { maxChanges: 99 })).toBeNull();
		expect(computeDiffOrNull(a, b, { maxChanges: 100 })).not.toBeNull();
	});

	// Regression: the Myers trace used O(changes × lines) memory and crashed the Backups dialog
	// on large designs (2,000 scattered edits on this 81k-line design ran out of memory).
	describe('large design (test_tetrahedral2.fn.json, pretty-printed as the Backups dialog does)', () => {
		const design = JSON.stringify(
			JSON.parse(
				fs.readFileSync(
					path.resolve('test_files/internal_cadnano_designs/test_tetrahedral2.fn.json'),
					'utf-8'
				)
			),
			null,
			2
		);
		const lines = design.split('\n');

		it('diffs 2,000 scattered edits and round-trips', () => {
			const edited = [...lines];
			const step = Math.floor(lines.length / 2000);
			for (let i = 0; i < 2000; i++) edited[i * step] += ' ';
			const hunks = computeDiff(design, edited.join('\n'));
			expect(sides(hunks)).toEqual({ left: lines, right: edited });
			expect(hunks.filter((h) => h.type === 'removed').flatMap((h) => h.lines)).toHaveLength(2000);
		});

		it('gives up quickly on completely different versions', () => {
			const different = lines.map((line, i) => `${line}${i}`).join('\n');
			const start = performance.now();
			expect(computeDiffOrNull(design, different)).toBeNull();
			expect(performance.now() - start).toBeLessThan(5000);
		});
	});
});

describe('generateConflictMarkers', () => {
	it('wraps local and remote in standard Git markers', () => {
		const result = generateConflictMarkers('local content', 'remote content');
		expect(result).toContain('<<<<<<< Local');
		expect(result).toContain('=======');
		expect(result).toContain('>>>>>>> Remote');
		expect(result).toContain('local content');
		expect(result).toContain('remote content');
	});
});
