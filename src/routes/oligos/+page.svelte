<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import {
		IndexedDbStorageProvider,
		StorageManager,
		githubExplorerStateStore,
		githubMetadataStore,
		type DocumentMetadata,
		type GitHubFileMetadata,
	} from '$lib/services/storage';
	import { ArrowRightLeft, FileSpreadsheet, FolderOpen } from '@lucide/svelte';
	import { onMount } from 'svelte';

	let documents = $state<DocumentMetadata[]>([]);
	let githubMeta = $state<Record<string, GitHubFileMetadata>>({});
	let leftDocId = $state('');
	let rightDocId = $state('');
	let loading = $state(true);

	const storageManager = new StorageManager('indexedDB');
	storageManager.registerProvider('indexedDB', new IndexedDbStorageProvider());

	async function loadDocuments(): Promise<void> {
		if (!browser) return;
		loading = true;
		try {
			documents = await storageManager.getDocumentList();
			const meta: Record<string, GitHubFileMetadata> = {};
			for (const doc of documents) {
				const fileMeta = githubMetadataStore.getFileMetadata(doc.id);
				if (fileMeta) meta[doc.id] = fileMeta;
			}
			githubMeta = meta;
			leftDocId = documents[0]?.id ?? '';
			rightDocId = documents.find((doc) => doc.id !== leftDocId)?.id ?? '';
		} finally {
			loading = false;
		}
	}

	onMount(async () => {
		await Promise.all([githubMetadataStore.hydrate(), githubExplorerStateStore.hydrate()]);
		await loadDocuments();
	});

	function formatDate(timestamp: number): string {
		return new Date(timestamp).toLocaleString();
	}

	function compareSelected(): void {
		if (!leftDocId || !rightDocId || leftDocId === rightDocId) return;
		goto(
			resolve(
				`/oligos/diff?left=${encodeURIComponent(leftDocId)}&right=${encodeURIComponent(rightDocId)}`
			)
		);
	}
</script>

<svelte:head>
	<title>Oligos - Foldnano</title>
</svelte:head>

<main data-stable-gutter class="min-h-dvh bg-background text-foreground">
	<div class="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">
		<header
			class="flex flex-col gap-4 border-b border-border pb-5 md:flex-row md:items-end md:justify-between"
		>
			<div>
				<p class="text-xs font-medium text-muted-foreground uppercase">Foldnano</p>
				<h1 class="text-2xl font-semibold">Oligos</h1>
			</div>
			<div class="flex gap-2">
				<Button variant="outline" onclick={() => goto(resolve('/toc'))}>
					<FolderOpen class="size-4" />
					Saved Documents
				</Button>
				<Button onclick={() => goto(resolve('/editor'))}>New Document</Button>
			</div>
		</header>

		<section class="border border-border bg-card p-4">
			<div class="mb-4 flex items-center gap-2">
				<ArrowRightLeft class="size-4 text-muted-foreground" />
				<h2 class="text-sm font-semibold">Compare saved documents</h2>
			</div>
			<div class="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
				<label class="grid gap-1.5 text-sm">
					<span class="text-xs font-medium text-muted-foreground">Left</span>
					<select bind:value={leftDocId} class="h-9 border border-input bg-background px-3 text-sm">
						<option value="">Select document</option>
						{#each documents as doc (doc.id)}
							<option value={doc.id}
								>{doc.name || 'Untitled Document'} ({doc.id.slice(0, 8)})</option
							>
						{/each}
					</select>
				</label>
				<label class="grid gap-1.5 text-sm">
					<span class="text-xs font-medium text-muted-foreground">Right</span>
					<select
						bind:value={rightDocId}
						class="h-9 border border-input bg-background px-3 text-sm"
					>
						<option value="">Select document</option>
						{#each documents as doc (doc.id)}
							<option value={doc.id}
								>{doc.name || 'Untitled Document'} ({doc.id.slice(0, 8)})</option
							>
						{/each}
					</select>
				</label>
				<Button
					onclick={compareSelected}
					disabled={!leftDocId || !rightDocId || leftDocId === rightDocId}
				>
					<ArrowRightLeft class="size-4" />
					Compare
				</Button>
			</div>
		</section>

		<section class="grid gap-3">
			<div class="flex items-center justify-between">
				<h2 class="text-sm font-semibold">Saved files</h2>
				<p class="text-xs text-muted-foreground">
					{documents.length} document{documents.length === 1 ? '' : 's'}
				</p>
			</div>
			{#if loading}
				<div class="border border-border p-8 text-center text-sm text-muted-foreground">
					Loading…
				</div>
			{:else if documents.length === 0}
				<div class="border border-border p-8 text-center">
					<p class="text-sm font-medium">No saved documents</p>
					<p class="mt-1 text-sm text-muted-foreground">
						Documents are saved locally in this browser from the editor.
					</p>
				</div>
			{:else}
				<div class="grid gap-3">
					{#each documents as doc (doc.id)}
						<article
							class="flex flex-col gap-4 border border-border bg-card p-4 md:flex-row md:items-center md:justify-between"
						>
							<div class="min-w-0">
								<h3 class="truncate text-base font-semibold">{doc.name || 'Untitled Document'}</h3>
								<div class="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
									<span>Modified: {formatDate(doc.lastModified)}</span>
									<span class="font-mono">ID: {doc.id.slice(0, 8)}…</span>
								</div>
								{#if githubMeta[doc.id]}
									<p class="mt-1 truncate font-mono text-xs text-blue-700">
										{githubMeta[doc.id].owner}/{githubMeta[doc.id].repo}:{githubMeta[doc.id].branch}
										/{githubMeta[doc.id].path}
									</p>
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
							</div>
						</article>
					{/each}
				</div>
			{/if}
		</section>
	</div>
</main>
