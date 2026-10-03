<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Bug, Copy, LoaderCircle } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { errorLogPanelState } from '$lib/errorLogPanel.svelte';
	import { foldnanoIndexedDb } from '$lib/services/storage/indexeddb/FoldnanoIndexedDb';
	import type { ErrorLogRecord } from '$lib/services/storage/indexedDbTypes';

	let entries = $state<ErrorLogRecord[]>([]);
	let loading = $state(false);
	let expandedId = $state<string | null>(null);

	$effect(() => {
		if (!errorLogPanelState.open) {
			expandedId = null;
			return;
		}
		loadEntries();
	});

	async function loadEntries() {
		loading = true;
		try {
			entries = await foldnanoIndexedDb.getRecentErrorLogs(50);
		} finally {
			loading = false;
		}
		expandedId = errorLogPanelState.focusedEntryId;
		if (expandedId) {
			const id = expandedId;
			requestAnimationFrame(() => {
				document.getElementById(`error-log-row-${id}`)?.scrollIntoView({ block: 'center' });
			});
		}
	}

	function toggleExpanded(id: string) {
		expandedId = expandedId === id ? null : id;
	}

	async function copyEntry(entry: ErrorLogRecord) {
		await navigator.clipboard.writeText(JSON.stringify(entry, null, 2));
		toast.success('Copied to clipboard');
	}

	async function copyAll() {
		await navigator.clipboard.writeText(JSON.stringify(entries, null, 2));
		toast.success('Copied to clipboard');
	}

	function formatDate(ts: number): string {
		const d = new Date(ts);
		const diff = Date.now() - ts;
		const mins = Math.floor(diff / 60000);
		const hours = Math.floor(diff / 3600000);
		const days = Math.floor(diff / 86400000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		if (hours < 24) return `${hours}h ago`;
		if (days === 1)
			return `yesterday ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
		return d.toLocaleString([], {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		});
	}
</script>

<Dialog.Root bind:open={errorLogPanelState.open}>
	<Dialog.Content class="flex max-h-[80vh] flex-col gap-0 p-0 sm:max-w-2xl">
		<Dialog.Header class="border-b border-border px-4 py-3">
			<Dialog.Title class="flex items-center gap-2 text-sm">
				<Bug size={16} />
				Error Log
			</Dialog.Title>
			<Dialog.Description class="text-xs">
				Recent errors from this browser, kept locally for troubleshooting.
			</Dialog.Description>
		</Dialog.Header>

		<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
			{#if loading}
				<div
					class="flex flex-1 items-center justify-center gap-2 py-12 text-sm text-muted-foreground"
				>
					<LoaderCircle size={16} class="animate-spin" />
					Loading…
				</div>
			{:else if entries.length === 0}
				<p class="p-4 text-xs text-muted-foreground italic">No errors logged yet.</p>
			{:else}
				{#each entries as entry (entry.id)}
					<div
						id="error-log-row-{entry.id}"
						class="flex flex-col gap-1 border-b border-border px-4 py-2.5 text-left transition-colors
							{expandedId === entry.id ? 'border-l-2 border-l-blue-400 bg-blue-50' : ''}"
					>
						<button
							class="flex items-start gap-2 text-left"
							onclick={() => toggleExpanded(entry.id)}
						>
							<span
								class="mt-1 size-2 shrink-0 rounded-full {entry.severity === 'warning'
									? 'bg-amber-400'
									: 'bg-red-500'}"
							></span>
							<span class="min-w-0 flex-1">
								<span class="flex items-center gap-2 text-xs font-medium text-foreground">
									<span class="rounded bg-muted px-1 font-mono text-[10px]">{entry.context}</span>
									<span class="text-[11px] font-normal text-muted-foreground"
										>{formatDate(entry.timestamp)}</span
									>
									<span class="font-mono text-[10px] text-muted-foreground">#{entry.id}</span>
								</span>
								<span class="mt-0.5 block truncate text-xs text-foreground">{entry.message}</span>
							</span>
							<Button
								variant="ghost"
								size="icon-sm"
								title="Copy this entry as JSON"
								onclick={(e) => {
									e.stopPropagation();
									copyEntry(entry);
								}}
							>
								<Copy size={13} />
							</Button>
						</button>
						{#if expandedId === entry.id}
							<pre
								class="mt-1 overflow-x-auto rounded bg-muted p-2 font-mono text-[10px] whitespace-pre-wrap text-muted-foreground">{entry.stack ??
									entry.message}</pre>
							<span class="text-[10px] text-muted-foreground"
								>v{entry.appVersion} ({entry.commitHash})</span
							>
						{/if}
					</div>
				{/each}
			{/if}
		</div>

		<Dialog.Footer class="flex items-center justify-between border-t border-border px-4 py-3">
			<Button size="sm" variant="outline" onclick={copyAll} disabled={entries.length === 0}>
				Copy all as JSON
			</Button>
			<Button size="sm" onclick={() => (errorLogPanelState.open = false)}>Close</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
