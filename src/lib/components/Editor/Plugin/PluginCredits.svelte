<script lang="ts">
	import type { PluginManifest, PluginPerson } from '$lib/plugin/types';
	import { ExternalLink } from '@lucide/svelte';

	const {
		manifest,
	}: {
		manifest: Pick<
			PluginManifest,
			'authors' | 'maintainers' | 'license' | 'repository' | 'upstream'
		>;
	} = $props();

	const links = $derived(
		[
			{ label: 'Source', href: manifest.repository },
			{ label: 'Upstream', href: manifest.upstream },
		].filter((l): l is { label: string; href: string } => !!l.href)
	);
	const hasCredits = $derived(
		!!manifest.authors?.length ||
			!!manifest.maintainers?.length ||
			!!manifest.license ||
			links.length > 0
	);
</script>

<!-- URLs are https-only (validateManifest), so these links can't carry another scheme. -->
<!-- eslint-disable svelte/no-navigation-without-resolve -->
{#snippet people(list: PluginPerson[])}
	{#each list as person, i (i)}
		{#if i > 0},
		{/if}
		{#if person.url}
			<a
				href={person.url}
				target="_blank"
				rel="noopener noreferrer"
				class="text-foreground hover:underline">{person.name}</a
			>
		{:else}
			<span class="text-foreground">{person.name}</span>
		{/if}
	{/each}
{/snippet}

{#if hasCredits}
	<div class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
		{#if manifest.authors?.length}
			<span>by {@render people(manifest.authors)}</span>
		{/if}
		{#if manifest.maintainers?.length}
			<span
				>{manifest.authors?.length ? '· ' : ''}plugin by {@render people(
					manifest.maintainers
				)}</span
			>
		{/if}
		{#if manifest.license}
			<span
				>{manifest.authors?.length || manifest.maintainers?.length
					? '· '
					: ''}{manifest.license}</span
			>
		{/if}
		{#each links as link (link.label)}
			<a
				href={link.href}
				target="_blank"
				rel="noopener noreferrer"
				title={link.href}
				class="inline-flex items-center gap-0.5 text-blue-600 hover:underline dark:text-blue-400"
			>
				{link.label}
				<ExternalLink size={10} />
			</a>
		{/each}
	</div>
{/if}
<!-- eslint-enable svelte/no-navigation-without-resolve -->
