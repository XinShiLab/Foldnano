<script lang="ts">
	import { getEditorDocumentSession } from './context/EditorDocumentSession.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import SaveFromUrlDialog from './SaveFromUrlDialog.svelte';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import { reportError } from '$lib/errorReporting';
	import { help } from '$lib/components/help/help';

	const session = getEditorDocumentSession();

	let showSaveFromUrlDialog = $state(false);

	// Update every second for relative time display
	let now = $state(Date.now());
	$effect(() => {
		const interval = setInterval(() => {
			now = Date.now();
		}, 1000);
		return () => clearInterval(interval);
	});

	function getRelativeTime(): string {
		const { lastSavedTime } = session;
		if (!lastSavedTime) return 'Not saved';

		const seconds = Math.floor((now - lastSavedTime) / 1000);
		if (seconds < 5) return 'Saved just now';
		if (seconds < 60) return `Saved ${seconds}s ago`;

		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `Saved ${minutes}m ago`;

		const hours = Math.floor(minutes / 60);
		return `Saved ${hours}h ago`;
	}

	async function handleManualSave() {
		const success = await session.saveDocumentToLocalStorage();
		if (!success) {
			reportError(new Error('Manual save failed'), 'manual-save');
		}
	}

	async function handleConfirmUrlSave() {
		await session.confirmAndSaveFromUrl();
		await goto(resolve(`/editor/${session.currentDoc.id}`), { replaceState: true });
	}
</script>

<div class="flex items-center gap-1">
	{#if session.pendingUrlSave}
		<button
			class="flex cursor-pointer items-center gap-2 rounded border border-blue-300 bg-blue-50 px-3 py-1 text-[13px] text-blue-700 transition-all hover:bg-blue-100 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-300 dark:hover:bg-blue-900"
			onclick={() => (showSaveFromUrlDialog = true)}
			title="This design was loaded from a URL and is not saved yet"
			{@attach help({
				title: 'Not saved yet',
				text: 'This design was loaded from a link. Click to keep a copy in this browser.',
			})}
		>
			<span class="size-2 shrink-0 animate-pulse rounded-full bg-blue-500"></span>
			<span class="whitespace-nowrap select-none">Click to Save Locally</span>
		</button>
		<SaveFromUrlDialog
			bind:open={showSaveFromUrlDialog}
			sourceUrl={session.sourceUrl}
			onConfirm={handleConfirmUrlSave}
		/>
	{:else}
		<button
			class="flex items-center gap-2 rounded border border-border bg-background px-3 py-1 text-[13px] text-muted-foreground transition-all"
			class:cursor-pointer={!session.isSaved || session.autoSaveError}
			class:cursor-default={session.isSaved && !session.autoSaveError}
			class:hover:bg-muted={!session.isSaved || session.autoSaveError}
			onclick={handleManualSave}
			{@attach help({
				title: 'Save status',
				text: 'Green: saved in this browser. Amber: autosave pending, click to save now. Red: the last save failed, click to retry.',
				doc: 'saving-github',
			})}
			title={session.autoSaveError
				? `Save failed: ${session.autoSaveError} - Click to retry`
				: session.isSaved
					? 'All changes saved locally'
					: `${session.editsSinceLastSave} unsaved edits - Click to save now`}
		>
			<span
				class="size-2 shrink-0 rounded-full transition-colors duration-300"
				class:bg-emerald-500={session.isSaved && !session.autoSaveError}
				class:bg-amber-400={!session.isSaved && !session.autoSaveError}
				class:bg-red-500={session.autoSaveError}
				class:animate-pulse={!session.isSaved}
			></span>
			<span class="whitespace-nowrap select-none">
				{#if session.autoSaveError}
					Save failed
				{:else if session.isSaved}
					{getRelativeTime()}
				{:else}
					{session.editsSinceLastSave} unsaved {session.editsSinceLastSave === 1 ? 'edit' : 'edits'}
				{/if}
			</span>
		</button>
	{/if}
	<Tooltip.Provider delayDuration={200}>
		<Tooltip.Root>
			<Tooltip.Trigger>
				<span
					class="flex size-4 shrink-0 cursor-default items-center justify-center rounded-full border border-muted-foreground/40 text-[10px] leading-none font-semibold text-muted-foreground/60 transition-colors select-none hover:border-muted-foreground/70 hover:text-muted-foreground"
					aria-label="Storage info">!</span
				>
			</Tooltip.Trigger>
			<Tooltip.Content class="max-w-64 text-center text-xs leading-relaxed">
				Your design is saved in your browser's local storage, not on any server. To back it up or
				collaborate, connect a GitHub repository and commit your changes.
				{#if session.storagePersistence === 'best-effort'}
					<span class="mt-1 block">
						This browser may clear that storage when disk space runs low. Keep a downloaded copy of
						important designs.
					</span>
				{:else if session.storagePersistence === 'persistent'}
					<span class="mt-1 block"
						>Persistent storage is on: the browser won't clear it on its own.</span
					>
				{/if}
			</Tooltip.Content>
		</Tooltip.Root>
	</Tooltip.Provider>
</div>
