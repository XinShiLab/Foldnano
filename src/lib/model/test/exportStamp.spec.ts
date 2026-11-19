import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import { migrateDocumentJson, stringifyDesignFile } from '$lib/model/documentFormat';
import {
	canonicalJson,
	editedSinceExport,
	partsHash,
	readExportStamp,
	withExportStamp,
} from '$lib/model/exportStamp';

const NOW = { at: Date.parse('2026-11-18T13:02:11Z'), clock: 'server' as const };

function designWithPart(id = 'd1', name = 'Tile'): FoldnanoDocument {
	const doc = new FoldnanoDocument(id, name);
	doc.addNewPart('HONEYCOMB');
	return doc;
}

describe('canonicalJson and partsHash', () => {
	it('ignores key order, whitespace and number spelling', async () => {
		const a = JSON.parse('[{"b": 1.0, "a": {"y": [1, 2], "x": "s"}}]');
		const b = JSON.parse('[{"a":{"x":"s","y":[1,2]},"b":1}]');

		expect(canonicalJson(a)).toBe(canonicalJson(b));
		expect(await partsHash(a)).toBe(await partsHash(b));
		expect(await partsHash(a)).toMatch(/^sha256:[0-9a-f]{64}$/);
	});

	it('changes when the content changes', async () => {
		expect(await partsHash([{ a: 1 }])).not.toBe(await partsHash([{ a: 2 }]));
	});
});

describe('the export stamp', () => {
	it('stamps the download time and a hash that ignores the name and id', async () => {
		const doc = designWithPart();
		const stamped = await withExportStamp(doc.snapshot(), NOW);
		const copy = await withExportStamp({ ...doc.snapshot(), id: 'other', name: 'Renamed' }, NOW);

		expect(readExportStamp(stamped)).toEqual({
			at: '2026-11-18T13:02:11.000Z',
			clock: 'server',
			contentHash: readExportStamp(copy)?.contentHash,
		});
	});

	it('tells an untouched download from one edited outside Foldnano', async () => {
		const file = JSON.parse(
			stringifyDesignFile(await withExportStamp(designWithPart().snapshot(), NOW), 2)
		) as { parts: { name: string }[] };

		expect(await editedSinceExport(file)).toBe(false);
		file.parts[0].name = 'edited by hand';
		expect(await editedSinceExport(file)).toBe(true);
		expect(await editedSinceExport(designWithPart().snapshot())).toBeNull();
	});

	it('ignores a malformed stamp', () => {
		const stamp = { at: '2026-11-18T13:02:11Z', clock: 'server', contentHash: 'sha256:0' };

		expect(readExportStamp({ exported: stamp })).not.toBeNull();
		expect(readExportStamp({ exported: { ...stamp, at: 'yesterday' } })).toBeNull();
		expect(readExportStamp({ exported: { ...stamp, clock: 'sundial' } })).toBeNull();
		expect(readExportStamp({ exported: { ...stamp, contentHash: 'md5:0' } })).toBeNull();
	});

	it('never reaches the model or a stored copy', async () => {
		const stamped = await withExportStamp(designWithPart().snapshot(), NOW);

		expect(migrateDocumentJson(stamped)).not.toHaveProperty('exported');
		expect(FoldnanoDocument.fromJSON(stamped).toJSON()).not.toHaveProperty('exported');
	});

	it('stamps the v2 fixture so it still validates and loads', async () => {
		const raw = JSON.parse(
			fs.readFileSync(path.resolve('test_files/fixtures/document_format/v2.fn.json'), 'utf-8')
		) as object;
		const stamped = await withExportStamp(raw, { at: NOW.at, clock: 'local' });

		expect(readExportStamp(stamped)?.clock).toBe('local');
		expect(FoldnanoDocument.fromJSON(stamped).parts.length).toBeGreaterThan(0);
	});
});
