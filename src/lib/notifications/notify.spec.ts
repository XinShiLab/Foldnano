import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sonner = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn(),
	warning: vi.fn(),
	info: vi.fn(),
}));
vi.mock('svelte-sonner', () => ({ toast: sonner }));
const { addErrorLog } = vi.hoisted(() => ({ addErrorLog: vi.fn(() => Promise.resolve()) }));
vi.mock('$lib/services/storage/indexeddb/FoldnanoIndexedDb', () => ({
	foldnanoIndexedDb: { addErrorLog },
}));

const {
	notify,
	notificationHistory,
	clearNotificationHistory,
	markNotificationsSeen,
	NOTIFICATION_COALESCE_MS,
	NOTIFICATION_HISTORY_LIMIT,
} = await import('./notify.svelte');
const { reportError } = await import('$lib/errorReporting');
const { InvalidOperationError } = await import('$lib/errors');

describe('notify', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000_000);
		clearNotificationHistory();
		Object.values(sonner).forEach((fn) => fn.mockClear());
		addErrorLog.mockClear();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('shows the toast and strips its own options before handing them to sonner', () => {
		const action = { label: 'Go', onClick: () => {} };
		notify.warning('Careful', { description: 'why', action, history: true, errorLogId: 'ab12' });
		expect(sonner.warning).toHaveBeenCalledWith('Careful', { description: 'why', action });
		notify.success('Done');
		expect(sonner.success).toHaveBeenCalledWith('Done');
	});

	it('keeps errors and warnings by default, successes and info only when asked', () => {
		notify.success('Copied');
		notify.info('No more commits');
		expect(notificationHistory.entries).toHaveLength(0);

		notify.error('Failed');
		notify.warning('Odd');
		notify.success('Committed', { history: true });
		notify.warning('Cannot place skip', { history: false });
		expect(notificationHistory.entries.map((e) => e.title)).toEqual(['Committed', 'Odd', 'Failed']);
	});

	it('merges a repeat of the newest entry within the window and collects its details', () => {
		notify.warning('Cadnano import warning', { description: 'a' });
		vi.advanceTimersByTime(1000);
		notify.warning('Cadnano import warning', { description: 'b' });
		notify.warning('Cadnano import warning', { description: 'a' });
		expect(notificationHistory.entries).toHaveLength(1);
		const [entry] = notificationHistory.entries;
		expect(entry.count).toBe(3);
		expect(entry.details).toEqual(['a', 'b']);
		expect(entry.lastAt).toBe(1_001_000);
		expect(entry.firstAt).toBe(1_000_000);
	});

	it('starts a new entry outside the window or for a different level or title', () => {
		notify.warning('Same');
		vi.advanceTimersByTime(NOTIFICATION_COALESCE_MS + 1);
		notify.warning('Same');
		notify.error('Same');
		notify.error('Other');
		expect(notificationHistory.entries.map((e) => `${e.level}:${e.title}`)).toEqual([
			'error:Other',
			'error:Same',
			'warning:Same',
			'warning:Same',
		]);
	});

	it('caps the list, dropping the oldest', () => {
		for (let i = 0; i < NOTIFICATION_HISTORY_LIMIT + 5; i++) notify.error(`e${i}`);
		expect(notificationHistory.entries).toHaveLength(NOTIFICATION_HISTORY_LIMIT);
		expect(notificationHistory.entries[0].title).toBe(`e${NOTIFICATION_HISTORY_LIMIT + 4}`);
		expect(notificationHistory.entries.at(-1)?.title).toBe('e5');
	});

	it('flags unseen errors and warnings only, until the list is opened', () => {
		notify.success('Committed', { history: true });
		expect(notificationHistory.hasUnseenAttention).toBe(false);
		notify.warning('Odd');
		expect(notificationHistory.hasUnseenAttention).toBe(true);
		markNotificationsSeen();
		expect(notificationHistory.hasUnseenAttention).toBe(false);
	});

	it('links reported errors to their Error Log entry', () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const id = reportError(new Error('boom'), 'test');
		const [entry] = notificationHistory.entries;
		expect(entry.title).toBe(`Something went wrong (#${id})`);
		expect(entry.errorLogId).toBe(id);
		expect(sonner.error.mock.calls[0][1]).not.toHaveProperty('errorLogId');
		expect(addErrorLog).toHaveBeenCalledTimes(1);
	});

	it('keeps refusals out of the Error Log but in the list, as warnings', () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const id = reportError(new InvalidOperationError('Cannot skip at an end'), 'tool');
		expect(id).toBeNull();
		expect(addErrorLog).not.toHaveBeenCalled();
		expect(sonner.warning).toHaveBeenCalledWith('Cannot skip at an end');
		const [entry] = notificationHistory.entries;
		expect(entry.level).toBe('warning');
		expect(entry.errorLogId).toBeUndefined();
	});
});
