import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FoldnanoIndexedDb } from '../indexeddb/FoldnanoIndexedDb';
import {
	ERROR_LOG_MAX_AGE_MS,
	MAX_ERROR_LOG_ENTRIES,
	type ErrorLogRecord,
} from '../indexedDbTypes';

describe('error log retention', () => {
	let db: FoldnanoIndexedDb;
	let now: number;

	function entry(id: string, timestamp: number): ErrorLogRecord {
		return {
			id,
			timestamp,
			context: 'test',
			message: id,
			severity: 'error',
			appVersion: '0.0.0',
			commitHash: 'test',
		};
	}

	beforeEach(() => {
		db = new FoldnanoIndexedDb(`test-error-logs-${crypto.randomUUID()}`);
		now = ERROR_LOG_MAX_AGE_MS * 2;
		vi.spyOn(Date, 'now').mockImplementation(() => now);
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await db.delete();
	});

	it('keeps only the newest entries past the count cap', async () => {
		for (let i = 0; i < MAX_ERROR_LOG_ENTRIES + 3; i++) {
			await db.addErrorLog(entry(`e${i}`, now - 1000 + i));
		}
		const logs = await db.getRecentErrorLogs();
		expect(logs).toHaveLength(MAX_ERROR_LOG_ENTRIES);
		expect(logs.at(-1)?.id).toBe('e3');
	});

	it('drops entries older than the age limit on write', async () => {
		await db.addErrorLog(entry('old', now - ERROR_LOG_MAX_AGE_MS - 1));
		await db.addErrorLog(entry('new', now));
		expect((await db.getRecentErrorLogs()).map((e) => e.id)).toEqual(['new']);
	});

	it('drops entries that aged out since they were written, on read', async () => {
		await db.addErrorLog(entry('a', now));
		now += ERROR_LOG_MAX_AGE_MS + 1;
		expect(await db.getRecentErrorLogs()).toEqual([]);
	});

	it('adds repeats to an existing entry, and reports when the entry is gone', async () => {
		await db.addErrorLog(entry('a', now));
		expect(await db.bumpErrorLog('a', 3, now + 5)).toBe(true);
		expect(await db.bumpErrorLog('a', 1, now + 9)).toBe(true);
		const [logged] = await db.getRecentErrorLogs();
		expect(logged).toMatchObject({ count: 5, lastSeenAt: now + 9 });
		expect(await db.bumpErrorLog('missing', 1, now)).toBe(false);
	});

	it('clears every entry', async () => {
		await db.addErrorLog(entry('a', now));
		await db.clearErrorLogs();
		expect(await db.getRecentErrorLogs()).toEqual([]);
	});
});
