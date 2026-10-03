<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { OxDnaFallbackBase } from '$lib/model/io/oxdnaExport';

	interface Props {
		open: boolean;
		onConfirm: (ssDnaFallback: OxDnaFallbackBase) => void;
		onCancel: () => void;
	}

	let { open = $bindable(), onConfirm, onCancel }: Props = $props();

	let ssDnaBase = $state<OxDnaFallbackBase>('T');

	function handleConfirm() {
		onConfirm(ssDnaBase);
		open = false;
	}

	function handleCancel() {
		onCancel();
		open = false;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>No Sequence Data</Dialog.Title>
			<Dialog.Description>
				This design has no assigned sequences. Unassigned double-stranded positions will be filled
				with random sequences, taking Watson-Crick complementary constraints into consideration.
				Choose what to fill the remaining single-stranded positions with:
			</Dialog.Description>
		</Dialog.Header>

		<div class="py-2">
			<div class="flex flex-wrap gap-2">
				{#each ['T', 'A', 'C', 'G', 'random'] as const as opt (opt)}
					<button
						class="rounded border px-3 py-1.5 text-sm transition-colors {ssDnaBase === opt
							? 'border-primary bg-primary text-primary-foreground'
							: 'border-border bg-background hover:bg-accent'}"
						onclick={() => (ssDnaBase = opt)}
					>
						{opt === 'random' ? 'Random' : opt}
					</button>
				{/each}
			</div>
			<p class="mt-3 text-xs text-muted-foreground">
				Default <strong>T</strong> is a common placeholder for ssDNA in oxDNA simulations.
			</p>
		</div>

		<Dialog.Footer class="gap-2">
			<Button variant="outline" onclick={handleCancel}>Cancel</Button>
			<Button onclick={handleConfirm}>Export</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
