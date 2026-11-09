import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ErrorLogRecord } from '$lib/services/storage/indexedDbTypes';

const sonner = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn(),
	warning: vi.fn(),
	info: vi.fn(),
}));
vi.mock('svelte-sonner', () => ({ toast: sonner }));
const db = vi.hoisted(() => ({
	addErrorLog: vi.fn((_record: ErrorLogRecord) => Promise.resolve()),
	bumpErrorLog: vi.fn((_id: string, _by: number, _at: number) => Promise.resolve(true)),
}));
vi.mock('$lib/services/storage/indexeddb/FoldnanoIndexedDb', () => ({ foldnanoIndexedDb: db }));

type CaptureModule = typeof import('./globalErrorCapture');
type ReportingModule = typeof import('./errorReporting');

describe('global error capture', () => {
	let capture: CaptureModule;
	let reporting: ReportingModule;
	let uninstall: () => void;

	function throwUncaught(error: unknown, init: ErrorEventInit = {}) {
		window.dispatchEvent(new ErrorEvent('error', { error, ...init }));
	}

	function rejectUnhandled(reason: unknown) {
		window.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason }));
	}

	beforeEach(async () => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000_000);
		vi.resetModules();
		Object.values(sonner).forEach((fn) => fn.mockClear());
		Object.values(db).forEach((fn) => fn.mockClear());
		capture = await import('./globalErrorCapture');
		reporting = await import('./errorReporting');
		uninstall = capture.installGlobalErrorCapture(window);
	});

	afterEach(() => {
		uninstall();
		vi.useRealTimers();
	});

	it('logs an uncaught error and an unhandled rejection with a toast', () => {
		throwUncaught(new Error('boom'));
		rejectUnhandled(new Error('rejected'));
		expect(db.addErrorLog.mock.calls.map(([entry]) => [entry.context, entry.message])).toEqual([
			['uncaught', 'boom'],
			['unhandled-rejection', 'rejected'],
		]);
		expect(sonner.error).toHaveBeenCalledTimes(2);
	});

	it('merges repeats into one entry with a count, toasting once', async () => {
		for (let i = 0; i < 5; i++) throwUncaught(new Error('every frame'));
		expect(db.addErrorLog).toHaveBeenCalledTimes(1);
		expect(sonner.error).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(reporting.ERROR_LOG_REPEAT_FLUSH_MS);
		const [id] = db.addErrorLog.mock.calls.map(([entry]) => entry.id);
		expect(db.bumpErrorLog).toHaveBeenCalledExactlyOnceWith(id, 4, expect.any(Number));
	});

	it('logs a repeat again under its id when the entry was cleared', async () => {
		throwUncaught(new Error('again'));
		db.bumpErrorLog.mockResolvedValueOnce(false);
		throwUncaught(new Error('again'));
		await vi.advanceTimersByTimeAsync(reporting.ERROR_LOG_REPEAT_FLUSH_MS);
		const ids = db.addErrorLog.mock.calls.map(([entry]) => entry.id);
		expect(ids).toHaveLength(2);
		expect(ids[1]).toBe(ids[0]);
	});

	it('ignores browser noise, cancellations and extension errors', () => {
		throwUncaught(null, {
			message: 'ResizeObserver loop completed with undelivered notifications.',
		});
		throwUncaught(null, { message: 'Script error.' });
		rejectUnhandled(
			Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' })
		);
		const fromExtension = new Error('injected');
		fromExtension.stack = 'Error: injected\n    at x (chrome-extension://abc/content.js:1:2)';
		throwUncaught(fromExtension);
		const noStack = new Error('also injected');
		noStack.stack = 'Error: also injected';
		throwUncaught(noStack, { filename: 'moz-extension://abc/content.js' });
		expect(db.addErrorLog).not.toHaveBeenCalled();
		expect(sonner.error).not.toHaveBeenCalled();
	});

	it('still logs an app error thrown under an extension wrapper', () => {
		const err = new Error('ours');
		err.stack =
			'Error: ours\n    at a (https://foldnano.app/_app/x.js:1:2)\n    at b (chrome-extension://abc/hook.js:3:4)';
		throwUncaught(err);
		expect(db.addErrorLog).toHaveBeenCalledTimes(1);
	});

	it('caps new uncaught errors per minute, leaving the rest to the console', () => {
		const limit = capture.MAX_NEW_UNCAUGHT_ERRORS_PER_MINUTE;
		for (let i = 0; i < limit + 5; i++) throwUncaught(new Error(`distinct ${i}`));
		expect(db.addErrorLog).toHaveBeenCalledTimes(limit);
		vi.advanceTimersByTime(60_000);
		throwUncaught(new Error('after the window'));
		expect(db.addErrorLog).toHaveBeenCalledTimes(limit + 1);
	});

	it('keeps an escaped refusal out of the log', async () => {
		const { InvalidOperationError } = await import('./errors');
		throwUncaught(new InvalidOperationError('Cannot skip at an end'));
		expect(db.addErrorLog).not.toHaveBeenCalled();
		expect(sonner.warning).toHaveBeenCalledWith('Cannot skip at an end');
	});

	it('stops listening once uninstalled', () => {
		const target = new EventTarget();
		capture.installGlobalErrorCapture(target as unknown as Window)();
		target.dispatchEvent(new ErrorEvent('error', { error: new Error('late') }));
		expect(db.addErrorLog).not.toHaveBeenCalled();
	});
});
