import { describe, expect, it } from 'vitest';
import { summarizeCommitAll } from './commitSummary';

describe('summarizeCommitAll', () => {
	it('reports a clean run as success', () => {
		expect(summarizeCommitAll({ committed: ['a', 'b'], conflicts: [], failed: [] })).toEqual({
			kind: 'success',
			title: 'Committed 2 files',
			details: [],
		});
	});

	it('explains a partial run: what went through, what did not, and why', () => {
		const summary = summarizeCommitAll({
			committed: ['a.fn.json'],
			conflicts: ['b.fn.json'],
			failed: [{ name: 'c.fn.json', reason: 'Your GitHub session has expired.' }],
		});

		expect(summary.kind).toBe('partial');
		expect(summary.title).toBe('Committed 1 of 3 files');
		expect(summary.details[0]).toMatch(/Changed on GitHub.*b\.fn\.json/);
		expect(summary.details[1]).toBe('c.fn.json: Your GitHub session has expired.');
		expect(summary.details.at(-1)).toMatch(/stay in Changes/);
	});

	it('reports a run where nothing went through as a failure', () => {
		const summary = summarizeCommitAll({
			committed: [],
			conflicts: [],
			failed: [{ name: 'a.fn.json', reason: 'offline' }],
		});

		expect(summary.kind).toBe('failure');
		expect(summary.title).toBe('Nothing was committed');
	});
});
