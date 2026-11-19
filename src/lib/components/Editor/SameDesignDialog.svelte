<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { normalizeDesignName, validateDesignName } from '$lib/model/io/designFileName';
	import type { SameDesignGate } from './context/SameDesignGate.svelte';
	import DesignIdChip from './DesignIdChip.svelte';

	let { gate }: { gate: SameDesignGate } = $props();

	let copyName = $state('');
	$effect(() => {
		const question = gate.pending;
		if (question?.kind === 'other-repo-file') copyName = question.suggestedName;
	});
	const nameError = $derived.by(() => {
		const trimmed = normalizeDesignName(copyName);
		return trimmed ? validateDesignName(trimmed) : 'Enter a name for the copy.';
	});

	const formatTime = (at: number): string =>
		new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	const fileName = (path: string): string => path.split('/').pop() ?? path;

	function saveCopy() {
		if (nameError) return;
		gate.answer({ action: 'copy', name: normalizeDesignName(copyName) });
	}
</script>

{#if gate.pending}
	{@const question = gate.pending}
	<Dialog.Root
		open={true}
		onOpenChange={(v) => {
			if (!v) gate.answer({ action: 'cancel' });
		}}
	>
		<Dialog.Content class="sm:max-w-md">
			{#if question.kind === 'other-repo-file'}
				<Dialog.Header>
					<Dialog.Title>
						"{question.incomingName}" has the same design ID as {fileName(question.linkedPath)}
						<DesignIdChip id={question.designId} class="align-middle" />
					</Dialog.Title>
					<Dialog.Description>
						Two files in this repository share one design ID ("{question.linkedPath}" is already
						linked to a design in this browser), so Foldnano can't link both. Save this file as a
						copy with a new name: the copy gets its own ID, and "{fileName(question.incomingPath)}"
						on GitHub stays as it is for anyone else using it.
					</Dialog.Description>
				</Dialog.Header>
				<form
					class="space-y-1"
					onsubmit={(e) => {
						e.preventDefault();
						saveCopy();
					}}
				>
					<label for="same-design-copy-name" class="text-sm font-medium">Name of the copy</label>
					<Input id="same-design-copy-name" bind:value={copyName} autocomplete="off" />
					{#if nameError}
						<p class="text-xs text-destructive">{nameError}</p>
					{/if}
				</form>
				<Dialog.Footer>
					<Button variant="ghost" onclick={() => gate.answer({ action: 'cancel' })}>Cancel</Button>
					<Button disabled={!!nameError} onclick={saveCopy}>Save as a copy</Button>
				</Dialog.Footer>
			{:else}
				<Dialog.Header>
					<Dialog.Title>
						"{question.incomingName}" is the same design as one you have
						<DesignIdChip id={question.designId} class="align-middle" />
					</Dialog.Title>
					<Dialog.Description>
						This file has the same design ID as "{question.savedName ?? question.incomingName}",
						saved only in this browser{question.savedAt !== null
							? ` (last saved ${formatTime(question.savedAt)})`
							: ''}.{question.sameContent === true
							? ' Its content is the same as the saved design.'
							: question.sameContent === false
								? ' Its content differs from the saved design.'
								: ''} Open the file as a separate copy, or replace the saved design with it (the saved
						version stays in Backups).
					</Dialog.Description>
				</Dialog.Header>
				<Dialog.Footer>
					<Button variant="ghost" onclick={() => gate.answer({ action: 'cancel' })}>Cancel</Button>
					<Button variant="outline" onclick={() => gate.answer({ action: 'replace' })}
						>Replace</Button
					>
					<Button onclick={() => gate.answer({ action: 'copy' })}>Open as copy</Button>
				</Dialog.Footer>
			{/if}
		</Dialog.Content>
	</Dialog.Root>
{/if}
