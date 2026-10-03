import { describe, expect, it } from 'vitest';
import { fileStem, isRenamableFile, validateFileStem } from './fileNaming';
import type { FileNode } from './types';

function file(name: string, type: FileNode['type'] = 'file'): FileNode {
	return { name, path: `designs/${name}`, type, sha: '' };
}

describe('isRenamableFile', () => {
	it('allows native .fn.json files', () => {
		expect(isRenamableFile(file('origami.fn.json'))).toBe(true);
	});

	it('rejects other JSON flavours and folders', () => {
		expect(isRenamableFile(file('legacy.json'))).toBe(false);
		expect(isRenamableFile(file('legacy.cadnano.json'))).toBe(false);
		expect(isRenamableFile(file('old.cweb.json'))).toBe(false);
		expect(isRenamableFile(file('folder.fn.json', 'folder'))).toBe(false);
	});
});

describe('fileStem', () => {
	it('strips only the .fn.json extension', () => {
		expect(fileStem('origami.fn.json')).toBe('origami');
		expect(fileStem('v1.2.fn.json')).toBe('v1.2');
		expect(fileStem('plain')).toBe('plain');
	});
});

describe('validateFileStem', () => {
	it('accepts letters, digits, hyphens, underscores, dots and spaces', () => {
		expect(validateFileStem('My design_v2-final')).toBeNull();
	});

	it('rejects empty names', () => {
		expect(validateFileStem('')).toBe('File name is required.');
	});

	it('rejects path separators and other characters', () => {
		expect(validateFileStem('a/b')).not.toBeNull();
		expect(validateFileStem('a\\b')).not.toBeNull();
		expect(validateFileStem('a:b')).not.toBeNull();
	});
});
