import { describe, expect, it } from 'vitest';

import { redactAnalyticsEvent, redactAnalyticsUrl } from './analytics';

describe('redactAnalyticsUrl', () => {
	it('replaces editor document ids with the route pattern', () => {
		expect(redactAnalyticsUrl('https://foldnano.example/editor/abc-123')).toBe(
			'https://foldnano.example/editor/[docId]'
		);
	});

	it('replaces oligo report document ids but keeps the diff route', () => {
		expect(redactAnalyticsUrl('https://foldnano.example/oligos/abc-123')).toBe(
			'https://foldnano.example/oligos/[docId]'
		);
		expect(redactAnalyticsUrl('https://foldnano.example/oligos/diff?left=a&right=b')).toBe(
			'https://foldnano.example/oligos/diff'
		);
	});

	it('drops query strings and fragments everywhere', () => {
		expect(redactAnalyticsUrl('https://foldnano.example/editor?url=https://x.org/d.json#top')).toBe(
			'https://foldnano.example/editor'
		);
	});

	it('leaves non-document routes intact', () => {
		expect(redactAnalyticsUrl('https://foldnano.example/docs/guide/saving-github')).toBe(
			'https://foldnano.example/docs/guide/saving-github'
		);
	});
});

describe('redactAnalyticsEvent', () => {
	it('keeps the event type', () => {
		expect(
			redactAnalyticsEvent({ type: 'pageview', url: 'https://foldnano.example/editor/abc' })
		).toEqual({ type: 'pageview', url: 'https://foldnano.example/editor/[docId]' });
	});
});
