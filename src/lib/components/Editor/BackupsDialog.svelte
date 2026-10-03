<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { LoaderCircle, History, AlertTriangle, Check, Download } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { getEditorDocumentSession } from './context/EditorDocumentSession.svelte';
	import { backupFileName, type BackupEntry } from './context/documentRecovery';
	import { downloadJsonAsTextFile } from './Toolbar/utils';
	import { computeDiff, MAX_DIFF_CHANGES } from '$lib/services/github/diff';
	import DiffHunkRow from './GitHubDiff/DiffHunk.svelte';

	interface Props {
		open: boolean;
	}

	let { open = $bindable() }: Props = $props();

	const session = getEditorDocumentSession();

	// Raw: entries hold snapshots that go back into IndexedDB, which can't store proxies.
	let backups = $state.raw<BackupEntry[] | null>(null);
	let selectedBackupId = $state<string | null>(null);
	let currentText = $state('');
	let restoring = $state(false);
	let error = $state('');

	const selectedBackup = $derived(backups?.find((b) => b.id === selectedBackupId) ?? null);

	const hunks = $derived.by(() => {
		if (!selectedBackup || !currentText) return [];
		return computeDiff(JSON.stringify(selectedBackup.snapshot, null, 2), currentText);
	});

	// null: too many changes to show line by line.
	const hasChanges = $derived(hunks === null || hunks.some((h) => h.type !== 'equal'));

	$effect(() => {
		if (!open) {
			backups = null;
			selectedBackupId = null;
			currentText = '';
			error = '';
			return;
		}
		// Compare against what's on screen, including edits autosave hasn't written yet.
		currentText = JSON.stringify(session.currentDoc.toJSON(), null, 2);
		const docId = session.currentDoc.id;
		void session.listBackups(docId).then((list) => {
			if (!open || session.currentDoc.id !== docId) return;
			backups = list;
			selectedBackupId = list[0]?.id ?? null;
		});
	});

	function handleDownload() {
		if (!selectedBackup) return;
		downloadJsonAsTextFile(
			JSON.stringify(selectedBackup.snapshot),
			backupFileName(session.currentDoc.name, selectedBackup.createdAt)
		);
	}

	async function handleRestore() {
		if (!selectedBackup) return;
		const label = formatDate(selectedBackup.createdAt);
		const ok = window.confirm(
			`Restore the backup from ${label}?\n\nYour current version becomes a backup, but only the last 5 are kept. Download it first if you may need it later. Nothing is committed to GitHub.`
		);
		if (!ok) return;
		restoring = true;
		error = '';
		try {
			const result = await session.restoreBackup(session.currentDoc.id, selectedBackup);
			if (result === 'restored') {
				open = false;
				toast.success(`Restored the backup from ${label}`);
			} else if (result === 'not-allowed') {
				error = 'This design is open in another tab. Restore it there.';
			} else if (result === 'save-failed') {
				error = "The backup couldn't be written to browser storage.";
			} else {
				error = "The restored version couldn't be opened.";
			}
		} finally {
			restoring = false;
		}
	}

	function formatDate(ts: number): string {
		const d = new Date(ts);
		const now = Date.now();
		const diff = now - ts;
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

<Dialog.Root bind:open>
	<Dialog.Content class="flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-5xl">
		<!-- Header -->
		<Dialog.Header class="border-b border-border px-4 py-3">
			<Dialog.Title class="flex items-center gap-2 text-sm">
				<History size={16} />
				Backups
			</Dialog.Title>
			<Dialog.Description class="text-xs">
				The last 5 versions of "{session.currentDoc.name}" kept in this browser: one about every 10
				minutes while you work, and one before anything replaces your copy. Older ones are removed
				automatically, so download any version you want to keep.
			</Dialog.Description>
		</Dialog.Header>

		<!-- Body: sidebar list + diff pane -->
		<div class="flex min-h-0 flex-1 overflow-hidden">
			<!-- Left: backup list -->
			<div class="flex w-52 shrink-0 flex-col overflow-y-auto border-r border-border bg-muted">
				{#if backups === null}
					<p class="p-4 text-xs text-muted-foreground italic">Loading…</p>
				{:else if backups.length === 0}
					<p class="p-4 text-xs text-muted-foreground italic">
						No backups yet. The first one is kept about 10 minutes after you start editing.
					</p>
				{:else}
					{#each backups as backup, i (backup.id)}
						<button
							class="flex flex-col gap-0.5 border-b border-border px-3 py-2.5 text-left transition-colors hover:bg-muted
								{selectedBackupId === backup.id ? 'border-l-2 border-l-blue-400 bg-blue-50' : ''}"
							onclick={() => (selectedBackupId = backup.id)}
						>
							<span class="flex items-center gap-1 text-xs font-medium text-foreground">
								{#if i === 0}
									<span class="rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-700"
										>latest</span
									>
								{/if}
								{backup.label}
							</span>
							<span class="text-[11px] text-muted-foreground">{formatDate(backup.createdAt)}</span>
							{#if backup.detail}
								<span class="truncate font-mono text-[10px] text-muted-foreground"
									>{backup.detail}</span
								>
							{/if}
							{#if !backup.readable}
								<span class="text-[10px] text-red-600">Can't be opened</span>
							{/if}
						</button>
					{/each}
				{/if}
			</div>

			<!-- Right: diff pane -->
			<div class="flex min-w-0 flex-1 flex-col overflow-hidden">
				{#if error}
					<div class="flex items-center gap-2 px-4 py-4 text-sm text-red-600">
						<AlertTriangle size={14} />
						{error}
					</div>
				{:else if !selectedBackup}
					<div
						class="flex flex-1 items-center justify-center gap-2 py-12 text-sm text-muted-foreground"
					>
						<History size={20} class="text-gray-200" />
						Select a backup to see what changed since
					</div>
				{:else if !hasChanges}
					<div
						class="flex flex-1 items-center justify-center gap-2 py-12 text-sm text-muted-foreground"
					>
						<Check size={16} class="text-green-500" />
						This backup is identical to your current design.
					</div>
				{:else if hunks === null}
					<div
						class="flex flex-1 items-center justify-center px-6 py-12 text-center text-sm text-muted-foreground"
					>
						This backup differs from your current design in more than {MAX_DIFF_CHANGES.toLocaleString()}
						lines, too many to show line by line. Restore and Download still work.
					</div>
				{:else}
					<div class="overflow-auto">
						<!-- Column headers -->
						<div
							class="flex border-b border-border bg-muted text-xs font-medium text-muted-foreground"
						>
							<div class="w-[50%] border-r border-border px-10 py-1.5">
								Backup ({formatDate(selectedBackup.createdAt)})
							</div>
							<div class="w-[50%] px-10 py-1.5">Current</div>
						</div>
						<table class="w-full border-collapse text-left">
							<tbody>
								{#each hunks as hunk, index (index)}
									<DiffHunkRow {hunk} />
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>
		</div>

		<!-- Legend -->
		<div
			class="flex items-center gap-3 border-t border-border bg-muted px-4 py-1.5 text-[11px] text-muted-foreground"
		>
			<span class="flex items-center gap-1"
				><span class="inline-block h-2.5 w-2.5 rounded-sm bg-red-100 ring-1 ring-red-200"></span> in backup,
				removed since</span
			>
			<span class="flex items-center gap-1"
				><span class="inline-block h-2.5 w-2.5 rounded-sm bg-green-100 ring-1 ring-green-200"
				></span> not in backup, added since</span
			>
		</div>

		<!-- Footer -->
		<div class="flex items-center justify-between border-t border-border px-4 py-3">
			<Button size="sm" variant="outline" onclick={() => (open = false)} disabled={restoring}>
				Close
			</Button>
			<div class="flex gap-2">
				<Button
					size="sm"
					variant="outline"
					onclick={handleDownload}
					disabled={!selectedBackup || restoring}
				>
					<Download size={13} />
					Download .fn.json
				</Button>
				<Button size="sm" onclick={handleRestore} disabled={!selectedBackup?.readable || restoring}>
					{#if restoring}
						<LoaderCircle size={13} class="animate-spin" />
					{/if}
					Restore this backup
				</Button>
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>
