import { describe, expect, it } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import {
	designNameFromPath,
	exportBaseName,
	fnJsonPathFor,
	splitDesignExtension,
	stripDesignExtension,
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
