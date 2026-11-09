<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Bug, Copy, LoaderCircle } from '@lucide/svelte';
	import { notify } from '$lib/notifications/notify.svelte';
	import { errorLogPanelState } from '$lib/errorLogPanel.svelte';
	import { foldnanoIndexedDb } from '$lib/services/storage/indexeddb/FoldnanoIndexedDb';
	import type { ErrorLogRecord } from '$lib/services/storage/indexedDbTypes';
	import { formatRelativeTime } from '$lib/relativeTime';

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
		notify.success('Copied to clipboard');
	}

	async function copyAll() {
		await navigator.clipboard.writeText(JSON.stringify(entries, null, 2));
		notify.success('Copied to clipboard');
	}

	async function clearAll() {
		await foldnanoIndexedDb.clearErrorLogs();
		entries = [];
		expandedId = null;
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
				Errors from this browser in the last 30 days (up to 50), kept locally for troubleshooting.
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
										>{formatRelativeTime(entry.timestamp)}</span
									>
									<span class="font-mono text-[10px] text-muted-foreground">#{entry.id}</span>
									{#if (entry.count ?? 1) > 1}
										<span
											class="rounded bg-muted px-1 text-[10px] text-muted-foreground"
											title={entry.lastSeenAt
												? `Last seen ${formatRelativeTime(entry.lastSeenAt)}`
												: undefined}>×{entry.count}</span
										>
									{/if}
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
			<div class="flex items-center gap-2">
				<Button size="sm" variant="outline" onclick={copyAll} disabled={entries.length === 0}>
					Copy all as JSON
				</Button>
				<Button size="sm" variant="ghost" onclick={clearAll} disabled={entries.length === 0}>
					Clear
				</Button>
			</div>
			<Button size="sm" onclick={() => (errorLogPanelState.open = false)}>Close</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
