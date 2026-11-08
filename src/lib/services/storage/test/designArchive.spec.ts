import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import {
	buildDesignArchive,
	designArchiveFileName,
	exportAllDesigns,
	type ArchiveDesign,
	type DesignArchiveManifest,
} from '../designArchive';
import { StorageManager } from '../StorageManager';
import type { StorageProvider } from '../StorageProvider';
import type { DocumentMetadata } from '../types';
import type { GitHubFileMetadata } from '../githubTypes';

const EXPORTED_AT = new Date('2026-11-07T10:00:00Z');

function design(id: string, name: string, lastModified = 1): ArchiveDesign {
	return {
		id,
		name,
		lastModified,
		snapshot: new FoldnanoDocument(id, name).toJSON(),
		github: null,
	};
}

function unzip(zip: Uint8Array): Record<string, string> {
	return Object.fromEntries(
		Object.entries(unzipSync(zip)).map(([name, bytes]) => [name, strFromU8(bytes)])
	);
}

describe('buildDesignArchive', () => {
	it('writes one .fn.json per design and a manifest that maps files to ids', () => {
		const { zip, manifest } = buildDesignArchive(
			[design('a', 'Tile'), design('b', 'Box')],
			EXPORTED_AT
		);
		const files = unzip(zip);

		expect(Object.keys(files).sort()).toEqual(['Box.fn.json', 'Tile.fn.json', 'manifest.json']);
		expect(JSON.parse(files['Tile.fn.json']).id).toBe('a');
		const written = JSON.parse(files['manifest.json']) as DesignArchiveManifest;
		expect(written).toEqual(manifest);
		expect(written.format).toBe('foldnano-design-archive');
		expect(written.exportedAt).toBe(EXPORTED_AT.toISOString());
		expect(written.designs.map((d) => [d.file, d.id])).toEqual([
			['Tile.fn.json', 'a'],
			['Box.fn.json', 'b'],
		]);
	});

	it('numbers repeated names, ignoring case, and cleans unsafe characters', () => {
		const { manifest } = buildDesignArchive(
			[design('a', 'Tile'), design('b', 'tile'), design('c', 'Tile'), design('d', 'a/b: c')],
			EXPORTED_AT
		);

		expect(manifest.designs.map((d) => d.file)).toEqual([
			'Tile.fn.json',
			'tile (2).fn.json',
			'Tile (3).fn.json',
			'a-b- c.fn.json',
		]);
	});

	it('falls back to a default file name for a blank design name', () => {
		const { manifest } = buildDesignArchive([design('a', '  ')], EXPORTED_AT);

		expect(manifest.designs[0].file).toBe('design.fn.json');
	});

	it('records where a GitHub-linked design came from', () => {
		const linked: ArchiveDesign = {
			...design('a', 'Linked'),
			github: {
				owner: 'alice',
				repo: 'designs',
				branch: 'main',
				path: 'tiles/linked.fn.json',
				sha: 'abc',
				lastSyncAt: 5,
			} as GitHubFileMetadata,
		};
		const { manifest } = buildDesignArchive([linked], EXPORTED_AT);

		expect(manifest.designs[0].github).toEqual({
			owner: 'alice',
			repo: 'designs',
			branch: 'main',
			path: 'tiles/linked.fn.json',
		});
	});
});

describe('exportAllDesigns', () => {
	it('exports every stored snapshot as is and reports listed designs without one', async () => {
		const damaged = { id: 'broken', name: 'Broken', parts: 'not-an-array' };
		const docs: Record<string, object> = { good: design('good', 'Good').snapshot, broken: damaged };
		const list: DocumentMetadata[] = [
			{ id: 'good', name: 'Good', lastModified: 2, lastAutoSaved: 2 },
			{ id: 'broken', name: 'Broken', lastModified: 1, lastAutoSaved: 1 },
			{ id: 'gone', name: 'Gone', lastModified: 3, lastAutoSaved: 3 },
		];
		const provider = {
			getDocumentList: async () => list,
			loadDocument: async (id: string) => docs[id] ?? null,
		} as unknown as StorageProvider;
		const storage = new StorageManager('memory');
		storage.registerProvider('memory', provider);

		const { zip, manifest, skipped } = await exportAllDesigns(storage, () => null, EXPORTED_AT);

		// Oldest first, so a later design with a repeated name gets the number.
		expect(manifest.designs.map((d) => d.id)).toEqual(['broken', 'good']);
		expect(JSON.parse(unzip(zip)['Broken.fn.json'])).toEqual(damaged);
		expect(skipped.map((d) => d.id)).toEqual(['gone']);
	});
});

describe('designArchiveFileName', () => {
	it('names the zip after the local export date', () => {
		expect(designArchiveFileName(new Date(2026, 0, 5, 23, 59))).toBe(
			'foldnano-designs-2026-01-05.zip'
		);
	});
});
