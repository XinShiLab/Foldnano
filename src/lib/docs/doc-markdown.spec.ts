import { describe, expect, it } from 'vitest';

import { absolutizeLinks, splitDocSections, toAgentMarkdown } from './doc-markdown';

const PAGE = { category: 'guide', slug: 'demo', title: 'Demo Page' } as const;

const RAW = `---
title: Demo Page
order: 1
---

<script>
	import Callout from '$lib/components/docs/Callout.svelte';
</script>

# Demo Page

Intro with a [link](/docs/guide/other) and ![shot](/screenshots/a.webp).

## Using \`foldnano_mini\` **today**

Body text.

<Callout type="tip" title="Keep it short">

First line.

\`\`\`python
# not a heading
<Widget />
\`\`\`

</Callout>

<Diagram />

### Details

#### Deep note

More.

## Details
`;

describe('toAgentMarkdown', () => {
	const md = toAgentMarkdown(RAW, 'https://fn.test', PAGE);

	it('drops front matter and the script block and names the source page', () => {
		expect(md).not.toContain('order: 1');
		expect(md).not.toContain('import Callout');
		expect(md.startsWith('<!-- Source: https://fn.test/docs/guide/demo -->\n\n# Demo Page')).toBe(
			true
		);
	});

	it('turns callouts into blockquotes, keeping fenced code inside them intact', () => {
		expect(md).toContain(
			'> **Tip: Keep it short**\n>\n> First line.\n>\n> ```python\n> # not a heading\n> <Widget />\n> ```'
		);
		expect(md).not.toContain('Callout');
	});

	it('drops component lines outside code fences', () => {
		expect(md).not.toContain('<Diagram />');
	});

	it('makes site-relative links absolute', () => {
		expect(md).toContain('[link](https://fn.test/docs/guide/other)');
		expect(md).toContain('![shot](https://fn.test/screenshots/a.webp)');
	});
});

describe('absolutizeLinks', () => {
	it('leaves external, protocol-relative and anchor links alone', () => {
		const md = '[a](https://x.org) [b](//cdn.x) [c](#here)';
		expect(absolutizeLinks(md, 'https://fn.test')).toBe(md);
	});
});

describe('splitDocSections', () => {
	const sections = splitDocSections(RAW, PAGE);

	it('splits at ## and ### with rehype-slug style anchors, deduplicated in order', () => {
		expect(sections.map((s) => [s.href, s.heading])).toEqual([
			['/docs/guide/demo', 'Demo Page'],
			['/docs/guide/demo#using-foldnano_mini-today', 'Using foldnano_mini today'],
			['/docs/guide/demo#details', 'Details'],
			['/docs/guide/demo#details-1', 'Details'],
		]);
	});

	it('indexes plain text, including code and deeper headings, without markup', () => {
		expect(sections[0].text).toBe('Intro with a link and shot.');
		expect(sections[1].text).toContain('First line. # not a heading <Widget />');
		expect(sections[2].text).toBe('Deep note More.');
	});
});
