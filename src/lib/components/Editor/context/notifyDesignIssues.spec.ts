import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DesignIssue } from '$lib/model/checks/designIssue';

const warning = vi.fn();
vi.mock('svelte-sonner', () => ({ toast: { warning: (...args: unknown[]) => warning(...args) } }));

const { notifyDesignIssues } = await import('./documentRecovery');

const parity: DesignIssue = {
	rule: 'helix-cell-parity',
	severity: 'warning',
	message: 'Helix 0 has an even number on an odd lattice cell.',
};

describe('notifyDesignIssues', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		warning.mockClear();
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('shows one notice when the same document is adopted twice in a row', () => {
		notifyDesignIssues('doc-a', [parity]);
		notifyDesignIssues('doc-a', [parity]);

		expect(warning).toHaveBeenCalledTimes(1);
	});

	it('shows the notice again when the document is reopened later', () => {
		notifyDesignIssues('doc-b', [parity]);
		vi.advanceTimersByTime(11_000);
		notifyDesignIssues('doc-b', [parity]);

		expect(warning).toHaveBeenCalledTimes(2);
	});

	it('stays quiet for info-only issues', () => {
		notifyDesignIssues('doc-c', [{ ...parity, severity: 'info' }]);

		expect(warning).not.toHaveBeenCalled();
	});
});
