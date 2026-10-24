<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { latticeChoice } from './latticeChoice.svelte';

	const pending = $derived(latticeChoice.pending);
</script>

<Dialog.Root
	open={pending !== null}
	onOpenChange={(isOpen) => {
		if (!isOpen) latticeChoice.answer(null);
	}}
>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Which lattice is this design?</Dialog.Title>
			<Dialog.Description>
				<span class="font-mono text-foreground">{pending?.fileName}</span> has
				{pending?.numBases} bases per helix, which fits both a honeycomb and a square lattice, and its
				crossovers don't tell them apart. cadnano files don't record the lattice.
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer class="flex gap-2">
			<Button variant="outline" onclick={() => latticeChoice.answer(null)}>Cancel</Button>
			<Button onclick={() => latticeChoice.answer('SQUARE')}>Square</Button>
			<Button onclick={() => latticeChoice.answer('HONEYCOMB')}>Honeycomb</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
