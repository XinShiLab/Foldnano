<script lang="ts">
	import { AlertTriangle } from '@lucide/svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { ChangeEntry } from './types';

	interface Props {
		open: boolean;
		entry: ChangeEntry | null;
		onConfirm: () => Promise<void>;
	}

	let { open = $bindable(), entry, onConfirm }: Props = $props();

	let busy = $state(false);

	async function handleConfirm() {
		busy = true;
		try {
			await onConfirm();
			open = false;
		} finally {
			busy = false;
		}
	}

	const title = $derived(
		entry?.kind === 'deleted'
			? 'Undo staged deletion?'
			: entry?.kind === 'added'
				? 'Discard new file?'
				: 'Discard local changes?'
	);

	const body = $derived.by(() => {
		if (!entry) return '';
		if (entry.kind === 'deleted') {
			return `"${entry.name}" is staged for deletion. This will un-stage the deletion — the file will remain on GitHub.`;
		}
		if (entry.kind === 'added') {
			return `"${entry.name}" is a local-only file that has never been committed to GitHub. Discarding will permanently delete it and all unsaved work.`;
		}
		// modified
		return `This will discard your local changes to "${entry.name}" and restore the last committed version from GitHub.`;
	});

	const isDestructive = $derived(entry?.kind !== 'deleted');
	const confirmLabel = $derived(entry?.kind === 'deleted' ? 'Undo deletion' : 'Discard changes');
</script>

<Dialog.Root bind:open>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<AlertTriangle size={16} class="shrink-0 text-amber-500" />
				{title}
			</Dialog.Title>
			<Dialog.Description>
				{body}
			</Dialog.Description>
		</Dialog.Header>

		{#if isDestructive}
			<div
				class="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300"
			>
				{entry?.kind === 'added'
					? 'This action cannot be undone.'
					: 'Your local version is kept in Backups, but only the last 5 backups of each design are kept and older ones are removed automatically. If you may need this version later, download it: open the design, then Save menu → Backups… → Download .fn.json.'}
			</div>
		{/if}

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)} disabled={busy}>Cancel</Button>
			<Button
				variant={isDestructive ? 'destructive' : 'default'}
				onclick={handleConfirm}
				disabled={busy}
			>
				{busy ? 'Working…' : confirmLabel}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
