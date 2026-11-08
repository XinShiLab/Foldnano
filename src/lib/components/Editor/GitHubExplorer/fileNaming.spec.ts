import { describe, expect, it } from 'vitest';
import { fileStem, isRenamableFile } from './fileNaming';
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
