// @vitest-environment node

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `vi.spyOn` can't redefine an ESM named export, so `renameSync` is routed through a controllable
// hook instead: real behaviour by default, a thrown error only for the one destination a test names.
const { failRenameOnce } = vi.hoisted(() => ({ failRenameOnce: { path: null as string | null } }));
vi.mock('fs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('fs')>();
	return {
		...actual,
		renameSync: (from: fs.PathLike, to: fs.PathLike) => {
			if (failRenameOnce.path && to === failRenameOnce.path) {
				failRenameOnce.path = null;
				throw new Error('simulated rename failure');
			}
			return actual.renameSync(from, to);
		},
	};
});

import { byCodeUnit, designSetProblems, writeReportFilesAtomically } from './report-output';

describe('byCodeUnit', () => {
	it('orders by UTF-16 code unit regardless of locale', () => {
		expect(['b', 'a', 'c'].sort(byCodeUnit)).toEqual(['a', 'b', 'c']);
	});
});

describe('designSetProblems', () => {
	it('reports nothing when the names exactly match the expected set', () => {
		expect(designSetProblems(['a', 'b', 'c'], ['a', 'b', 'c'])).toEqual([]);
	});

	it('reports a wrong count and the missing design', () => {
		expect(designSetProblems(['a', 'b'], ['a', 'b', 'c'])).toEqual([
			'2 result(s) covering 2 distinct design(s), expected 3 of each',
			'missing design(s): c',
		]);
	});

	it('reports a duplicate hiding a missing design, even at the right count', () => {
		expect(designSetProblems(['a', 'a', 'b'], ['a', 'b', 'c'])).toEqual([
			'3 result(s) covering 2 distinct design(s), expected 3 of each',
			'missing design(s): c',
		]);
	});

	it('reports names that are not in the expected set, even at the right count', () => {
		expect(designSetProblems(['a', 'b', 'zzz'], ['a', 'b', 'c'])).toEqual([
			'missing design(s): c',
			'design(s) not in the corpus: zzz',
		]);
	});

	it('reports both a wrong name and a wrong count together', () => {
		expect(designSetProblems(['a', 'zzz'], ['a', 'b', 'c'])).toEqual([
			'2 result(s) covering 2 distinct design(s), expected 3 of each',
			'missing design(s): b, c',
			'design(s) not in the corpus: zzz',
		]);
	});
});

describe('writeReportFilesAtomically', () => {
	let dir: string;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-output-'));
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	function leftoverFiles(): string[] {
		return fs.readdirSync(dir).sort();
	}

	it('writes every file when none previously existed', () => {
		const a = path.join(dir, 'a.txt');
		const b = path.join(dir, 'b.txt');
		writeReportFilesAtomically([
			{ path: a, contents: 'A' },
			{ path: b, contents: 'B' },
		]);
		expect(fs.readFileSync(a, 'utf-8')).toBe('A');
		expect(fs.readFileSync(b, 'utf-8')).toBe('B');
		expect(leftoverFiles()).toEqual(['a.txt', 'b.txt']);
	});

	it('replaces existing files and leaves no temp or backup files behind', () => {
		const a = path.join(dir, 'a.txt');
		fs.writeFileSync(a, 'old');
		writeReportFilesAtomically([{ path: a, contents: 'new' }]);
		expect(fs.readFileSync(a, 'utf-8')).toBe('new');
		expect(leftoverFiles()).toEqual(['a.txt']);
	});

	it('leaves no destination written when staging a later file fails', () => {
		const a = path.join(dir, 'a.txt');
		fs.writeFileSync(a, 'old');
		const b = path.join(dir, 'nested', 'b.txt'); // parent dir does not exist: writeFileSync throws

		expect(() =>
			writeReportFilesAtomically([
				{ path: a, contents: 'new' },
				{ path: b, contents: 'B' },
			])
		).toThrow();

		expect(fs.readFileSync(a, 'utf-8')).toBe('old');
		expect(leftoverFiles()).toEqual(['a.txt']);
	});

	it('restores a previously-existing file when a later rename fails, leaving no partial set', () => {
		const a = path.join(dir, 'a.txt');
		const b = path.join(dir, 'b.txt');
		fs.writeFileSync(a, 'old-a');
		fs.writeFileSync(b, 'old-b');

		// Make the second destination a directory so fs.renameSync onto it fails after `a` is
		// already renamed into place, forcing the rollback path to run.
		fs.rmSync(b, { force: true });
		fs.mkdirSync(b);

		expect(() =>
			writeReportFilesAtomically([
				{ path: a, contents: 'new-a' },
				{ path: b, contents: 'new-b' },
			])
		).toThrow();

		expect(fs.readFileSync(a, 'utf-8')).toBe('old-a');
		expect(fs.statSync(b).isDirectory()).toBe(true);
		// No leftover .tmp-/.bak- files: cleaned up on both the success and failure paths.
		expect(
			leftoverFiles().filter((name) => name.includes('.tmp-') || name.includes('.bak-'))
		).toEqual([]);
	});

	it('cleans up an orphaned backup when the rename immediately after it fails', () => {
		const a = path.join(dir, 'a.txt');
		const b = path.join(dir, 'b.txt');
		fs.writeFileSync(a, 'old-a');
		fs.writeFileSync(b, 'old-b');

		// `b`'s backup is made (its destination already exists), then its own rename is made to
		// fail — the case where a backup exists on disk but was never registered for cleanup.
		failRenameOnce.path = b;

		expect(() =>
			writeReportFilesAtomically([
				{ path: a, contents: 'new-a' },
				{ path: b, contents: 'new-b' },
			])
		).toThrow();

		expect(fs.readFileSync(a, 'utf-8')).toBe('old-a');
		expect(fs.readFileSync(b, 'utf-8')).toBe('old-b');
		expect(leftoverFiles().filter((name) => name.includes('.bak-'))).toEqual([]);
	});

	it('removes a newly-staged file that was never previously on disk when rollback runs', () => {
		const a = path.join(dir, 'a.txt');
		const b = path.join(dir, 'b.txt');
		fs.mkdirSync(b); // b has no prior file; renaming onto it fails

		expect(() =>
			writeReportFilesAtomically([
				{ path: a, contents: 'new-a' },
				{ path: b, contents: 'new-b' },
			])
		).toThrow();

		// a had no previous version, so the rollback's undo is removing it, not restoring a backup.
		expect(fs.existsSync(a)).toBe(false);
		expect(fs.statSync(b).isDirectory()).toBe(true);
	});
});
