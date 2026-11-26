<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import OligosTable from '$lib/components/Oligos/OligosTable.svelte';
	import { collectPartOligoReportRows, type OligoReportRow } from '$lib/model/io/oligoReport';
	import {
		documentNeedsQuantities,
		exportDocumentSequencesToCSV,
		exportPartSequencesToCSV,
	} from '$lib/model/io/sequenceCSV';
	import { exportBaseName } from '$lib/model/io/designFileName';
	import * as Select from '$lib/components/ui/select/index.js';
	import FoldnanoDocument from '$lib/model/document.svelte';
	import {
		IndexedDbStorageProvider,
		StorageManager,
		type DocumentMetadata,
	} from '$lib/services/storage';
	import { Download, FileSpreadsheet, PencilRuler } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { notify } from '$lib/notifications/notify.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let doc = $state<FoldnanoDocument | null>(null);
	let docMeta = $state<DocumentMetadata | null>(null);
	// The report shows one Part at a time; a design with several gets a picker.
	let partId = $state<string | null>(null);
	const part = $derived(doc?.parts.find((p) => p.id === partId) ?? doc?.parts[0] ?? null);
	const rows = $derived<OligoReportRow[]>(part ? collectPartOligoReportRows(part) : []);
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
			partId = restored.parts[0]?.id ?? null;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load document.';
		} finally {
			loading = false;
		}
	}

	function downloadCsv(scope: 'part' | 'design' = 'part'): void {
		if (!doc || !part) return;
		try {
			if (scope === 'design') exportDocumentSequencesToCSV(doc);
			else if (doc.parts.length > 1) {
				exportPartSequencesToCSV(part, exportBaseName(doc.name, `.${part.name}`));
			} else exportPartSequencesToCSV(part, doc.name);
		} catch (e) {
			notify.error('Cannot export oligo CSV', {
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
				{#if doc && doc.parts.length > 1}
					<Select.Root type="single" bind:value={() => part?.id ?? '', (v) => (partId = v || null)}>
						<Select.Trigger class="w-48" title="Part shown in the report">
							<span class="truncate">{part?.name ?? 'Part'}</span>
						</Select.Trigger>
						<Select.Content>
							{#each doc.parts as option (option.id)}
								<Select.Item value={option.id} label={option.name}>{option.name}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				{/if}
				{#if doc && documentNeedsQuantities(doc)}
					<Button
						variant="outline"
						onclick={() => downloadCsv('design')}
						title="Every Part's oligos, with how many instances of each Part the design has"
					>
						<Download class="size-4" />
						All Parts CSV, with quantities
					</Button>
				{/if}
				<Button onclick={() => downloadCsv('part')} disabled={!part}>
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
		{:else if !doc || !part}
			<div class="border border-border p-10 text-center">
				<p class="text-sm font-medium">No part found</p>
				<p class="mt-1 text-sm text-muted-foreground">This design has no Part to report.</p>
			</div>
		{:else}
			<section class="flex flex-col gap-3">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<p class="text-sm text-muted-foreground">
						{rows.length} oligo{rows.length === 1 ? '' : 's'} from
						<span class="font-medium text-foreground"
							>{doc.name}{doc.parts.length > 1 ? ` › ${part.name}` : ''}</span
						>
						·
						<a
							href="{resolve('/docs/[...slug]', {
								slug: 'guide/oligo-report',
							})}#oligokey-and-oligo-id"
							target="_blank"
							rel="noopener"
							class="underline underline-offset-2 hover:text-foreground">OligoKey vs oligo ID</a
						>
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
