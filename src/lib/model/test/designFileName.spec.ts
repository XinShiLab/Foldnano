import { describe, expect, it } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import {
	designNameFromPath,
	exportBaseName,
	findPathClash,
	fnJsonPathFor,
	isReservedDesignName,
	normalizeDesignName,
	splitDesignExtension,
	stripDesignExtension,
	uniqueDesignName,
	validateDesignName,
} from '$lib/model/io/designFileName';

describe('splitDesignExtension', () => {
	it('strips only known design extensions, keeping dots in the name', () => {
		expect(splitDesignExtension('origami.v2.fn.json')).toEqual({
			stem: 'origami.v2',
			ext: '.fn.json',
		});
		expect(stripDesignExtension('Hilbert.cadnano.json')).toBe('Hilbert');
		expect(stripDesignExtension('legacy.cweb.json')).toBe('legacy');
		expect(stripDesignExtension('8hb_2ab_8f.json')).toBe('8hb_2ab_8f');
		expect(stripDesignExtension('Design.FN.JSON')).toBe('Design');
	});

	it('falls back to the last dot of the file name for other files', () => {
		expect(splitDesignExtension('notes.v1.txt')).toEqual({ stem: 'notes.v1', ext: '.txt' });
		expect(splitDesignExtension('folder.v1/README')).toEqual({ stem: 'folder.v1/README', ext: '' });
		expect(splitDesignExtension('.json')).toEqual({ stem: '.json', ext: '' });
	});
});

describe('designNameFromPath / fnJsonPathFor', () => {
	it('derives the document name from the file name only', () => {
		expect(designNameFromPath('designs/v1.2/origami.v2.fn.json')).toBe('origami.v2');
	});

	it('maps an imported design file to a sibling .fn.json', () => {
		expect(fnJsonPathFor('designs/pore.json')).toBe('designs/pore.fn.json');
		expect(fnJsonPathFor('designs/Hilbert.cadnano.json')).toBe('designs/Hilbert.fn.json');
		expect(fnJsonPathFor('a.v1/b.cweb.json')).toBe('a.v1/b.fn.json');
	});
});

describe('validateDesignName', () => {
	it('accepts letters (any script), digits, spaces, hyphens, underscores, dots and parentheses', () => {
		expect(validateDesignName('My design_v2-final')).toBeNull();
		expect(validateDesignName('origami.v2 (2)')).toBeNull();
		expect(validateDesignName('Fässchen')).toBeNull();
	});

	it('rejects empty names, path separators and other characters', () => {
		expect(validateDesignName('')).toBe('Name is required.');
		for (const bad of ['a/b', 'a\\b', 'a:b', 'a?b', 'a*b', 'a"b', 'a<b>', 'a|b']) {
			expect(validateDesignName(bad)).not.toBeNull();
		}
	});

	it('rejects dot-only names and leading or trailing spaces and dots', () => {
		for (const bad of ['.', '..', '.hidden', 'name.', 'name ', ' name']) {
			expect(validateDesignName(bad)).not.toBeNull();
		}
	});

	it('rejects Windows device names, the reserved blank name, and over-long names', () => {
		expect(validateDesignName('CON')).not.toBeNull();
		expect(validateDesignName('com1.v2')).not.toBeNull();
		expect(validateDesignName('console')).toBeNull();
		expect(validateDesignName('untitled document')).not.toBeNull();
		expect(validateDesignName('a'.repeat(100))).toBeNull();
		expect(validateDesignName('a'.repeat(101))).not.toBeNull();
	});
});

describe('normalizeDesignName', () => {
	it('trims and drops one full design extension, ignoring case', () => {
		expect(normalizeDesignName('  box.fn.json ')).toBe('box');
		expect(normalizeDesignName('box.FN.JSON')).toBe('box');
		expect(normalizeDesignName('box.json')).toBe('box');
		expect(normalizeDesignName('box.cadnano.json')).toBe('box');
		expect(normalizeDesignName('origami.v2')).toBe('origami.v2');
		expect(validateDesignName(normalizeDesignName('.fn.json'))).not.toBeNull();
	});
});

describe('validateDesignName extension endings', () => {
	it('refuses a partial design extension but keeps ordinary dots', () => {
		for (const bad of ['box.fn', 'box.FN', 'box.cadnano', 'box.cweb']) {
			expect(validateDesignName(bad)).toBe(
				'Leave out the file extension; .fn.json is added for you.'
			);
		}
		expect(validateDesignName('origami.v2')).toBeNull();
		expect(validateDesignName('box.fnx')).toBeNull();
	});
});

describe('isReservedDesignName', () => {
	it('matches the blank-workspace name ignoring case and surrounding spaces', () => {
		expect(isReservedDesignName('Untitled Document')).toBe(true);
		expect(isReservedDesignName(' UNTITLED document ')).toBe(true);
		expect(isReservedDesignName('Untitled Document 2')).toBe(false);
	});
});

describe('uniqueDesignName', () => {
	it('keeps a free name and numbers a taken one, ignoring case', () => {
		expect(uniqueDesignName('Box', ['Other'])).toBe('Box');
		expect(uniqueDesignName('Box', ['box'])).toBe('Box (2)');
		expect(uniqueDesignName('Box', ['Box', 'BOX (2)', 'Box (4)'])).toBe('Box (3)');
	});
});

describe('findPathClash', () => {
	it('finds a path that differs only by case, but not the file being renamed', () => {
		const paths = ['designs/Box.fn.json', 'designs/tile.fn.json'];
		expect(findPathClash(paths, 'designs/box.fn.json')).toBe('designs/Box.fn.json');
		expect(findPathClash(paths, 'designs/box.fn.json', 'designs/Box.fn.json')).toBeNull();
		expect(findPathClash(paths, 'other/box.fn.json')).toBeNull();
	});
});

describe('exportBaseName', () => {
	it('uses the document name, made safe for file systems', () => {
		expect(exportBaseName('My design', '_route.svg')).toBe('My design_route.svg');
		expect(exportBaseName('a/b:c')).toBe('a-b-c');
		expect(exportBaseName('  ', '.cadnano.json')).toBe('design.cadnano.json');
		expect(exportBaseName('doc', '.Region 1/A.cadnano.json')).toBe('doc.Region 1-A.cadnano.json');
	});
});

describe('FoldnanoDocument.addNewPart', () => {
	it('names parts by position instead of a random string', () => {
		const doc = new FoldnanoDocument();
		expect(doc.addNewPart('HONEYCOMB').name).toBe('Part 1');
		expect(doc.addNewPart('SQUARE').name).toBe('Part 2');
	});
});
