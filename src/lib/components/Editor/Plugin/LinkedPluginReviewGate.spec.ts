import { describe, expect, it } from 'vitest';
import { LinkedPluginReviewGate } from './LinkedPluginReviewGate.svelte';
import type { LinkedPluginReview } from '$lib/plugin/PluginDevMode.svelte';

const review = (name: string): LinkedPluginReview => ({
	kind: 'link',
	folderName: name,
	manifest: { id: `dev.${name}`, name } as LinkedPluginReview['manifest'],
	previous: null,
});

describe('LinkedPluginReviewGate', () => {
	it('resolves with the answer and clears the question', async () => {
		const gate = new LinkedPluginReviewGate();
		const answer = gate.request(review('a'));
		expect(gate.pending?.folderName).toBe('a');
		gate.accept();
		expect(await answer).toBe(true);
		expect(gate.pending).toBeNull();
	});

	it('declines an unanswered question when a newer one arrives', async () => {
		const gate = new LinkedPluginReviewGate();
		const first = gate.request(review('a'));
		const second = gate.request(review('b'));
		expect(await first).toBe(false);
		expect(gate.pending?.folderName).toBe('b');
		gate.decline();
		expect(await second).toBe(false);
	});
});
