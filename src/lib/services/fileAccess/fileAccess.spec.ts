import { describe, expect, it } from 'vitest';
import {
	ensureAccess,
	FolderTooLargeError,
	isEffectivelyEmpty,
	isMissingHandleError,
	readFileBytes,
	walkDirectory,
	writeFile,
} from './fileAccess';
import { memoryDirectory } from './memoryFileSystem';

describe('walkDirectory', () => {
	it('lists nested files with sorted POSIX paths and sizes', async () => {
		const dir = memoryDirectory('p', { 'b.py': 'bb', lib: { 'a.py': 'a' }, 'a.txt': 'abc' });
		const files = await walkDirectory(dir);
		expect(files.map((f) => [f.path, f.size])).toEqual([
			['a.txt', 3],
			['b.py', 2],
			['lib/a.py', 1],
		]);
	});

	it('skips ignored folders without descending into them', async () => {
		const dir = memoryDirectory('p', { 'plugin.py': 'x', '.git': { HEAD: 'ref' } });
		const seen: string[] = [];
		const files = await walkDirectory(dir, {
			ignore: (path) => {
				seen.push(path);
				return path === '.git';
			},
		});
		expect(files.map((f) => f.path)).toEqual(['plugin.py']);
		expect(seen).not.toContain('.git/HEAD');
	});

	it('stops at the file and byte limits', async () => {
		const dir = memoryDirectory('p', { a: 'x', b: 'y', c: 'z' });
		await expect(walkDirectory(dir, { maxFiles: 2 })).rejects.toBeInstanceOf(FolderTooLargeError);
		await expect(walkDirectory(dir, { maxBytes: 2 })).rejects.toBeInstanceOf(FolderTooLargeError);
	});

	it('reports a moved folder as a missing handle', async () => {
		const dir = memoryDirectory('p', { a: 'x' });
		dir.missing = true;
		const error = await walkDirectory(dir).catch((e: unknown) => e);
		expect(isMissingHandleError(error)).toBe(true);
	});
});

describe('writeFile', () => {
	it('creates nested folders and round-trips the bytes', async () => {
		const dir = memoryDirectory('p');
		await writeFile(dir, 'stubs/foldnano/__init__.pyi', 'x = 1\n');
		const [file] = await walkDirectory(dir);
		expect(file.path).toBe('stubs/foldnano/__init__.pyi');
		expect(new TextDecoder().decode(await readFileBytes(file.handle))).toBe('x = 1\n');
	});
});

describe('isEffectivelyEmpty', () => {
	it('ignores OS and git noise', async () => {
		expect(await isEffectivelyEmpty(memoryDirectory('p', { '.DS_Store': '', '.git': {} }))).toBe(
			true
		);
		expect(await isEffectivelyEmpty(memoryDirectory('p', { 'README.md': '' }))).toBe(false);
	});
});

describe('ensureAccess', () => {
	it('prompts only when not already granted', async () => {
		const granted = memoryDirectory('p', {}, { read: 'granted', onRequest: 'denied' });
		expect(await ensureAccess(granted)).toBe(true);
		const prompt = memoryDirectory('p', {}, { read: 'prompt', onRequest: 'granted' });
		expect(await ensureAccess(prompt)).toBe(true);
		const refused = memoryDirectory('p', {}, { read: 'prompt', onRequest: 'denied' });
		expect(await ensureAccess(refused)).toBe(false);
	});
});
