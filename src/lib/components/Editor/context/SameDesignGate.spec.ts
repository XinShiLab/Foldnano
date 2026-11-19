import { describe, expect, it } from 'vitest';
import { SameDesignGate } from './SameDesignGate.svelte';
import type { SameDesignQuestion } from './EditorDocumentSession.svelte';

const browserOnly = (name: string): SameDesignQuestion => ({
	kind: 'browser-only',
	designId: 'd1',
	incomingName: name,
	savedName: 'Saved',
	savedAt: 1,
	sameContent: null,
});

const otherRepoFile = (name: string): SameDesignQuestion => ({
	kind: 'other-repo-file',
	designId: 'd1',
	incomingName: name,
	incomingPath: `${name}.fn.json`,
	linkedPath: 'other.fn.json',
	suggestedName: `${name} copy`,
});

describe('SameDesignGate', () => {
	it('resolves with the answer and clears the question', async () => {
		const gate = new SameDesignGate();
		const answer = gate.request(browserOnly('a'));
		expect(gate.pending?.incomingName).toBe('a');
		gate.answer({ action: 'replace' });
		expect(await answer).toEqual({ action: 'replace' });
		expect(gate.pending).toBeNull();
	});

	it('cancels an unanswered question when a newer one arrives', async () => {
		const gate = new SameDesignGate();
		const first = gate.request(browserOnly('a'));
		const second = gate.request(browserOnly('b'));
		expect(await first).toEqual({ action: 'cancel' });
		expect(gate.pending?.incomingName).toBe('b');
		gate.answer({ action: 'copy' });
		expect(await second).toEqual({ action: 'copy' });
	});

	it('passes a named copy for another repo file', async () => {
		const gate = new SameDesignGate();
		const answer = gate.request(otherRepoFile('a'));
		gate.answer({ action: 'copy', name: 'a v2' });
		expect(await answer).toEqual({ action: 'copy', name: 'a v2' });
	});

	it('treats Replace, or a copy without a name, as Cancel for another repo file', async () => {
		const gate = new SameDesignGate();
		const replace = gate.request(otherRepoFile('a'));
		gate.answer({ action: 'replace' });
		expect(await replace).toEqual({ action: 'cancel' });

		const unnamed = gate.request(otherRepoFile('a'));
		gate.answer({ action: 'copy', name: '  ' });
		expect(await unnamed).toEqual({ action: 'cancel' });
	});
});
