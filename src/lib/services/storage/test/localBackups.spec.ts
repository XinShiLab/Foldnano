import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FoldnanoIndexedDb } from '../indexeddb/FoldnanoIndexedDb';
import { LOCAL_BACKUP_INTERVAL_MS, MAX_LOCAL_BACKUPS_PER_DOC } from '../indexedDbTypes';

describe('rotating local backups', () => {
	let db: FoldnanoIndexedDb;
	let now: number;

	async function saveAt(time: number, name: string, docId = 'doc-1') {
		now = time;
		await db.saveDocument(docId, { id: docId, name, parts: [] });
	}

	beforeEach(() => {
		db = new FoldnanoIndexedDb(`test-local-backups-${crypto.randomUUID()}`);
		now = 1_000_000;
		vi.spyOn(Date, 'now').mockImplementation(() => now);
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await db.delete();
	});

	it('gives every save of a document a later save time, even within one millisecond', async () => {
		await saveAt(5000, 'v1');
		await saveAt(5000, 'v2');

		expect(await db.getLastModified('doc-1')).toBe(5001);
	});

	it('has nothing to back up on the first save', async () => {
		await saveAt(now, 'v1');

		await expect(db.getLocalBackups('doc-1')).resolves.toEqual([]);
	});

	it('keeps the replaced snapshot as a periodic backup, stamped with when it was replaced', async () => {
		await saveAt(1_000_000, 'v1');
		await saveAt(1_000_500, 'v2');

		const backups = await db.getLocalBackups('doc-1');
		expect(backups).toHaveLength(1);
		expect(backups[0]).toMatchObject({ docId: 'doc-1', createdAt: 1_000_500, reason: 'periodic' });
		expect(backups[0].snapshot).toMatchObject({ name: 'v1' });
	});

	it('spaces generations by the backup interval', async () => {
		await saveAt(0, 'v1');
		await saveAt(1000, 'v2');
		await saveAt(2000, 'v3');
		await saveAt(LOCAL_BACKUP_INTERVAL_MS + 1000, 'v4');

		const names = (await db.getLocalBackups('doc-1')).map(
			(b) => (b.snapshot as { name: string }).name
		);
		expect(names).toEqual(['v3', 'v1']);
	});

	const PULL = {
		backup: {
			reason: 'before_pull' as const,
			github: { owner: 'alice', repo: 'designs', branch: 'main', path: 'a.fn.json' },
		},
	};

	it('always keeps a labelled backup when a write replaces the copy', async () => {
		await saveAt(0, 'v1');
		await saveAt(1000, 'v2');
		now = 2000;
		await db.saveDocument('doc-1', { id: 'doc-1', name: 'v3', parts: [] }, PULL);

		const backups = await db.getLocalBackups('doc-1');
		expect(backups.map((b) => [(b.snapshot as { name: string }).name, b.reason])).toEqual([
			['v2', 'before_pull'],
			['v1', 'periodic'],
		]);
		expect(backups[0].github).toEqual(PULL.backup.github);
	});

	it('restarts the periodic clock after an overwrite backup', async () => {
		await saveAt(0, 'v1');
		now = LOCAL_BACKUP_INTERVAL_MS * 2;
		await db.saveDocument('doc-1', { id: 'doc-1', name: 'v2', parts: [] }, PULL);
		await saveAt(LOCAL_BACKUP_INTERVAL_MS * 2 + 1000, 'v3');

		expect((await db.getLocalBackups('doc-1')).map((b) => b.reason)).toEqual(['before_pull']);
	});

	it('keeps backups taken in the same millisecond in order', async () => {
		await saveAt(5000, 'v1');
		await db.saveDocument('doc-1', { id: 'doc-1', name: 'v2', parts: [] }, PULL);
		await db.saveDocument('doc-1', { id: 'doc-1', name: 'v3', parts: [] }, PULL);

		const backups = await db.getLocalBackups('doc-1');
		expect(backups.map((b) => (b.snapshot as { name: string }).name)).toEqual(['v2', 'v1']);
		expect(backups[0].createdAt).toBeGreaterThan(backups[1].createdAt);
	});

	it('keeps one timeline across reasons, capped per document', async () => {
		for (let i = 0; i < MAX_LOCAL_BACKUPS_PER_DOC; i++) {
			await saveAt(i, `v${i}`);
			now = i + 0.5;
			await db.saveDocument('doc-1', { id: 'doc-1', name: `p${i}`, parts: [] }, PULL);
		}

		const backups = await db.getLocalBackups('doc-1');
		expect(backups).toHaveLength(MAX_LOCAL_BACKUPS_PER_DOC);
		expect(backups.every((b) => b.reason === 'before_pull')).toBe(true);
	});

	it('keeps only the newest generations per document', async () => {
		for (let i = 0; i <= MAX_LOCAL_BACKUPS_PER_DOC + 2; i++) {
			await saveAt(i * LOCAL_BACKUP_INTERVAL_MS, `v${i}`);
		}
		await saveAt(0, 'other', 'doc-2');

		const backups = await db.getLocalBackups('doc-1');
		expect(backups).toHaveLength(MAX_LOCAL_BACKUPS_PER_DOC);
		expect((backups[0].snapshot as { name: string }).name).toBe(
			`v${MAX_LOCAL_BACKUPS_PER_DOC + 1}`
		);
		await expect(db.getLocalBackups('doc-2')).resolves.toEqual([]);
	});

	it('removes backups when the document is deleted', async () => {
		await saveAt(0, 'v1');
		await saveAt(1000, 'v2');

		await db.deleteDocument('doc-1');

		await expect(db.getLocalBackups('doc-1')).resolves.toEqual([]);
	});
});

describe('backup storage upgrade', () => {
	it('moves GitHub backups into the timeline and drops the old table', async () => {
		const name = `test-backup-upgrade-${crypto.randomUUID()}`;
		const old = new Dexie(name);
		old.version(1).stores({
			documents: 'id, name, documentUpdatedAt, lastLocalPersistAt, githubPath, repoKey',
			documentSnapshots: 'docId, lastLocalPersistAt',
			documentContexts: 'docId, updatedAt',
			githubRepoContexts: 'repoKey',
			githubFiles: 'docId, repoKey, lastSyncAt',
			githubBackups: 'id, docId, repoKey, createdAt',
			localOnlyEntries: '[repoKey+path], repoKey, docId',
			localFolderEntries: '[repoKey+path], repoKey',
			migrations: 'key',
		});
		old.version(2).stores({ plugins: 'id' });
		old.version(3).stores({ pluginFiles: 'id' });
		old.version(4).stores({ errorLogs: 'id, timestamp' });
		old.version(5).stores({ localBackups: 'id, [docId+createdAt]' });
		await old.open();
		const github = { owner: 'alice', repo: 'designs', branch: 'main', path: 'a.fn.json' };
		await old.table('githubBackups').bulkPut([
			{
				id: 'g1',
				docId: 'doc-1',
				...github,
				repoKey: 'alice/designs',
				createdAt: 10,
				reason: 'before_pull',
				snapshot: { name: 'g1' },
			},
			{
				id: 'g2',
				docId: 'doc-1',
				...github,
				repoKey: 'alice/designs',
				createdAt: 30,
				reason: 'before_conflict_resolve_overwrite',
				snapshot: { name: 'g2' },
			},
		]);
		await old.table('localBackups').bulkPut(
			[5, 20, 40, 50, 60].map((t) => ({
				id: `l${t}`,
				docId: 'doc-1',
				createdAt: t,
				snapshot: { name: `l${t}` },
			}))
		);
		old.close();

		const db = new FoldnanoIndexedDb(name);
		await db.open();

		expect(db.tables.map((t) => t.name)).not.toContain('githubBackups');
		const backups = await db.getLocalBackups('doc-1');
		expect(backups.map((b) => [b.id, b.reason])).toEqual([
			['l60', 'periodic'],
			['l50', 'periodic'],
			['l40', 'periodic'],
			['g2', 'before_conflict_resolve'],
			['l20', 'periodic'],
		]);
		expect(backups[3].github).toEqual(github);
		await db.delete();
	});
});
