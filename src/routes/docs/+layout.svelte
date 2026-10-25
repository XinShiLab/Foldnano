<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import BookOpen from '@lucide/svelte/icons/book-open';
	import Code2 from '@lucide/svelte/icons/code-2';
	import GitPullRequest from '@lucide/svelte/icons/git-pull-request';
	import Menu from '@lucide/svelte/icons/menu';
	import Moon from '@lucide/svelte/icons/moon';
	import Sun from '@lucide/svelte/icons/sun';
	import X from '@lucide/svelte/icons/x';
	import { mode, toggleMode } from 'mode-watcher';
	import type { Snippet } from 'svelte';

	import AlphaAccessGate from '$lib/components/AlphaAccessGate.svelte';
	import DocsSearch from '$lib/components/docs/DocsSearch.svelte';
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

	const categories = [
		{
			id: 'guide',
			label: 'User Guide',
			icon: BookOpen,
			href: resolve('/docs/guide/getting-started'),
		},
		{
			id: 'plugin-development',
			label: 'Plugin Development',
			icon: Code2,
			href: resolve('/docs/plugin-development/plugin-quickstart'),
		},
		{
			id: 'contributors',
			label: 'Contributors',
			icon: GitPullRequest,
			href: resolve('/docs/contributors/contributor-overview'),
		},
	] as const;

	// Below lg this panel holds the header tabs; below md, the sidebar page list too.
	let mobileNavOpen = $state(false);
	afterNavigate(() => (mobileNavOpen = false));
</script>

{#snippet pageLinks()}
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
{/snippet}

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
				<button
					onclick={() => (mobileNavOpen = !mobileNavOpen)}
					aria-label={mobileNavOpen ? 'Close navigation' : 'Open navigation'}
					aria-expanded={mobileNavOpen}
					aria-controls="docs-mobile-nav"
					class="-ml-1 flex size-8 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground lg:hidden print:hidden"
				>
					{#if mobileNavOpen}
						<X size={18} />
					{:else}
						<Menu size={18} />
					{/if}
				</button>
				<a
					href={resolve('/docs')}
					class="flex shrink-0 items-center gap-2 text-sm font-semibold whitespace-nowrap"
				>
					<img src={fn} alt="" class="size-5" />
					<span class="hidden min-[400px]:inline">Foldnano Docs</span>
				</a>

				<nav class="hidden items-center gap-1 lg:flex print:hidden">
					{#each categories as c (c.id)}
						{@const Icon = c.icon}
						<a
							href={c.href}
							class="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm whitespace-nowrap transition-colors {activeCategory ===
							c.id
								? 'bg-accent text-accent-foreground'
								: 'text-muted-foreground hover:text-foreground'}"
						>
							<Icon size={14} />{c.label}
						</a>
					{/each}
				</nav>

				<div class="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2 print:hidden">
					<DocsSearch currentCategory={activeCategory} />
					<a
						href={resolve('/editor')}
						class="hidden rounded border border-border px-3 py-1.5 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground sm:block"
					>
						Open App
					</a>
					<button
						onclick={toggleMode}
						aria-label="Toggle dark mode"
						class="flex size-8 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
					>
						{#if mode.current === 'dark'}
							<Sun size={16} />
						{:else}
							<Moon size={16} />
						{/if}
					</button>
				</div>
			</div>

			{#if mobileNavOpen}
				<nav
					id="docs-mobile-nav"
					class="max-h-[calc(100dvh-3.5rem)] overflow-y-auto border-t border-border px-4 pt-3 pb-5 lg:hidden print:hidden"
				>
					<div class="grid gap-1">
						{#each categories as c (c.id)}
							{@const Icon = c.icon}
							<a
								href={c.href}
								class="inline-flex items-center gap-2 rounded px-3 py-2 text-sm transition-colors {activeCategory ===
								c.id
									? 'bg-accent font-medium text-accent-foreground'
									: 'text-muted-foreground hover:text-foreground'}"
							>
								<Icon size={14} />{c.label}
							</a>
						{/each}
						<a
							href={resolve('/editor')}
							class="rounded px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground sm:hidden"
						>
							Open App
						</a>
					</div>
					<div class="mt-3 border-t border-border pt-3 md:hidden">
						{@render pageLinks()}
					</div>
				</nav>
			{/if}
		</header>

		<div class="mx-auto flex w-full max-w-7xl flex-1 px-4 print:block print:max-w-none print:px-0">
			<aside class="hidden w-56 shrink-0 py-8 pr-6 md:block print:hidden">
				<nav class="sticky top-22">
					{@render pageLinks()}
				</nav>
			</aside>

			<main class="min-w-0 flex-1 md:border-l md:border-border md:pl-8 print:border-0 print:pl-0">
				{@render children()}
			</main>
		</div>
	</div>
</AlphaAccessGate>
