<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import OligosTable from '$lib/components/Oligos/OligosTable.svelte';
	import { collectPartOligoReportRows, type OligoReportRow } from '$lib/model/io/oligoReport';
	import { exportPartSequencesToCSV } from '$lib/model/io/sequenceCSV';
	import FoldnanoDocument from '$lib/model/document.svelte';
	import {
		IndexedDbStorageProvider,
		StorageManager,
		type DocumentMetadata,
	} from '$lib/services/storage';
	import { Download, FileSpreadsheet, PencilRuler } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let doc = $state<FoldnanoDocument | null>(null);
	let docMeta = $state<DocumentMetadata | null>(null);
	let rows = $state<OligoReportRow[]>([]);
	let loading = $state(true);
	let error = $state('');

	const storageManager = new StorageManager('indexedDB');
	storageManager.registerProvider('indexedDB', new IndexedDbStorageProvider());

	onMount(loadDocument);

	async function loadDocument(): Promise<void> {
		if (!browser) return;
		loading = true;
		error = '';
		try {
			const snapshot = await storageManager.loadDocument(data.docId);
			if (!snapshot) {
				error = 'Document not found in local browser storage.';
				return;
			}
			const restored = FoldnanoDocument.fromJSON(
				snapshot as ReturnType<FoldnanoDocument['toJSON']>
			);
			doc = restored;
			const docs = await storageManager.getDocumentList();
			docMeta = docs.find((entry) => entry.id === restored.id) ?? null;
			const part = restored.parts[0];
			rows = part ? collectPartOligoReportRows(part) : [];
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load document.';
		} finally {
			loading = false;
		}
	}

	function downloadCsv(): void {
		const part = doc?.parts[0];
		if (!part) return;
		try {
			exportPartSequencesToCSV(part);
		} catch (e) {
			toast.error('Cannot export oligo CSV', {
				description: e instanceof Error ? e.message : 'The design cannot be exported.',
			});
		}
	}
</script>

<svelte:head>
	<title>{doc?.name ?? 'Oligos'} - Foldnano</title>
</svelte:head>

<main class="min-h-dvh bg-background text-foreground">
	<div class="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-8">
		<header
			class="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-end lg:justify-between"
		>
			<div class="min-w-0">
				<p class="text-xs font-medium text-muted-foreground uppercase">Oligo report</p>
				<h1 class="truncate text-2xl font-semibold">{doc?.name ?? docMeta?.name ?? 'Loading…'}</h1>
				<p class="mt-1 font-mono text-xs text-muted-foreground">{data.docId}</p>
			</div>
			<div class="flex flex-wrap gap-2">
				<Button variant="outline" onclick={() => goto(resolve('/oligos'))}>
					<FileSpreadsheet class="size-4" />
					All Oligos
				</Button>
				<Button variant="outline" onclick={() => goto(resolve(`/editor/${data.docId}`))}>
					<PencilRuler class="size-4" />
					Open Editor
				</Button>
				<Button onclick={downloadCsv} disabled={!doc || !doc.parts[0]}>
					<Download class="size-4" />
					Download CSV
				</Button>
			</div>
		</header>

		{#if loading}
			<div class="border border-border p-10 text-center text-sm text-muted-foreground">
				Loading…
			</div>
		{:else if error}
			<div class="border border-destructive/40 bg-destructive/5 p-6">
				<p class="text-sm font-medium text-destructive">{error}</p>
				<Button class="mt-4" variant="outline" onclick={() => goto(resolve('/oligos'))}>
					Back to Oligos
				</Button>
			</div>
		{:else if !doc?.parts[0]}
			<div class="border border-border p-10 text-center">
				<p class="text-sm font-medium">No part found</p>
				<p class="mt-1 text-sm text-muted-foreground">
					The oligos page currently reports the first part of a document.
				</p>
			</div>
		{:else}
			<section class="flex flex-col gap-3">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<p class="text-sm text-muted-foreground">
						{rows.length} oligo{rows.length === 1 ? '' : 's'} from
						<span class="font-medium text-foreground">{doc.parts[0].name}</span>
					</p>
					{#if rows.some((row) => row.isCircular)}
						<p class="text-xs text-amber-700">
							Circular oligos are shown here but rejected by CSV export.
						</p>
					{/if}
				</div>
				<OligosTable {rows} />
			</section>
		{/if}
	</div>
</main>
