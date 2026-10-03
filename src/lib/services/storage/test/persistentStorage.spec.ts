import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	checkStoragePersistence,
	requestStoragePersistence,
	resetStoragePersistenceForTests,
} from '../persistentStorage';

function stubStorage(persisted: boolean, grant: boolean) {
	const storage = {
		persisted: vi.fn(async () => persisted),
		persist: vi.fn(async () => grant),
	};
	vi.stubGlobal('navigator', { storage });
	return storage;
}

describe('persistent storage', () => {
	beforeEach(() => resetStoragePersistenceForTests());
	afterEach(() => vi.unstubAllGlobals());

	it('checks without prompting', async () => {
		const storage = stubStorage(false, true);

		await expect(checkStoragePersistence()).resolves.toBe('best-effort');
		expect(storage.persist).not.toHaveBeenCalled();
	});

	it('requests once per page load', async () => {
		const storage = stubStorage(false, true);

		await expect(requestStoragePersistence()).resolves.toBe('persistent');
		await requestStoragePersistence();

		expect(storage.persist).toHaveBeenCalledOnce();
	});

	it('skips the request when storage is already persistent', async () => {
		const storage = stubStorage(true, false);

		await expect(requestStoragePersistence()).resolves.toBe('persistent');
		expect(storage.persist).not.toHaveBeenCalled();
	});

	it('reports a denied request as best-effort', async () => {
		stubStorage(false, false);

		await expect(requestStoragePersistence()).resolves.toBe('best-effort');
	});

	it('reports unsupported browsers', async () => {
		vi.stubGlobal('navigator', {});

		await expect(checkStoragePersistence()).resolves.toBe('unsupported');
		await expect(requestStoragePersistence()).resolves.toBe('unsupported');
	});
});
