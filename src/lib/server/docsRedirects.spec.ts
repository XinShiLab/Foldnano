import { describe, expect, it } from 'vitest';

import { llmsTextRedirectPath } from './docsRedirects';

describe('llmsTextRedirectPath', () => {
	it.each([
		['/docs/llms.txt', '/llms.txt'],
		['/docs/llm.txt', '/llms.txt'],
		['/llm.txt', '/llms.txt'],
		['/llms.txt/', '/llms.txt'],
		['/docs/llms-full.txt', '/llms-full.txt'],
		['/docs/llm-full.txt', '/llms-full.txt'],
		['/llm-full.txt', '/llms-full.txt'],
		['/docs/guide/llm.txt', '/docs/guide/llms.txt'],
		['/docs/plugin-development/llms-full.txt', '/docs/plugin-development/llms.txt'],
		['/docs/contributors/llms.txt/', '/docs/contributors/llms.txt'],
	])('redirects %s to %s', (from, to) => {
		expect(llmsTextRedirectPath(from)).toBe(to);
	});

	it.each([
		'/llms.txt',
		'/llms-full.txt',
		'/docs/guide/llms.txt',
		'/docs/guide/getting-started',
		'/docs/unknown/llms.txt',
	])('leaves %s alone', (path) => {
		expect(llmsTextRedirectPath(path)).toBeNull();
	});
});
