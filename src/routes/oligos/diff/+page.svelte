<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import {
		OLIGO_REPORT_COLUMNS,
		collectPartOligoReportRows,
		diffOligoReportRows,
		type OligoDiffResult,
		type OligoDiffRow,
		type OligoReportColumn,
		type OligoReportRow,
	} from '$lib/model/io/oligoReport';
	import { exportPartSequencesToCSV } from '$lib/model/io/sequenceCSV';
	import FoldnanoDocument from '$lib/model/document.svelte';
	import {
		IndexedDbStorageProvider,
		StorageManager,
		type DocumentMetadata,
	} from '$lib/services/storage';
	import { ArrowRightLeft, Download, FileSpreadsheet } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let documents = $state<DocumentMetadata[]>([]);
	let leftDocId = $state('');
	let rightDocId = $state('');
	let leftDoc = $state<FoldnanoDocument | null>(null);
	let rightDoc = $state<FoldnanoDocument | null>(null);
	let diff = $state<OligoDiffResult | null>(null);
	let loading = $state(true);
	let error = $state('');

	const storageManager = new StorageManager('indexedDB');
	storageManager.registerProvider('indexedDB', new IndexedDbStorageProvider());

	$effect(() => {
		const left = data.left;
		const right = data.right;
		if (browser) void load(left, right);
	});

	async function load(left: string, right: string): Promise<void> {
		if (!browser) return;
		leftDocId = left;
		rightDocId = right;
		loading = true;
		error = '';
		leftDoc = null;
		rightDoc = null;
		diff = null;
		try {
			documents = await storageManager.getDocumentList();
			if (!leftDocId || !rightDocId) return;
			const [loadedLeft, loadedRight] = await Promise.all([
				loadDoc(leftDocId),
				loadDoc(rightDocId),
			]);
			leftDoc = loadedLeft;
			rightDoc = loadedRight;
			const leftRows = loadedLeft.parts[0] ? collectPartOligoReportRows(loadedLeft.parts[0]) : [];
			const rightRows = loadedRight.parts[0]
				? collectPartOligoReportRows(loadedRight.parts[0])
				: [];
			diff = diffOligoReportRows(leftRows, rightRows);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to compare documents.';
		} finally {
			loading = false;
		}
	}

	async function loadDoc(docId: string): Promise<FoldnanoDocument> {
		const snapshot = await storageManager.loadDocument(docId);
		if (!snapshot) throw new Error(`Document ${docId} was not found in local browser storage.`);
		return FoldnanoDocument.fromJSON(snapshot as ReturnType<FoldnanoDocument['toJSON']>);
	}

	function compareSelected(): void {
		if (!leftDocId || !rightDocId || leftDocId === rightDocId) return;
		goto(
			resolve(
				`/oligos/diff?left=${encodeURIComponent(leftDocId)}&right=${encodeURIComponent(rightDocId)}`
			)
		);
	}

	function downloadCsv(which: 'left' | 'right'): void {
		const doc = which === 'left' ? leftDoc : rightDoc;
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

	function rowId(row: OligoDiffRow): string {
		return row.left?.oligoKey ?? row.right?.oligoKey ?? row.key.slice(0, 14);
	}

	function value(row: OligoReportRow | null, column: OligoReportColumn): string {
		if (!row) return '';
		if (column === 'length') return String(row.length);
		return String(row[column]);
	}

	function label(column: OligoReportColumn): string {
		const labels: Record<OligoReportColumn, string> = {
			oligoKey: 'OligoKey',
			start: 'Start',
			end: 'End',
			sequence: 'Sequence',
			length: 'Length',
			color: 'Color',
			mod5Prime: 'Mod5Prime',
			mod3Prime: 'Mod3Prime',
			positions: 'Positions',
		};
		return labels[column];
	}

	function changedText(row: OligoDiffRow): string {
		if (row.status === 'changed') return row.changedColumns.map(label).join(', ');
		if (row.status === 'left-only') return 'Only in left';
		if (row.status === 'right-only') return 'Only in right';
		return 'Unchanged';
	}

	function visibleColumns(row: OligoDiffRow): OligoReportColumn[] {
		const columns = row.changedColumns.length ? row.changedColumns : [...OLIGO_REPORT_COLUMNS];
		return columns.includes('start') ? columns : ['start', ...columns];
	}
</script>

<svelte:head>
	<title>Oligo Diff - Foldnano</title>
</svelte:head>

<main class="min-h-dvh bg-background text-foreground">
	<div class="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-8">
		<header
			class="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-end lg:justify-between"
		>
			<div>
				<p class="text-xs font-medium text-muted-foreground uppercase">Oligo report</p>
				<h1 class="text-2xl font-semibold">Oligo Diff</h1>
			</div>
			<Button variant="outline" onclick={() => goto(resolve('/oligos'))}>
				<FileSpreadsheet class="size-4" />
				All Oligos
			</Button>
		</header>

		<section class="border border-border bg-card p-4">
			<div class="mb-4 flex items-center gap-2">
				<ArrowRightLeft class="size-4 text-muted-foreground" />
				<h2 class="text-sm font-semibold">Choose two local documents</h2>
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

		{#if loading}
			<div class="border border-border p-10 text-center text-sm text-muted-foreground">
				Loading…
			</div>
		{:else if error}
			<div class="border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
				{error}
			</div>
		{:else if !diff}
			<div class="border border-border p-10 text-center text-sm text-muted-foreground">
				Select two saved documents to compare their oligo reports.
			</div>
		{:else}
			<section class="grid gap-4">
				<div class="grid gap-3 lg:grid-cols-2">
					<div class="border border-border bg-card p-4">
						<p class="text-xs text-muted-foreground uppercase">Left</p>
						<h2 class="truncate font-semibold">{leftDoc?.name ?? leftDocId}</h2>
						<Button class="mt-3" size="sm" variant="outline" onclick={() => downloadCsv('left')}>
							<Download class="size-4" />
							Download CSV
						</Button>
					</div>
					<div class="border border-border bg-card p-4">
						<p class="text-xs text-muted-foreground uppercase">Right</p>
						<h2 class="truncate font-semibold">{rightDoc?.name ?? rightDocId}</h2>
						<Button class="mt-3" size="sm" variant="outline" onclick={() => downloadCsv('right')}>
							<Download class="size-4" />
							Download CSV
						</Button>
					</div>
				</div>

				<div class="grid gap-3 md:grid-cols-4">
					<div class="border border-border p-3">
						<p class="text-xs text-muted-foreground">Unchanged</p>
						<p class="text-xl font-semibold">{diff.unchanged.length}</p>
					</div>
					<div class="border border-border p-3">
						<p class="text-xs text-muted-foreground">Changed</p>
						<p class="text-xl font-semibold">{diff.changed.length}</p>
					</div>
					<div class="border border-border p-3">
						<p class="text-xs text-muted-foreground">Only in left</p>
						<p class="text-xl font-semibold">{diff.leftOnly.length}</p>
					</div>
					<div class="border border-border p-3">
						<p class="text-xs text-muted-foreground">Only in right</p>
						<p class="text-xl font-semibold">{diff.rightOnly.length}</p>
					</div>
				</div>

				<div class="overflow-hidden border border-border">
					<div class="overflow-auto">
						<table class="w-full min-w-[980px] border-collapse text-left text-sm">
							<thead class="bg-muted text-xs text-muted-foreground uppercase">
								<tr>
									<th class="border-b border-border px-3 py-2">Status</th>
									<th class="border-b border-border px-3 py-2">OligoKey</th>
									<th class="border-b border-border px-3 py-2">Changed fields</th>
									<th class="border-b border-border px-3 py-2">Left values</th>
									<th class="border-b border-border px-3 py-2">Right values</th>
								</tr>
							</thead>
							<tbody>
								{#each diff.rows.filter((row) => row.status !== 'unchanged') as row (row.key)}
									<tr class="border-b border-border/70">
										<td class="px-3 py-2 font-medium">{row.status}</td>
										<td class="px-3 py-2 font-mono">{rowId(row)}</td>
										<td class="px-3 py-2">{changedText(row)}</td>
										<td class="px-3 py-2">
											<div class="grid gap-1 font-mono text-xs">
												{#each visibleColumns(row) as column (column)}
													<span>{label(column)}: {value(row.left, column)}</span>
												{/each}
											</div>
										</td>
										<td class="px-3 py-2">
											<div class="grid gap-1 font-mono text-xs">
												{#each visibleColumns(row) as column (column)}
													<span>{label(column)}: {value(row.right, column)}</span>
												{/each}
											</div>
										</td>
									</tr>
								{:else}
									<tr>
										<td colspan="5" class="px-3 py-8 text-center text-muted-foreground">
											No oligo report differences.
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			</section>
		{/if}
	</div>
</main>
