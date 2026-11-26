import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import { migrateDocumentJson, stringifyDesignFile } from '$lib/model/documentFormat';
import {
	canonicalJson,
	editedSinceExport,
	designContentHash,
	readExportStamp,
	withExportStamp,
} from '$lib/model/exportStamp';

const NOW = { at: Date.parse('2026-11-18T13:02:11Z'), clock: 'server' as const };
const NOW_STAMP = { at: '2026-11-18T13:02:11.000Z', clock: 'server' };

/** How stamps were hashed before v3 added the assembly. */
async function partsOnlyHash(parts: unknown): Promise<string> {
	const bytes = new TextEncoder().encode(canonicalJson(parts));
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
	return 'sha256:' + Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

function designWithPart(id = 'd1', name = 'Tile'): FoldnanoDocument {
	const doc = new FoldnanoDocument(id, name);
	doc.addNewPart('HONEYCOMB');
	return doc;
}

describe('canonicalJson and designContentHash', () => {
	it('ignores key order, whitespace and number spelling', async () => {
		const a = JSON.parse('[{"b": 1.0, "a": {"y": [1, 2], "x": "s"}}]');
		const b = JSON.parse('[{"a":{"x":"s","y":[1,2]},"b":1}]');

		expect(canonicalJson(a)).toBe(canonicalJson(b));
		expect(await designContentHash({ parts: a })).toBe(await designContentHash({ parts: b }));
		expect(await designContentHash({ parts: a })).toMatch(/^sha256:[0-9a-f]{64}$/);
	});

	it('changes when the content changes', async () => {
		expect(await designContentHash({ parts: [{ a: 1 }] })).not.toBe(
			await designContentHash({ parts: [{ a: 2 }] })
		);
	});

	it('covers the assembly when there is one', async () => {
		const parts = [{ a: 1 }];
		const placed = await designContentHash({ parts, assembly: { occurrences: [{ x: 1 }] } });

		expect(placed).not.toBe(
			await designContentHash({ parts, assembly: { occurrences: [{ x: 2 }] } })
		);
		expect(placed).not.toBe(await designContentHash({ parts }));
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

	it('notices an instance moved outside Foldnano', async () => {
		const file = JSON.parse(
			stringifyDesignFile(await withExportStamp(designWithPart().snapshot(), NOW), 2)
		) as { assembly: { occurrences: { transform: { position: { x: number } } }[] } };

		expect(await editedSinceExport(file)).toBe(false);
		file.assembly.occurrences[0].transform.position.x += 10;
		expect(await editedSinceExport(file)).toBe(true);
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

	it('still checks a v2 stamp, which hashed the parts alone', async () => {
		const raw = JSON.parse(
			fs.readFileSync(path.resolve('test_files/fixtures/document_format/v2.fn.json'), 'utf-8')
		) as { parts: unknown[] };
		const file = {
			...raw,
			exported: { ...NOW_STAMP, contentHash: await partsOnlyHash(raw.parts) },
		};

		expect(await editedSinceExport(file)).toBe(false);
	});
});
