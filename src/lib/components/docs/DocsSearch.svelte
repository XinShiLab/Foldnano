<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import FileText from '@lucide/svelte/icons/file-text';
	import Hash from '@lucide/svelte/icons/hash';
	import Search from '@lucide/svelte/icons/search';

	import * as Command from '$lib/components/ui/command';
	import { Kbd } from '$lib/components/ui/kbd';
	import {
		DOC_CATEGORY_LABELS,
		DocSearch,
		highlightSnippet,
		type DocCategory,
		type DocSearchHit,
		type DocSearchSection,
	} from '$lib/docs/doc-search';

	const { currentCategory }: { currentCategory: DocCategory } = $props();

	let open = $state(false);
	let query = $state('');
	let index = $state.raw<DocSearch | null>(null);
	let loadError = $state<string | null>(null);
	let loading: Promise<void> | null = null;
	let pendingHref: string | null = null;

	const hits = $derived<DocSearchHit[]>(index ? index.search(query, currentCategory) : []);
	const isMac = $derived(
		typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
	);

	function loadIndex(): Promise<void> {
		loading ??= fetch(resolve('/docs/search-index.json'))
			.then((res) => {
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				return res.json() as Promise<DocSearchSection[]>;
			})
			.then((sections) => {
				index = new DocSearch(sections);
			})
			.catch((err: unknown) => {
				loading = null;
				loadError = err instanceof Error ? err.message : String(err);
			});
		return loading;
	}

	function openSearch() {
		loadError = null;
		query = '';
		open = true;
		void loadIndex();
	}

	function select(section: DocSearchSection) {
		const [path, anchor] = section.href.split('#');
		const [, , category, slug] = path.split('/');
		pendingHref = resolve(`/docs/${category}/${slug}`) + (anchor ? `#${anchor}` : '');
		open = false;
	}

	// Navigate once the dialog has closed: its scroll lock would otherwise undo the jump to the anchor.
	function onOpenChangeComplete(isOpen: boolean) {
		if (isOpen || !pendingHref) return;
		const href = pendingHref;
		pendingHref = null;
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- built with resolve() in select()
		void goto(href);
	}

	function onWindowKeydown(e: KeyboardEvent) {
		const target = e.target as HTMLElement | null;
		const typing = !!target?.closest('input, textarea, select, [contenteditable="true"]');
		if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing && !open)) {
			e.preventDefault();
			if (open) open = false;
			else openSearch();
		}
	}
</script>

<svelte:window onkeydown={onWindowKeydown} />

<button
	type="button"
	onclick={openSearch}
	onpointerenter={() => void loadIndex()}
	class="flex h-8 w-full max-w-64 items-center gap-2 rounded border border-border bg-muted/40 px-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
>
	<Search size={14} />
	<span class="flex-1 text-left">Search docs…</span>
	<Kbd class="hidden sm:inline-flex">{isMac ? '⌘' : 'Ctrl'} K</Kbd>
</button>

<Command.Dialog
	bind:open
	{onOpenChangeComplete}
	shouldFilter={false}
	title="Search documentation"
	description="Search the Foldnano user guide, plugin docs and contributor docs"
	class="sm:max-w-xl"
>
	<Command.Input bind:value={query} placeholder="Search the docs…" />
	<Command.List class="max-h-[min(28rem,60vh)]">
		{#if loadError}
			<div class="px-3 py-6 text-center text-xs text-destructive">
				Could not load the search index ({loadError}).
			</div>
		{:else if !index}
			<Command.Loading>
				<div class="px-3 py-6 text-center text-xs text-muted-foreground">Loading…</div>
			</Command.Loading>
		{:else if query.trim() === ''}
			<div class="px-3 py-6 text-center text-xs text-muted-foreground">
				Type to search every page and section.
			</div>
		{:else if hits.length === 0}
			<div class="px-3 py-6 text-center text-xs text-muted-foreground">
				No results for “{query.trim()}”.
			</div>
		{:else}
			{#each hits as hit (hit.section.id)}
				{@const section = hit.section}
				{@const isPage = !section.href.includes('#')}
				<Command.Item
					value={section.id}
					onSelect={() => select(section)}
					class="items-start gap-2.5"
				>
					{#if isPage}
						<FileText class="mt-0.5 text-muted-foreground" />
					{:else}
						<Hash class="mt-0.5 text-muted-foreground" />
					{/if}
					<div class="min-w-0 flex-1">
						<div class="truncate text-[11px] text-muted-foreground">
							{DOC_CATEGORY_LABELS[section.category]}{isPage ? '' : ` › ${section.pageTitle}`}
						</div>
						<div class="truncate text-sm font-medium text-foreground">{section.heading}</div>
						{#if section.text}
							<div class="line-clamp-2 text-xs text-muted-foreground">
								{#each highlightSnippet(section.text, hit.terms) as part, i (i)}
									{#if part.match}<mark class="rounded-sm bg-primary/20 text-foreground"
											>{part.text}</mark
										>{:else}{part.text}{/if}
								{/each}
							</div>
						{/if}
					</div>
				</Command.Item>
			{/each}
		{/if}
	</Command.List>
</Command.Dialog>
