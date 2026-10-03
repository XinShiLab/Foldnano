<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import BookOpen from '@lucide/svelte/icons/book-open';
	import Code2 from '@lucide/svelte/icons/code-2';
	import GitPullRequest from '@lucide/svelte/icons/git-pull-request';
	import Moon from '@lucide/svelte/icons/moon';
	import Sun from '@lucide/svelte/icons/sun';
	import { mode, toggleMode } from 'mode-watcher';
	import type { Snippet } from 'svelte';

	import AlphaAccessGate from '$lib/components/AlphaAccessGate.svelte';
	import fn from '$lib/assets/fn.svg';

	import type { LayoutData } from './$types';

	const {
		data,
		children,
	}: { data: LayoutData & { alphaAccessGranted: boolean }; children: Snippet } = $props();

	const guideNav = $derived(data.nav.filter((n) => n.category === 'guide'));
	const pluginNav = $derived(data.nav.filter((n) => n.category === 'plugin-development'));
	const contributorNav = $derived(data.nav.filter((n) => n.category === 'contributors'));
	const activeCategory = $derived<'guide' | 'plugin-development' | 'contributors'>(
		page.url.pathname.includes('/docs/plugin-development')
			? 'plugin-development'
			: page.url.pathname.includes('/docs/contributors')
				? 'contributors'
				: 'guide'
	);
	const sidebarNav = $derived(
		activeCategory === 'guide'
			? guideNav
			: activeCategory === 'plugin-development'
				? pluginNav
				: contributorNav
	);
</script>

<AlphaAccessGate
	granted={data.alphaAccessGranted}
	title="Documentation Preview"
	description="Foldnano documentation is currently available only to beta testers."
>
	<div data-stable-gutter class="flex min-h-screen flex-col bg-background text-foreground">
		<header
			class="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur print:static"
		>
			<div class="mx-auto flex h-14 max-w-screen-xl items-center gap-4 px-4">
				<a href={resolve('/docs')} class="flex items-center gap-2 text-sm font-semibold">
					<img src={fn} alt="" class="size-5" />
					Foldnano Docs
				</a>

				<nav class="flex items-center gap-1 print:hidden">
					<a
						href={resolve('/docs/guide/getting-started')}
						class="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm transition-colors {activeCategory ===
						'guide'
							? 'bg-accent text-accent-foreground'
							: 'text-muted-foreground hover:text-foreground'}"
					>
						<BookOpen size={14} />User Guide
					</a>
					<a
						href={resolve('/docs/plugin-development/plugin-quickstart')}
						class="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm transition-colors {activeCategory ===
						'plugin-development'
							? 'bg-accent text-accent-foreground'
							: 'text-muted-foreground hover:text-foreground'}"
					>
						<Code2 size={14} />Plugin Development
					</a>
					<a
						href={resolve('/docs/contributors/contributor-overview')}
						class="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm transition-colors {activeCategory ===
						'contributors'
							? 'bg-accent text-accent-foreground'
							: 'text-muted-foreground hover:text-foreground'}"
					>
						<GitPullRequest size={14} />Contributors
					</a>
				</nav>

				<div class="ml-auto flex items-center gap-2 print:hidden">
					<a
						href={resolve('/editor')}
						class="rounded border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
					>
						Open App
					</a>
					<button
						onclick={toggleMode}
						aria-label="Toggle dark mode"
						class="flex size-8 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
					>
						{#if mode.current === 'dark'}
							<Sun size={16} />
						{:else}
							<Moon size={16} />
						{/if}
					</button>
				</div>
			</div>
		</header>

		<div class="mx-auto flex w-full max-w-7xl flex-1 px-4 print:block print:max-w-none print:px-0">
			<aside class="hidden w-56 shrink-0 py-8 pr-6 md:block print:hidden">
				<nav class="sticky top-22">
					<ul class="space-y-0.5">
						{#each sidebarNav as item (item.slug)}
							<li>
								<a
									href={resolve(`/docs/${item.category}/${item.slug}`)}
									class="block rounded px-3 py-1.5 text-sm transition-colors {page.url.pathname.endsWith(
										item.slug
									)
										? 'bg-accent font-medium text-accent-foreground'
										: 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'}"
								>
									{item.title}
								</a>
							</li>
						{/each}
					</ul>
				</nav>
			</aside>

			<main class="min-w-0 flex-1 border-l border-border pl-8 print:border-0 print:pl-0">
				{@render children()}
			</main>
		</div>
	</div>
</AlphaAccessGate>
