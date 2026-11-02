/**
 * Manifest `tags`: display-only labels, compared ignoring case. Shared by every plugin list
 * that shows or filters tags (Hub sections today). See docs/python-plugin-system.md § Plugin tags.
 */

import type { PluginManifest } from './types';

/** Shipped examples carry this tag, so the Hub can hide them as a group. */
export const DEMO_TAG = 'Demo';

/** Tags compare ignoring case, so "Demo" and "demo" are the same tag. */
export function tagKey(tag: string): string {
	return tag.toLowerCase();
}

export function hasTag(manifest: Pick<PluginManifest, 'tags'>, tag: string): boolean {
	const key = tagKey(tag);
	return manifest.tags?.some((t) => tagKey(t) === key) ?? false;
}

export interface TagCount {
	/** Comparison key (`tagKey`). */
	key: string;
	/** Spelling from the first manifest that uses the tag. */
	label: string;
	count: number;
}

/** Every tag across `manifests` with how many use it, sorted by label ignoring case. */
export function countTags(manifests: readonly Pick<PluginManifest, 'tags'>[]): TagCount[] {
	const counts = new Map<string, TagCount>();
	for (const manifest of manifests) {
		for (const tag of manifest.tags ?? []) {
			const key = tagKey(tag);
			const entry = counts.get(key);
			if (entry) entry.count++;
			else counts.set(key, { key, label: tag, count: 1 });
		}
	}
	return [...counts.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export interface TagFilter {
	/** Tag keys to keep; a plugin matching any of them stays. Empty keeps everything. */
	selected: ReadonlySet<string>;
	/** False hides every plugin tagged `DEMO_TAG`, whatever is selected. */
	showDemos: boolean;
}

export function filterByTags<T extends Pick<PluginManifest, 'tags'>>(
	manifests: readonly T[],
	{ selected, showDemos }: TagFilter
): T[] {
	return manifests.filter(
		(m) =>
			(showDemos || !hasTag(m, DEMO_TAG)) &&
			(selected.size === 0 || (m.tags ?? []).some((t) => selected.has(tagKey(t))))
	);
}
