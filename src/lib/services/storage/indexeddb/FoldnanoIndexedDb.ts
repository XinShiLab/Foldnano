import Dexie, { type Table } from 'dexie';
import type { BackupReason, DocumentMetadata, LocalBackup, SaveDocumentOptions } from '../types';
import type {
	ErrorLogRecord,
	IndexedDbDocumentContextRecord,
	IndexedDbDocumentRecord,
	IndexedDbDocumentSnapshotRecord,
	IndexedDbFileHandleRecord,
	IndexedDbGitHubFileRecord,
	IndexedDbGitHubRepoContextRecord,
	IndexedDbLocalBackupRecord,
	IndexedDbLocalFolderEntryRecord,
	IndexedDbLocalOnlyEntryRecord,
	IndexedDbMigrationRecord,
	IndexedDbPluginRecord,
	IndexedDbPluginFilesRecord,
	IndexedDbSettingRecord,
} from '../indexedDbTypes';
import {
	FOLDNANO_INDEXED_DB_NAME,
	FOLDNANO_INDEXED_DB_VERSION,
	LOCAL_BACKUP_INTERVAL_MS,
	MAX_LOCAL_BACKUPS_PER_DOC,
} from '../indexedDbTypes';

export interface IndexedDbPersistenceBackend {
	saveDocument(
		docId: string,
		snapshot: object,
		options?: SaveDocumentOptions
	): Promise<DocumentMetadata>;
	loadDocument(docId: string): Promise<object | null>;
	getLocalBackups(docId: string): Promise<LocalBackup[]>;
	getLastModified(docId: string): Promise<number | null>;
	deleteDocument(docId: string): Promise<void>;
	saveContext(docId: string, context: object): Promise<void>;
	loadContext(docId: string): Promise<object | null>;
	getDocumentList(): Promise<DocumentMetadata[]>;
	getMigrationRecord(key: string): Promise<IndexedDbMigrationRecord | null>;
	setMigrationRecord(record: IndexedDbMigrationRecord): Promise<void>;
	savePlugin(record: IndexedDbPluginRecord): Promise<void>;
	deletePlugin(id: string): Promise<void>;
	loadAllPlugins(): Promise<IndexedDbPluginRecord[]>;
	savePluginEditorState(pluginId: string, code: string): Promise<void>;
	savePluginEnabled(pluginId: string, enabled: boolean): Promise<void>;
	savePluginFiles(record: IndexedDbPluginFilesRecord): Promise<void>;
	loadPluginFiles(id: string): Promise<IndexedDbPluginFilesRecord | null>;
	deletePluginFiles(id: string): Promise<void>;
	addErrorLog(record: ErrorLogRecord): Promise<void>;
	getRecentErrorLogs(limit?: number): Promise<ErrorLogRecord[]>;
	clearErrorLogs(): Promise<void>;
}

// Context objects may contain Svelte $state proxy objects. This helper strips the proxy
// by round-tripping through JSON so only plain serializable values are written to IndexedDB.
// Document snapshots do NOT need this because FoldnanoDocument.toJSON() already returns a
// plain object.
function normalizeIndexedDbValue<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

/** Shape of the `githubBackups` table (versions 1-6), read once by the version 6 upgrade. */
interface LegacyGitHubBackupRecord {
	id: string;
	docId: string;
	owner: string;
	repo: string;
	branch: string;
	path: string;
	createdAt: number;
	reason: string;
	snapshot: object;
}

const LEGACY_GITHUB_BACKUP_REASONS: Record<string, BackupReason> = {
	before_pull: 'before_pull',
	before_accept_remote: 'before_accept_remote',
	before_branch_reload: 'before_branch_reload',
	before_conflict_resolve_overwrite: 'before_conflict_resolve',
};

export class FoldnanoIndexedDb extends Dexie implements IndexedDbPersistenceBackend {
	documents!: Table<IndexedDbDocumentRecord, string>;
	documentSnapshots!: Table<IndexedDbDocumentSnapshotRecord, string>;
	documentContexts!: Table<IndexedDbDocumentContextRecord, string>;
	githubRepoContexts!: Table<IndexedDbGitHubRepoContextRecord, string>;
	githubFiles!: Table<IndexedDbGitHubFileRecord, string>;
	localOnlyEntries!: Table<IndexedDbLocalOnlyEntryRecord, [string, string]>;
	localFolderEntries!: Table<IndexedDbLocalFolderEntryRecord, [string, string]>;
	migrations!: Table<IndexedDbMigrationRecord, string>;
	plugins!: Table<IndexedDbPluginRecord, string>;
	pluginFiles!: Table<IndexedDbPluginFilesRecord, string>;
	errorLogs!: Table<ErrorLogRecord, string>;
	localBackups!: Table<IndexedDbLocalBackupRecord, string>;
	fileHandles!: Table<IndexedDbFileHandleRecord, string>;
	settings!: Table<IndexedDbSettingRecord, string>;

	constructor(name = FOLDNANO_INDEXED_DB_NAME) {
		super(name);

		this.version(1).stores({
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

		this.version(2).stores({
			plugins: 'id',
		});

		this.version(3).stores({
			pluginFiles: 'id',
		});

		this.version(4).stores({
			errorLogs: 'id, timestamp',
		});

		this.version(5).stores({
			localBackups: 'id, [docId+createdAt]',
		});

		// GitHub backups join the single per-document backup timeline.
		this.version(6)
			.stores({})
			.upgrade(async (tx) => {
				const local = tx.table<LocalBackup, string>('localBackups');
				await local.toCollection().modify((backup) => {
					backup.reason ??= 'periodic';
				});
				const legacy = await tx.table<LegacyGitHubBackupRecord, string>('githubBackups').toArray();
				await local.bulkPut(
					legacy.map((b) => ({
						id: b.id,
						docId: b.docId,
						createdAt: b.createdAt,
						reason: LEGACY_GITHUB_BACKUP_REASONS[b.reason] ?? 'before_pull',
						github: { owner: b.owner, repo: b.repo, branch: b.branch, path: b.path },
						snapshot: b.snapshot,
					}))
				);
				const byDoc = new Map<string, LocalBackup[]>();
				for (const b of await local.toArray()) {
					byDoc.set(b.docId, [...(byDoc.get(b.docId) ?? []), b]);
				}
				const stale = [...byDoc.values()].flatMap((list) =>
					list
						.sort((a, b) => b.createdAt - a.createdAt)
						.slice(MAX_LOCAL_BACKUPS_PER_DOC)
						.map((b) => b.id)
				);
				await local.bulkDelete(stale);
			});

		this.version(7).stores({
			githubBackups: null,
		});

		this.version(FOLDNANO_INDEXED_DB_VERSION).stores({
			fileHandles: 'id, purpose',
			settings: 'key',
		});
	}

	isAvailable(): boolean {
		return typeof indexedDB !== 'undefined';
	}

	async saveDocument(
		docId: string,
		snapshot: object,
		options?: SaveDocumentOptions
	): Promise<DocumentMetadata> {
		const existing = await this.documents.get(docId);
		// Strictly increasing per document: GitHub dirty detection compares these stamps, and two
		// saves in one millisecond must not look identical.
		const now = Math.max(Date.now(), (existing?.lastModified ?? 0) + 1);
		const record: IndexedDbDocumentRecord = {
			id: docId,
			name: (snapshot as { name?: string }).name || existing?.name || 'Untitled Document',
			lastModified: now,
			lastAutoSaved: now,
			documentUpdatedAt: now,
			lastLocalPersistAt: now,
			githubPath: existing?.githubPath,
			repoKey: existing?.repoKey,
		};

		await this.transaction(
			'rw',
			this.documents,
			this.documentSnapshots,
			this.localBackups,
			async () => {
				await this.#backUpPreviousSnapshot(docId, now, options?.backup);
				await this.documents.put(record);
				await this.documentSnapshots.put({
					docId,
					snapshot,
					lastLocalPersistAt: now,
				});
			}
		);

		return record;
	}

	#backupsOf(docId: string) {
		return this.localBackups
			.where('[docId+createdAt]')
			.between([docId, Dexie.minKey], [docId, Dexie.maxKey]);
	}

	/**
	 * Keeps the snapshot about to be overwritten as a backup, so a bad write or an unwanted
	 * overwrite never destroys the only copy. Periodic backups are spaced
	 * LOCAL_BACKUP_INTERVAL_MS apart; an overwrite (`backup` option) always keeps one.
	 */
	async #backUpPreviousSnapshot(
		docId: string,
		now: number,
		overwrite: SaveDocumentOptions['backup']
	): Promise<void> {
		const newest = await this.#backupsOf(docId).last();
		if (!overwrite && newest && now - newest.createdAt < LOCAL_BACKUP_INTERVAL_MS) return;
		const previous = await this.documentSnapshots.get(docId);
		if (!previous) return;
		await this.localBackups.put({
			id: crypto.randomUUID(),
			docId,
			// Strictly increasing, so two backups within one millisecond keep their order.
			createdAt: newest ? Math.max(now, newest.createdAt + 1) : now,
			reason: overwrite?.reason ?? 'periodic',
			...(overwrite?.github ? { github: { ...overwrite.github } } : {}),
			snapshot: previous.snapshot,
		});
		const keys = await this.#backupsOf(docId).primaryKeys();
		if (keys.length > MAX_LOCAL_BACKUPS_PER_DOC) {
			await this.localBackups.bulkDelete(keys.slice(0, keys.length - MAX_LOCAL_BACKUPS_PER_DOC));
		}
	}

	async getLocalBackups(docId: string): Promise<LocalBackup[]> {
		const backups = await this.#backupsOf(docId).toArray();
		// Rows written by the unreleased version 5 schema may lack a reason.
		return backups.reverse().map((b) => ({ ...b, reason: b.reason ?? 'periodic' }));
	}

	async loadDocument(docId: string): Promise<object | null> {
		return (await this.documentSnapshots.get(docId))?.snapshot ?? null;
	}

	/** The stored save time (`documents.lastModified`) of the current snapshot. */
	async getLastModified(docId: string): Promise<number | null> {
		return (await this.documents.get(docId))?.lastModified ?? null;
	}

	async deleteDocument(docId: string): Promise<void> {
		await this.transaction(
			'rw',
			[this.documents, this.documentSnapshots, this.documentContexts, this.localBackups],
			async () => {
				await this.documents.delete(docId);
				await this.documentSnapshots.delete(docId);
				await this.documentContexts.delete(docId);
				await this.#backupsOf(docId).delete();
			}
		);
	}

	async saveContext(docId: string, context: object): Promise<void> {
		const normalizedContext = normalizeIndexedDbValue(context);
		await this.documentContexts.put({
			docId,
			context: normalizedContext,
			updatedAt: Date.now(),
		});
	}

	async loadContext(docId: string): Promise<object | null> {
		return (await this.documentContexts.get(docId))?.context ?? null;
	}

	async getDocumentList(): Promise<DocumentMetadata[]> {
		const records = await this.documents.toArray();
		return records.map(({ id, name, lastModified, lastAutoSaved }) => ({
			id,
			name,
			lastModified,
			lastAutoSaved,
		}));
	}

	async getMigrationRecord(key: string): Promise<IndexedDbMigrationRecord | null> {
		return (await this.migrations.get(key)) ?? null;
	}

	async setMigrationRecord(record: IndexedDbMigrationRecord): Promise<void> {
		await this.migrations.put(record);
	}

	async savePlugin(record: IndexedDbPluginRecord): Promise<void> {
		await this.plugins.put(record);
	}

	/** Atomically writes the manifest and (optionally) files records for registerNew()/
	 *  replaceConfirmed(). `add()` enforces id uniqueness at the DB layer, closing the race
	 *  between two concurrent registerNew() calls for the same id. */
	async saveInstalledPlugin(
		manifest: IndexedDbPluginRecord,
		files: IndexedDbPluginFilesRecord | null,
		isNew: boolean,
		/** Refuse unless the stored manifest still has this version (another tab saved first). */
		expectedVersion?: string
	): Promise<void> {
		await this.transaction('rw', this.plugins, this.pluginFiles, async () => {
			if (expectedVersion !== undefined) {
				const stored = await this.plugins.get(manifest.id);
				const storedVersion = (stored?.manifest as { version?: string } | undefined)?.version;
				if (storedVersion !== expectedVersion) {
					throw new PluginVersionConflictError(manifest.id, expectedVersion, storedVersion);
				}
			}
			if (isNew) await this.plugins.add(manifest);
			else await this.plugins.put(manifest);
			if (files) await this.pluginFiles.put(files);
			else await this.pluginFiles.delete(manifest.id);
		});
	}

	async deletePlugin(id: string): Promise<void> {
		await this.plugins.delete(id);
	}

	async loadAllPlugins(): Promise<IndexedDbPluginRecord[]> {
		return this.plugins.toArray();
	}

	async savePluginEditorState(pluginId: string, code: string): Promise<void> {
		const existing = await this.plugins.get(pluginId);
		if (existing) {
			await this.plugins.update(pluginId, { sidePanelCode: code });
		} else {
			await this.plugins.put({ id: pluginId, sidePanelCode: code });
		}
	}

	/** Writes fields onto an existing plugin record; `undefined` values clear them. */
	async updatePluginRecord(
		pluginId: string,
		patch: Partial<
			Pick<IndexedDbPluginRecord, 'authoring' | 'draftCode' | 'manifest' | 'iconSvg' | 'linked'>
		>
	): Promise<void> {
		const updated = await this.plugins.update(pluginId, patch);
		if (updated === 0) throw new Error(`Plugin "${pluginId}" is not stored in this browser.`);
	}

	async savePluginEnabled(pluginId: string, enabled: boolean): Promise<void> {
		const existing = await this.plugins.get(pluginId);
		if (existing) {
			await this.plugins.update(pluginId, { enabled });
		} else {
			await this.plugins.put({ id: pluginId, enabled });
		}
	}

	async savePluginFiles(record: IndexedDbPluginFilesRecord): Promise<void> {
		await this.pluginFiles.put(record);
	}

	async loadPluginFiles(id: string): Promise<IndexedDbPluginFilesRecord | null> {
		return (await this.pluginFiles.get(id)) ?? null;
	}

	async deletePluginFiles(id: string): Promise<void> {
		await this.pluginFiles.delete(id);
	}

	async saveFileHandle(record: IndexedDbFileHandleRecord): Promise<void> {
		await this.fileHandles.put(record);
	}

	async loadFileHandle(id: string): Promise<IndexedDbFileHandleRecord | null> {
		return (await this.fileHandles.get(id)) ?? null;
	}

	async deleteFileHandle(id: string): Promise<void> {
		await this.fileHandles.delete(id);
	}

	async getSetting<T>(key: string): Promise<T | undefined> {
		return (await this.settings.get(key))?.value as T | undefined;
	}

	async setSetting(key: string, value: unknown): Promise<void> {
		await this.settings.put({ key, value });
	}

	async addErrorLog(record: ErrorLogRecord): Promise<void> {
		const cap = 50;
		await this.errorLogs.put(record);
		const count = await this.errorLogs.count();
		if (count > cap) {
			const oldestIds = await this.errorLogs
				.orderBy('timestamp')
				.limit(count - cap)
				.primaryKeys();
			await this.errorLogs.bulkDelete(oldestIds);
		}
	}

	async getRecentErrorLogs(limit = 50): Promise<ErrorLogRecord[]> {
		return this.errorLogs.orderBy('timestamp').reverse().limit(limit).toArray();
	}

	async clearErrorLogs(): Promise<void> {
		await this.errorLogs.clear();
	}
}

export const foldnanoIndexedDb = new FoldnanoIndexedDb();

/** A plugin's stored version moved on since this tab loaded it, so saving would overwrite it. */
export class PluginVersionConflictError extends Error {
	constructor(
		readonly pluginId: string,
		readonly expectedVersion: string,
		readonly storedVersion: string | undefined
	) {
		super(
			storedVersion
				? `Version ${storedVersion} of this plugin was saved in another tab. Reload this page to see it; your edits are kept as unsaved changes.`
				: `Plugin "${pluginId}" is no longer stored in this browser.`
		);
		this.name = 'PluginVersionConflictError';
	}
}
