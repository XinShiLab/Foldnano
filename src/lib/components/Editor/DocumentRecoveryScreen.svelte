<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import { getEditorDocumentSession } from './context/EditorDocumentSession.svelte';
	import {
		backupFileName,
		type BackupEntry,
		type DocumentLoadFailure,
	} from './context/documentRecovery';
	import { downloadJsonAsTextFile } from './Toolbar/utils';

	interface Props {
		failure: DocumentLoadFailure;
	}

	let { failure }: Props = $props();

	const session = getEditorDocumentSession();

	// Raw: backups hold snapshots that go back into IndexedDB, which can't store proxies.
	let backups = $state.raw<BackupEntry[] | null>(null);
	let restoringId = $state<string | null>(null);

	$effect(() => {
		const docId = failure.docId;
		backups = null;
		void session.listBackups(docId).then((list) => {
			if (failure.docId === docId) backups = list;
		});
	});

	const title = $derived(failure.name ? `"${failure.name}"` : 'This design');

	async function downloadRaw() {
		const raw = await session.loadRawDocument(failure.docId);
		if (!raw) {
			toast.error('The saved data could not be read from browser storage.');
			return;
		}
		const base = failure.name?.trim() || failure.docId;
		downloadJsonAsTextFile(JSON.stringify(raw, null, 2), `${base}.unreadable.fn.json`);
	}

	function downloadBackup(backup: BackupEntry) {
		downloadJsonAsTextFile(
			JSON.stringify(backup.snapshot),
			backupFileName(failure.name ?? failure.docId, backup.createdAt)
		);
	}

	async function restore(backup: BackupEntry) {
		const when = new Date(backup.createdAt).toLocaleString();
		if (
			!confirm(
				`Restore the backup from ${when}?\n\nThe current unreadable data becomes a backup, but only the last 5 are kept. Download it first (Download saved data) if you may need it.`
			)
		)
			return;
		restoringId = backup.id;
		try {
			const result = await session.restoreBackup(failure.docId, backup);
			if (result === 'restored') toast.success(`Restored the backup from ${when}`);
			else if (result === 'not-allowed')
				toast.error('This design is open in another tab. Restore it there.');
			else if (result === 'save-failed')
				toast.error("The backup couldn't be written to browser storage. Download it instead.");
			else toast.error("The restored version couldn't be opened either. Try an older backup.");
		} finally {
			restoringId = null;
		}
	}
</script>

<div class="absolute inset-0 z-50 overflow-y-auto bg-background">
	<div class="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-12">
		<div class="flex flex-col gap-2">
			<h1 class="text-xl font-semibold">{title} can't be opened</h1>
			<p class="text-sm text-muted-foreground">{failure.message}</p>
			{#if failure.reason !== 'too-new'}
				<p class="text-sm text-muted-foreground">
					Nothing has been deleted. Download the saved data to keep it, or restore a backup below.
				</p>
			{/if}
		</div>

		<div class="flex flex-wrap gap-2">
			{#if failure.reason === 'too-new'}
				<button
					class="rounded-md border border-border bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
					onclick={() => location.reload()}>Reload page</button
				>
			{/if}
			<button
				class="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted"
				onclick={downloadRaw}>Download saved data (.json)</button
			>
			<button
				class="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted"
				onclick={() => goto(resolve('/toc'))}>Open another design</button
			>
		</div>

		<section class="flex flex-col gap-2">
			<h2 class="text-sm font-semibold">Backups</h2>
			{#if backups === null}
				<p class="text-sm text-muted-foreground">Looking for backups…</p>
			{:else if backups.length === 0}
				<p class="text-sm text-muted-foreground">
					No backups of this design were found in this browser.
				</p>
			{:else}
				<ul class="flex flex-col divide-y divide-border rounded-md border border-border">
					{#each backups as backup (backup.id)}
						<li class="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
							<div class="flex flex-col">
								<span>{new Date(backup.createdAt).toLocaleString()}</span>
								<span class="text-xs text-muted-foreground">
									{backup.label}{backup.detail ? ` · ${backup.detail}` : ''}{backup.readable
										? ''
										: ' · also unreadable'}
								</span>
							</div>
							<span class="flex gap-2">
								<button
									class="rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted"
									onclick={() => downloadBackup(backup)}>Download .fn.json</button
								>
								<button
									class="rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
									disabled={!backup.readable || restoringId !== null}
									onclick={() => restore(backup)}
									>{restoringId === backup.id ? 'Restoring…' : 'Restore'}</button
								>
							</span>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</div>
</div>
