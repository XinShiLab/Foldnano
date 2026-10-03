<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import * as Select from '$lib/components/ui/select';
	import * as ToggleGroup from '$lib/components/ui/toggle-group';
	import {
		StorageManager,
		IndexedDbStorageProvider,
		githubExplorerStateStore,
		type DocumentMetadata,
	} from '$lib/services/storage';
	import { githubMetadataStore, type GitHubFileMetadata } from '$lib/services/storage';
	import {
		FilePlus,
		FileSpreadsheet,
		LayoutList,
		Rows3,
		SquareArrowOutUpRight,
		Trash2,
	} from '@lucide/svelte';
	import { onMount } from 'svelte';

	const SORT_OPTIONS = {
		'modified-desc': 'Last modified (newest)',
		'modified-asc': 'Last modified (oldest)',
		'name-asc': 'Name (A–Z)',
		'name-desc': 'Name (Z–A)',
	} as const;
	type SortKey = keyof typeof SORT_OPTIONS;
	type SourceFilter = 'all' | 'local' | 'github';
	type ViewMode = 'cards' | 'compact';

	const DEFAULT_SORT: SortKey = 'modified-desc';
	const DEFAULT_SOURCE: SourceFilter = 'all';
	const DEFAULT_VIEW: ViewMode = 'cards';
	const UNTITLED = 'Untitled Document';

	let documents = $state<DocumentMetadata[]>([]);
	let githubMeta = $state<Record<string, GitHubFileMetadata>>({});

	function readParam<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
		const value = page.url.searchParams.get(key);
		return allowed.find((a) => a === value) ?? fallback;
	}

	const sortKey = $derived(readParam('sort', Object.keys(SORT_OPTIONS) as SortKey[], DEFAULT_SORT));
	const sourceFilter = $derived(
		readParam<SourceFilter>('source', ['all', 'local', 'github'], DEFAULT_SOURCE)
	);
	const viewMode = $derived(readParam<ViewMode>('view', ['cards', 'compact'], DEFAULT_VIEW));

	// Defaults are dropped from the URL so a plain /toc stays clean.
	function setParam(key: string, value: string, fallback: string) {
		const url = new URL(page.url);
		if (value === fallback) url.searchParams.delete(key);
		else url.searchParams.set(key, value);
		// Same-page query update; the path comes from the current (already resolved) URL.
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(url, { replaceState: true, keepFocus: true, noScroll: true });
	}

	const nameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
	const byName = (a: DocumentMetadata, b: DocumentMetadata) =>
		nameCollator.compare(a.name || UNTITLED, b.name || UNTITLED);

	const visibleDocuments = $derived.by(() => {
		const filtered =
			sourceFilter === 'all'
				? [...documents]
				: documents.filter((doc) => (sourceFilter === 'github') === doc.id in githubMeta);
		switch (sortKey) {
			case 'modified-desc':
				return filtered.sort((a, b) => b.lastModified - a.lastModified);
			case 'modified-asc':
				return filtered.sort((a, b) => a.lastModified - b.lastModified);
			case 'name-asc':
				return filtered.sort(byName);
			case 'name-desc':
				return filtered.sort((a, b) => byName(b, a));
		}
	});

	// Initialize storage manager
	const storageManager = new StorageManager('indexedDB');
	storageManager.registerProvider('indexedDB', new IndexedDbStorageProvider());

	async function loadDocuments() {
		if (browser) {
			documents = await storageManager.getDocumentList();
			// Collect any GitHub metadata for each document
			const meta: Record<string, GitHubFileMetadata> = {};
			for (const doc of documents) {
				const m = githubMetadataStore.getFileMetadata(doc.id);
				if (m) meta[doc.id] = m;
			}
			githubMeta = meta;
		}
	}

	onMount(async () => {
		await Promise.all([githubMetadataStore.hydrate(), githubExplorerStateStore.hydrate()]);
		await loadDocuments();
	});

	async function handleDelete(docId: string, docName: string) {
		if (confirm(`Delete "${docName}"?`)) {
			// Deleting the document also deletes its backups.
			await storageManager.deleteDocument(docId);
			// Always clear both sides: a doc may have started as local-only and later been synced
			// to GitHub, leaving entries in both stores.
			githubMetadataStore.clearFileMetadata(docId);
			githubExplorerStateStore.removeLocalOnlyEntryByDocId(docId);
			await loadDocuments();
		}
	}

	function formatDate(timestamp: number): string {
		return new Date(timestamp).toLocaleString();
	}

	function githubPath(meta: GitHubFileMetadata): string {
		return `${meta.owner}/${meta.repo}:${meta.branch}/${meta.path}`;
	}
</script>

{#snippet githubIcon()}
	<svg
		width="12"
		height="12"
		viewBox="0 0 24 24"
		fill="currentColor"
		aria-hidden="true"
		class="shrink-0"
		><path
			d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"
		/></svg
	>
{/snippet}

<svelte:head>
	<title>Saved Documents - Foldnano</title>
</svelte:head>

<main data-stable-gutter class="min-h-dvh bg-background text-foreground">
	<div class="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">
		<header
			class="flex flex-col gap-4 border-b border-border pb-5 md:flex-row md:items-end md:justify-between"
		>
			<div>
				<p class="text-xs font-medium text-muted-foreground uppercase">Foldnano</p>
				<h1 class="text-2xl font-semibold">Saved Documents</h1>
			</div>
			<div class="flex gap-2">
				<Button onclick={() => goto(resolve('/editor'))}>
					<FilePlus class="size-4" />
					New Document
				</Button>
			</div>
		</header>

		{#if documents.length === 0}
			<div class="border border-border p-8 text-center">
				<p class="text-sm font-medium">No saved documents</p>
				<p class="mt-1 text-sm text-muted-foreground">
					Documents are automatically saved to your browser as you edit.
				</p>
				<div class="mt-4 flex justify-center">
					<Button onclick={() => goto(resolve('/editor'))}>
						<FilePlus class="size-4" />
						Create Your First Document
					</Button>
				</div>
			</div>
		{:else}
			<section class="grid gap-3">
				<div class="flex flex-wrap items-center justify-between gap-3">
					<div class="flex flex-wrap items-center gap-2">
						<ToggleGroup.Root
							type="single"
							variant="outline"
							size="sm"
							value={sourceFilter}
							onValueChange={(v) => v && setParam('source', v, DEFAULT_SOURCE)}
							aria-label="Filter by source"
						>
							<ToggleGroup.Item value="all">All</ToggleGroup.Item>
							<ToggleGroup.Item value="local">Local</ToggleGroup.Item>
							<ToggleGroup.Item value="github">GitHub</ToggleGroup.Item>
						</ToggleGroup.Root>
						<Select.Root
							type="single"
							value={sortKey}
							onValueChange={(v) => setParam('sort', v, DEFAULT_SORT)}
						>
							<Select.Trigger size="sm" aria-label="Sort documents">
								{SORT_OPTIONS[sortKey]}
							</Select.Trigger>
							<Select.Content>
								{#each Object.entries(SORT_OPTIONS) as [value, label] (value)}
									<Select.Item {value} {label}>{label}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
					<div class="flex items-center gap-3">
						<p class="text-xs text-muted-foreground">
							{#if visibleDocuments.length === documents.length}
								{documents.length} document{documents.length === 1 ? '' : 's'}
							{:else}
								{visibleDocuments.length} of {documents.length} documents
							{/if}
						</p>
						<ToggleGroup.Root
							type="single"
							variant="outline"
							size="sm"
							value={viewMode}
							onValueChange={(v) => v && setParam('view', v, DEFAULT_VIEW)}
							aria-label="Layout"
						>
							<ToggleGroup.Item value="cards" title="Card view" aria-label="Card view">
								<LayoutList />
							</ToggleGroup.Item>
							<ToggleGroup.Item value="compact" title="Compact view" aria-label="Compact view">
								<Rows3 />
							</ToggleGroup.Item>
						</ToggleGroup.Root>
					</div>
				</div>

				{#if visibleDocuments.length === 0}
					<div class="border border-border p-8 text-center text-sm text-muted-foreground">
						No {sourceFilter === 'github' ? 'GitHub-synced' : 'local-only'} documents.
					</div>
				{:else if viewMode === 'compact'}
					<div class="overflow-x-auto border border-border bg-card">
						<table class="w-full table-fixed text-sm">
							<thead class="border-b border-border text-left text-xs text-muted-foreground">
								<tr>
									<th class="px-3 py-2 font-medium">Name</th>
									<th class="hidden px-3 py-2 font-medium md:table-cell">GitHub</th>
									<th class="hidden w-44 px-3 py-2 font-medium sm:table-cell">Modified</th>
									<th class="w-28 px-3 py-2"><span class="sr-only">Actions</span></th>
								</tr>
							</thead>
							<tbody>
								{#each visibleDocuments as doc (doc.id)}
									{@const meta = githubMeta[doc.id]}
									<tr class="border-b border-border last:border-b-0 hover:bg-muted/50">
										<td class="truncate px-3 py-1.5 font-medium">
											<a href={resolve(`/editor/${doc.id}`)} class="hover:underline"
												>{doc.name || UNTITLED}</a
											>
										</td>
										<td class="hidden px-3 py-1.5 md:table-cell">
											{#if meta}
												<div
													class="flex items-center gap-1.5 font-mono text-xs text-blue-700"
													title={githubPath(meta)}
												>
													{@render githubIcon()}
													<span class="truncate">{githubPath(meta)}</span>
												</div>
											{/if}
										</td>
										<td
											class="hidden px-3 py-1.5 text-xs whitespace-nowrap text-muted-foreground sm:table-cell"
										>
											{formatDate(doc.lastModified)}
										</td>
										<td class="px-3 py-1.5">
											<div class="flex justify-end gap-1">
												<Button
													variant="ghost"
													size="icon-sm"
													title="Open"
													aria-label="Open {doc.name || UNTITLED}"
													onclick={() => goto(resolve(`/editor/${doc.id}`))}
												>
													<SquareArrowOutUpRight />
												</Button>
												<Button
													variant="ghost"
													size="icon-sm"
													title="View oligos"
													aria-label="View oligos for {doc.name || UNTITLED}"
													onclick={() => goto(resolve(`/oligos/${doc.id}`))}
												>
													<FileSpreadsheet />
												</Button>
												<Button
													variant="ghost"
													size="icon-sm"
													title="Delete"
													aria-label="Delete {doc.name || UNTITLED}"
													class="text-destructive hover:text-destructive"
													onclick={() => handleDelete(doc.id, doc.name)}
												>
													<Trash2 />
												</Button>
											</div>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{:else}
					<div class="grid gap-3">
						{#each visibleDocuments as doc (doc.id)}
							{@const meta = githubMeta[doc.id]}
							<article
								class="flex flex-col gap-4 border border-border bg-card p-4 md:flex-row md:items-center md:justify-between"
							>
								<div class="min-w-0">
									<h3 class="truncate text-base font-semibold">
										<a href={resolve(`/editor/${doc.id}`)} class="hover:underline"
											>{doc.name || UNTITLED}</a
										>
									</h3>
									<div class="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
										<span>Modified: {formatDate(doc.lastModified)}</span>
										<span class="font-mono">ID: {doc.id.slice(0, 8)}…</span>
									</div>
									{#if meta}
										<div
											class="mt-1 flex items-center gap-1.5 truncate font-mono text-xs text-blue-700"
										>
											{@render githubIcon()}
											{githubPath(meta)}
										</div>
									{/if}
								</div>
								<div class="flex shrink-0 gap-2">
									<Button
										variant="outline"
										size="sm"
										onclick={() => goto(resolve(`/editor/${doc.id}`))}
									>
										Open
									</Button>
									<Button size="sm" onclick={() => goto(resolve(`/oligos/${doc.id}`))}>
										<FileSpreadsheet class="size-4" />
										View Oligos
									</Button>
									<Button
										variant="destructive"
										size="sm"
										onclick={() => handleDelete(doc.id, doc.name)}
									>
										<Trash2 class="size-4" />
										Delete
									</Button>
								</div>
							</article>
						{/each}
					</div>
				{/if}
			</section>
		{/if}
	</div>
</main>
