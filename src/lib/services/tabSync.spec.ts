import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isTabSyncSupported, TabSync } from './tabSync.svelte';
import { flushLocks, installFakeLocks, type FakeLockManager } from './test/fakeLockManager';

// Each TabSync stands in for one browser tab; they share the (fake) lock manager like real tabs.
describe('TabSync', () => {
	let locks: FakeLockManager;
	let uninstall: () => void;
	const tabs: TabSync[] = [];
	const open = (docId: string, onRegained?: () => Promise<boolean>) => {
		const tab = new TabSync(docId, { onRegained });
		tabs.push(tab);
		return tab;
	};

	beforeEach(() => {
		({ locks, uninstall } = installFakeLocks());
	});
	afterEach(() => {
		for (const tab of tabs.splice(0)) tab.destroy();
		uninstall();
	});

	it('makes the only tab the owner', async () => {
		const tab = open('doc');
		await flushLocks();
		expect(tab.isOwner).toBe(true);
		expect(locks.heldNames()).toEqual(['foldnano-editor-doc']);
	});

	it('hands ownership to a tab that opens the same document later', async () => {
		const first = open('doc');
		await flushLocks();
		const second = open('doc');
		await flushLocks();
		expect(first.isOwner).toBe(false);
		expect(second.isOwner).toBe(true);
	});

	it('converges to exactly one owner when two tabs open the document at once', async () => {
		const tabsAtOnce = [open('doc'), open('doc')];
		await flushLocks();
		expect(tabsAtOnce.filter((tab) => tab.isOwner)).toHaveLength(1);
	});

	it('keeps tabs on different documents independent', async () => {
		const a = open('doc-a');
		const b = open('doc-b');
		await flushLocks();
		expect(a.isOwner && b.isOwner).toBe(true);
	});

	it('lets a read-only tab regain the document once the owner closes, via onRegained', async () => {
		const onRegained = vi.fn(async () => false);
		const first = open('doc', onRegained);
		await flushLocks();
		const second = open('doc');
		await flushLocks();

		second.destroy();
		await flushLocks();

		expect(onRegained).toHaveBeenCalledOnce();
		expect(first.isOwner).toBe(true);
	});

	it('stays read-only while onRegained takes over (reload replaces the TabSync)', async () => {
		let replacement: TabSync | null = null;
		const first = open('doc', async () => {
			first.destroy();
			replacement = open('doc');
			return true;
		});
		await flushLocks();
		const second = open('doc');
		await flushLocks();

		second.destroy();
		await flushLocks();

		expect(first.isOwner).toBe(false);
		expect(replacement!.isOwner).toBe(true);
		expect(locks.heldNames()).toEqual(['foldnano-editor-doc']);
	});

	it('takes control back from another tab when reopened (Take back control)', async () => {
		const first = open('doc');
		await flushLocks();
		const second = open('doc');
		await flushLocks();

		first.destroy();
		const reopened = open('doc');
		await flushLocks();

		expect(reopened.isOwner).toBe(true);
		expect(second.isOwner).toBe(false);
	});

	it('does not take the lock after being destroyed while waiting for it', async () => {
		const onRegained = vi.fn(async () => false);
		const first = open('doc', onRegained);
		await flushLocks();
		const second = open('doc');
		await flushLocks();

		first.destroy();
		second.destroy();
		await flushLocks();

		expect(onRegained).not.toHaveBeenCalled();
		expect(locks.heldNames()).toEqual([]);
	});
});

describe('isTabSyncSupported', () => {
	it('is false without the Web Locks API', () => {
		expect('locks' in navigator).toBe(false);
		expect(isTabSyncSupported()).toBe(false);
	});
});
