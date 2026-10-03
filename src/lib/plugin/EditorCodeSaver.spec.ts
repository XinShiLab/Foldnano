import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EDITOR_SAVE_DELAY_MS, EditorCodeSaver } from './EditorCodeSaver.svelte';

describe('EditorCodeSaver', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('writes the latest edit once typing stops', async () => {
		const write = vi.fn().mockResolvedValue(undefined);
		const saver = new EditorCodeSaver(write);
		saver.schedule('a');
		saver.schedule('ab');
		expect(saver.state).toBe('pending');
		await vi.advanceTimersByTimeAsync(EDITOR_SAVE_DELAY_MS);
		expect(write).toHaveBeenCalledTimes(1);
		expect(write).toHaveBeenCalledWith('ab');
		expect(saver.state).toBe('saved');
	});

	it('flush writes a pending edit immediately instead of dropping it', async () => {
		const write = vi.fn().mockResolvedValue(undefined);
		const saver = new EditorCodeSaver(write);
		saver.schedule('closing soon');
		await saver.flush();
		expect(write).toHaveBeenCalledWith('closing soon');
		await vi.advanceTimersByTimeAsync(EDITOR_SAVE_DELAY_MS);
		expect(write).toHaveBeenCalledTimes(1);
	});

	it('does nothing on flush when there is no pending edit', async () => {
		const write = vi.fn().mockResolvedValue(undefined);
		await new EditorCodeSaver(write).flush();
		expect(write).not.toHaveBeenCalled();
	});

	it('reports a failed write and keeps the code for a retry', async () => {
		const write = vi
			.fn()
			.mockRejectedValueOnce(new Error('QuotaExceededError'))
			.mockResolvedValue(undefined);
		const saver = new EditorCodeSaver(write);
		saver.schedule('precious');
		await saver.flush();
		expect(saver.state).toBe('error');
		expect(saver.errorMessage).toBe('QuotaExceededError');

		await saver.retry();
		expect(write).toHaveBeenLastCalledWith('precious');
		expect(saver.state).toBe('saved');
		expect(saver.errorMessage).toBeNull();
	});

	it('stays in error while further edits are pending, then clears on success', async () => {
		const write = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined);
		const saver = new EditorCodeSaver(write);
		saver.schedule('v1');
		await saver.flush();
		saver.schedule('v2');
		expect(saver.state).toBe('error');
		await vi.advanceTimersByTimeAsync(EDITOR_SAVE_DELAY_MS);
		expect(write).toHaveBeenLastCalledWith('v2');
		expect(saver.state).toBe('saved');
	});
});
