import GithubSlugger from 'github-slugger';

import type { DocCategory, DocSearchSection } from './doc-search';

const CALLOUT_LABELS: Record<string, string> = {
	tip: 'Tip',
	note: 'Note',
	warning: 'Warning',
	limit: 'Current limitation',
};

const FRONT_MATTER = /^---\n[\s\S]*?\n---\n/;
const INSTANCE_SCRIPT = /^<script\b[^>]*>[\s\S]*?^<\/script>\n?/m;
const FENCE = /^\s*(`{3,}|~{3,})/;
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const CALLOUT_OPEN = /^<Callout\b([^>]*)>\s*$/;
const CALLOUT_CLOSE = /^<\/Callout>\s*$/;
const COMPONENT_LINE = /^\s*<\/?[A-Z][\w.]*\b[^>]*>\s*$/;

export interface DocPageRef {
	category: DocCategory;
	slug: string;
	title: string;
}

/** Site path of a doc page, e.g. `/docs/guide/getting-started`. */
export function docHref(page: Pick<DocPageRef, 'category' | 'slug'>): string {
	return `/docs/${page.category}/${page.slug}`;
}

function attr(attrs: string, name: string): string | undefined {
	return new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1];
}

/** Calls `fn` for each line with whether it sits inside a fenced code block (fence lines count as inside). */
function eachLine(markdown: string, fn: (line: string, inFence: boolean) => void): void {
	let fence: string | null = null;
	for (const line of markdown.split('\n')) {
		const marker = FENCE.exec(line)?.[1];
		if (fence === null && marker) {
			fence = marker;
			fn(line, true);
		} else if (fence !== null) {
			fn(line, true);
			if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
		} else {
			fn(line, false);
		}
	}
}

/** Strips the mdsvex front matter and instance `<script>`, leaving the page body. */
export function docBody(raw: string): string {
	return raw.replace(FRONT_MATTER, '').replace(INSTANCE_SCRIPT, '').replace(/^\s+/, '');
}

/**
 * Plain markdown for AI agents: no front matter or Svelte script, `<Callout>` blocks become
 * blockquotes, interactive components are dropped, and site-relative links become absolute.
 */
export function toAgentMarkdown(raw: string, origin: string, page: DocPageRef): string {
	const out: string[] = [];
	let inCallout = false;
	eachLine(docBody(raw), (line, inFence) => {
		if (!inFence) {
			const open = CALLOUT_OPEN.exec(line);
			if (open) {
				const label = CALLOUT_LABELS[attr(open[1], 'type') ?? 'note'] ?? 'Note';
				const title = attr(open[1], 'title');
				out.push(`> **${title ? `${label}: ${title}` : label}**`);
				inCallout = true;
				return;
			}
			if (CALLOUT_CLOSE.test(line)) {
				inCallout = false;
				return;
			}
			if (COMPONENT_LINE.test(line)) return;
			line = absolutizeLinks(line, origin);
		}
		out.push(inCallout ? (line ? `> ${line}` : '>') : line);
	});
	const body = out
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
	return `<!-- Source: ${origin}${docHref(page)} -->\n\n${body}\n`;
}

/** Rewrites markdown links and images that point at site paths (`](/...)`) to absolute URLs. */
export function absolutizeLinks(markdown: string, origin: string): string {
	return markdown.replace(/\]\(\/(?!\/)/g, `](${origin}/`);
}

/** Heading text as rehype-slug sees it (rendered text content, no markdown syntax). */
function headingText(source: string): string {
	return source
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/`([^`]*)`/g, '$1')
		.replace(/\*\*|__/g, '')
		.replace(/(^|\W)[*_]([^*_]+)[*_](?=\W|$)/g, '$1$2')
		.replace(/\\(.)/g, '$1');
}

function plainText(line: string): string {
	return line
		.replace(/<!--.*?-->/g, ' ')
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/`+/g, '')
		.replace(/\*\*|__/g, '')
		.replace(/^\s*(?:[-*+]|\d+\.|>)\s+/, '')
		.replace(/^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/, '')
		.replace(/\|/g, ' ');
}

/**
 * Splits a doc page into searchable sections at `##` and `###` headings. Anchors are computed
 * with github-slugger over every heading in document order, matching rehype-slug's ids.
 */
export function splitDocSections(raw: string, page: DocPageRef): DocSearchSection[] {
	const slugger = new GithubSlugger();
	const href = docHref(page);
	const sections: DocSearchSection[] = [];
	let current = { href, heading: page.title, lines: [] as string[] };
	const flush = () => {
		const text = current.lines.join(' ').replace(/\s+/g, ' ').trim();
		if (text || current.href !== href) {
			sections.push({
				id: current.href,
				href: current.href,
				category: page.category,
				pageTitle: page.title,
				heading: current.heading,
				text,
			});
		}
	};

	eachLine(docBody(raw), (line, inFence) => {
		if (inFence) {
			if (!FENCE.test(line)) current.lines.push(line);
			return;
		}
		if (CALLOUT_OPEN.test(line) || CALLOUT_CLOSE.test(line) || COMPONENT_LINE.test(line)) return;
		const heading = HEADING.exec(line);
		if (!heading) {
			current.lines.push(plainText(line));
			return;
		}
		const text = headingText(heading[2]);
		const anchor = slugger.slug(text);
		if (heading[1].length === 2 || heading[1].length === 3) {
			flush();
			current = { href: `${href}#${anchor}`, heading: text, lines: [] };
		} else if (heading[1].length > 3) {
			current.lines.push(text);
		}
	});
	flush();
	return sections;
}
