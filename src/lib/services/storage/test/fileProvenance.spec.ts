import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import { stringifyDesignFile } from '$lib/model/documentFormat';
import { withExportStamp } from '$lib/model/exportStamp';
import { foldnanojsonParser } from '$lib/components/Editor/Toolbar/parsers/foldnanojsonParser';
import {
	compareWithBrowserCopy,
	describeFileProvenance,
	type FileProvenance,
	type ProvenanceInput,
} from '../fileProvenance';

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-11-12T10:00:00Z');

const ORIGINAL = new FoldnanoDocument('d1', 'Tile');
ORIGINAL.addNewPart('HONEYCOMB');

/** The same design (same part ids), optionally with its part renamed as a stand-in for an edit. */
function design(partName = 'Part 1'): FoldnanoDocument {
	const doc = FoldnanoDocument.fromJSON(ORIGINAL.snapshot());
	doc.parts[0].name = partName;
	return doc;
}

/** A file as downloaded and read back from disk. */
async function download(doc: FoldnanoDocument, at: number, clock: 'server' | 'local' = 'server') {
	return JSON.parse(stringifyDesignFile(await withExportStamp(doc.snapshot(), { at, clock })));
}

function openAsTheEditorWould(raw: unknown) {
	const meta = { name: 'file.fn.json', extension: 'json', size: 0, type: '' };
	return (
		foldnanojsonParser.parse(raw as Record<string, unknown>, meta) as FoldnanoDocument
	).toJSON();
}

async function compare(
	rawFile: unknown,
	stored: FoldnanoDocument,
	overrides: Partial<ProvenanceInput> = {}
): Promise<FileProvenance> {
	return compareWithBrowserCopy({
		rawFile,
		fileSnapshot: openAsTheEditorWould(rawFile),
		stored: stored.snapshot(),
		storedAt: T0,
		backups: [],
		clockOffset: 0,
		...overrides,
	});
}

describe('compareWithBrowserCopy', () => {
	it('finds an untouched download identical to the browser copy', async () => {
		const p = await compare(await download(design(), T0), design());

		expect(p).toMatchObject({ relation: 'identical', editedOutside: false, approximate: false });
	});

	it('calls a download older when the browser copy was saved after it', async () => {
		const p = await compare(await download(design('old'), T0 - DAY), design('new'));

		expect(p.relation).toBe('older');
	});

	it('calls a download newer when it was made after the last browser save', async () => {
		const p = await compare(await download(design('unsaved edit'), T0 + DAY), design());

		expect(p.relation).toBe('newer');
	});

	it('compares times on the server clock, using the offset of this computer', async () => {
		// The browser saved at T0 by a clock two days slow, so really at T0 + 2 days.
		const p = await compare(await download(design('a'), T0 + DAY), design('b'), {
			clockOffset: 2 * DAY,
		});

		expect(p.relation).toBe('older');
		expect(p.browserSavedAt).toBe(T0 + 2 * DAY);
	});

	it('marks the times approximate offline or for a file stamped by a local clock', async () => {
		const offline = await compare(await download(design('a'), T0 - DAY), design('b'), {
			clockOffset: null,
		});
		const local = await compare(await download(design('a'), T0 - DAY, 'local'), design('b'));

		expect(offline.approximate).toBe(true);
		expect(local.approximate).toBe(true);
	});

	it('reports an outside edit that loading ignores, along with the identical content', async () => {
		const fixture = JSON.parse(
			fs.readFileSync(path.resolve('test_files/fixtures/document_format/v2.fn.json'), 'utf-8')
		) as unknown;
		const doc = FoldnanoDocument.fromJSON(openAsTheEditorWould(fixture));
		const file = await download(doc, T0);
		// The loader trusts a segment's `sequence` over its `slots`, so a slot-only edit is dropped.
		file.parts[0].oligos[0].segments[0].slots[0].seq = 'C';

		const p = await compare(file, doc);

		expect(p).toMatchObject({ relation: 'identical', editedOutside: true });
		expect(describeFileProvenance(p, () => 't')).toBe(
			'The file was changed outside Foldnano after it was downloaded (t), but Foldnano ignores those changes: it opens with the same content as the browser copy.'
		);
	});

	it("doesn't trust the time of a file edited outside Foldnano", async () => {
		const file = await download(design('a'), T0 - DAY);
		file.parts[0].name = 'edited by hand';

		const p = await compare(file, design('b'));

		expect(p).toMatchObject({ relation: 'different', editedOutside: true });
	});

	it('has no time to compare for a file without a stamp', async () => {
		const p = await compare(design('a').snapshot(), design('b'));

		expect(p).toMatchObject({ relation: 'different', editedOutside: null, exportedAt: null });
	});

	it('names the newest backup with the same content', async () => {
		const backups = [
			{ createdAt: T0 - 3 * DAY, snapshot: design('a').snapshot() },
			{ createdAt: T0 - 2 * DAY, snapshot: design('a').snapshot() },
			{ createdAt: T0 - DAY, snapshot: design('c').snapshot() },
		];

		const p = await compare(await download(design('a'), T0 - 4 * DAY), design('b'), { backups });

		expect(p.matchesBackupAt).toBe(T0 - 2 * DAY);
	});

	it('finds a file from an older format version identical to the design it became', async () => {
		const raw = JSON.parse(
			fs.readFileSync(path.resolve('test_files/fixtures/document_format/v1.fn.json'), 'utf-8')
		) as unknown;
		const opened = FoldnanoDocument.fromJSON(openAsTheEditorWould(raw));

		const p = await compare(raw, opened);

		expect(p.relation).toBe('identical');
	});
});

describe('describeFileProvenance', () => {
	const base: FileProvenance = {
		relation: 'older',
		editedOutside: false,
		exportedAt: 1,
		browserSavedAt: 2,
		approximate: false,
		matchesBackupAt: null,
	};
	const formatTime = (ms: number) => `t${ms}`;

	it('says which copy is older, with both times', () => {
		expect(describeFileProvenance(base, formatTime)).toBe(
			'The file is older: it was downloaded t1, and the browser copy was saved since (t2). Replacing would undo that later work.'
		);
		expect(describeFileProvenance({ ...base, approximate: true }, formatTime)).toContain(
			'The file seems older'
		);
	});

	it('mentions a matching backup and an outside edit', () => {
		const text = describeFileProvenance(
			{ ...base, relation: 'different', editedOutside: true, matchesBackupAt: 3 },
			formatTime
		);

		expect(text).toBe(
			'The file was changed outside Foldnano after it was downloaded (t1). The browser copy was last saved t2. It matches your backup from t3.'
		);
	});
});
