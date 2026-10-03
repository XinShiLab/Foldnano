/**
 * Without persistent storage the browser may evict the origin's IndexedDB under storage
 * pressure, taking every locally saved design with it.
 */
export type StoragePersistence = 'persistent' | 'best-effort' | 'unsupported';

let pendingRequest: Promise<StoragePersistence> | null = null;

function storageApi(): StorageManager | null {
	if (typeof navigator === 'undefined' || !navigator.storage?.persisted) return null;
	return navigator.storage;
}

/** Reads the current state without prompting the user. */
export async function checkStoragePersistence(): Promise<StoragePersistence> {
	const storage = storageApi();
	if (!storage) return 'unsupported';
	try {
		return (await storage.persisted()) ? 'persistent' : 'best-effort';
	} catch {
		return 'unsupported';
	}
}

/**
 * Asks for persistent storage once per page load. Some browsers (Firefox) show a permission
 * prompt, so call this after the user has saved work, not on page load.
 */
export function requestStoragePersistence(): Promise<StoragePersistence> {
	pendingRequest ??= (async () => {
		const storage = storageApi();
		if (!storage?.persist) return 'unsupported';
		try {
			if (await storage.persisted()) return 'persistent';
			const granted = await storage.persist();
			console.info(`[Storage] Persistent storage ${granted ? 'granted' : 'not granted'}`);
			return granted ? 'persistent' : 'best-effort';
		} catch {
			return 'unsupported';
		}
	})();
	return pendingRequest;
}

/** Test-only: forget the memoized request. */
export function resetStoragePersistenceForTests(): void {
	pendingRequest = null;
}
