import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import {
	CURRENT_FORMAT_VERSION,
	DocumentFormatError,
	FOLDNANO_FORMAT,
	MIGRATIONS,
	applyMigrations,
	migrateDocumentJson,
	type RawDocumentJson,
} from '$lib/model/documentFormat';
import { foldnanojsonParser } from '$lib/components/Editor/Toolbar/parsers/foldnanojsonParser';

const FIXTURE_DIR = path.resolve('test_files/fixtures/document_format');

function readFixture(name: string): RawDocumentJson {
	return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf-8')) as RawDocumentJson;
}

function withoutHeader(json: object): object {
	const { format: _f, formatVersion: _v, savedWith: _s, ...rest } = json as RawDocumentJson;
	return rest;
}

function formatErrorOf(fn: () => unknown): DocumentFormatError {
	try {
		fn();
	} catch (e) {
		if (e instanceof DocumentFormatError) return e;
		throw e;
	}
	throw new Error('expected a DocumentFormatError');
}

describe('document format versioning', () => {
	describe('golden fixtures', () => {
		it.each(Array.from({ length: CURRENT_FORMAT_VERSION }, (_, i) => i + 1))(
			'has a fixture for version %i',
			(version) => {
				expect(fs.existsSync(path.join(FIXTURE_DIR, `v${version}.fn.json`))).toBe(true);
			}
		);

		it('loads a file saved before versioning as version 1 and round-trips it', () => {
			const raw = readFixture('v1-unversioned.fn.json');
			expect(raw.formatVersion).toBeUndefined();

			const saved = FoldnanoDocument.fromJSON(raw).toJSON();

			expect(saved.formatVersion).toBe(CURRENT_FORMAT_VERSION);
			expect(withoutHeader(saved)).toEqual(withoutHeader(raw));
		});

		it('round-trips the current-version fixture', () => {
			const raw = readFixture(`v${CURRENT_FORMAT_VERSION}.fn.json`);
			expect(raw.formatVersion).toBe(CURRENT_FORMAT_VERSION);

			const saved = FoldnanoDocument.fromJSON(raw).toJSON();

			expect(withoutHeader(saved)).toEqual(withoutHeader(raw));
		});
	});

	describe('saving', () => {
		it('writes the format tag, current version and provenance', () => {
			const json = new FoldnanoDocument().toJSON();

			expect(json.format).toBe(FOLDNANO_FORMAT);
			expect(json.formatVersion).toBe(CURRENT_FORMAT_VERSION);
			expect(typeof json.savedWith?.app).toBe('string');
			expect(typeof json.savedWith?.commit).toBe('string');
		});
	});

	describe('refusing files', () => {
		it('refuses a file from a newer app with a friendly message', () => {
			const raw = {
				...readFixture(`v${CURRENT_FORMAT_VERSION}.fn.json`),
				formatVersion: CURRENT_FORMAT_VERSION + 1,
				savedWith: { app: '9.9.9', commit: 'abc1234' },
			};

			const error = formatErrorOf(() => FoldnanoDocument.fromJSON(raw));

			expect(error.reason).toBe('too-new');
			expect(error.message).toContain(`version ${CURRENT_FORMAT_VERSION + 1}`);
			expect(error.message).toContain('Foldnano 9.9.9');
			expect(error.message).toContain('Reload the page');
		});

		it.each([
			['a non-object', [1, 2]],
			['another format tag', { format: 'cadnano', parts: [] }],
			['a zero version', { formatVersion: 0, parts: [] }],
			['a fractional version', { formatVersion: 1.5, parts: [] }],
			['a string version', { formatVersion: '1', parts: [] }],
			['no parts list', { formatVersion: 1 }],
		])('refuses %s as malformed', (_label, raw) => {
			expect(formatErrorOf(() => migrateDocumentJson(raw)).reason).toBe('malformed');
		});

		it('passes the friendly error through the file-open parser', () => {
			const raw = { format: FOLDNANO_FORMAT, formatVersion: CURRENT_FORMAT_VERSION + 1, parts: [] };
			const meta = { name: 'future.fn.json', extension: 'json', size: 0, type: '' };

			expect(foldnanojsonParser.canParse(raw, meta)).toBe(true);
			expect(() => foldnanojsonParser.parse(raw, meta)).toThrow(DocumentFormatError);
		});
	});

	describe('migration registry', () => {
		it('has a migration for every version below the current one', () => {
			const expected = Array.from({ length: CURRENT_FORMAT_VERSION - 1 }, (_, i) => i + 1);
			expect(
				Object.keys(MIGRATIONS)
					.map(Number)
					.sort((a, b) => a - b)
			).toEqual(expected);
		});

		it('applies migrations in order up to the target version', () => {
			const steps: number[] = [];
			const migrations = {
				1: (raw: RawDocumentJson) => (steps.push(1), { ...raw, renamed: raw.old }),
				2: (raw: RawDocumentJson) => (steps.push(2), { ...raw, added: true }),
			};

			const result = applyMigrations({ old: 'x' }, 1, 3, migrations);

			expect(steps).toEqual([1, 2]);
			expect(result).toEqual({ old: 'x', renamed: 'x', added: true });
		});

		it('throws when a migration step is missing', () => {
			expect(() => applyMigrations({}, 1, 3, { 1: (raw) => raw })).toThrow(/from version 2/);
		});
	});
});
