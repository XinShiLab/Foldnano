import type { BeforeSendEvent } from '@vercel/analytics/sveltekit';

// Routes whose dynamic segment identifies a user's document; analytics sees only the pattern.
const DOCUMENT_ROUTES: readonly [RegExp, string][] = [
	[/^\/editor\/[^/]+/, '/editor/[docId]'],
	[/^\/oligos\/(?!diff(?:\/|$))[^/]+/, '/oligos/[docId]'],
];

export function redactAnalyticsUrl(rawUrl: string): string {
	const url = new URL(rawUrl);
	let path = url.pathname;
	for (const [pattern, replacement] of DOCUMENT_ROUTES) {
		path = path.replace(pattern, replacement);
	}
	return `${url.origin}${path}`;
}

export function redactAnalyticsEvent(event: BeforeSendEvent): BeforeSendEvent {
	return { ...event, url: redactAnalyticsUrl(event.url) };
}
