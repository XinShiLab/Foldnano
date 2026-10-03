import type { PageLoad, EntryGenerator } from './$types';
import type { Component } from 'svelte';
import { error } from '@sveltejs/kit';

const eagerModules = import.meta.glob('/src/content/**/*.md', { eager: true }) as Record<
	string,
	{ metadata: Record<string, unknown> }
>;

const lazyModules = import.meta.glob('/src/content/**/*.md') as Record<
	string,
	() => Promise<{ default: Component; metadata: Record<string, unknown> }>
>;

function pathToSlug(path: string, metadata?: Record<string, unknown>): string {
	const parts = path.replace('/src/content/', '').split('/');
	const category = parts[0];
	const slug =
		(metadata?.slug as string | undefined) ?? parts[1].replace('.md', '').replace(/^\d+-/, '');
	return `${category}/${slug}`;
}

export const entries: EntryGenerator = async () =>
	Object.entries(eagerModules).map(([path, mod]) => ({
		slug: pathToSlug(path, mod.metadata),
	}));

export const load: PageLoad = async ({ params }) => {
	const match = Object.entries(lazyModules).find(
		([path]) => pathToSlug(path, eagerModules[path]?.metadata) === params.slug
	);

	if (!match) {
		throw error(404, `Documentation page not found: ${params.slug}`);
	}

	const mod = await match[1]();

	return {
		content: mod.default,
		title: mod.metadata.title as string,
		description: mod.metadata.description as string,
	};
};
