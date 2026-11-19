<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { normalizeDesignName, validateDesignName } from '$lib/model/io/designFileName';

	let {
		open = $bindable(false),
		currentName,
		onSave,
	}: {
		open?: boolean;
		currentName: string;
		onSave: (name: string) => Promise<void>;
	} = $props();

	let name = $state('');
	let saving = $state(false);
	$effect(() => {
		if (open) name = `${currentName} copy`;
	});
	const error = $derived.by(() => {
		const trimmed = normalizeDesignName(name);
		return trimmed ? validateDesignName(trimmed) : 'Enter a name for the copy.';
	});

	async function save() {
		if (error || saving) return;
		saving = true;
		try {
			await onSave(normalizeDesignName(name));
			open = false;
		} finally {
			saving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Save as a copy</Dialog.Title>
			<Dialog.Description>
				The copy is a new design with its own design ID, so Foldnano treats it as separate from "{currentName}",
				which stays as it is. The copy opens once it's saved.
			</Dialog.Description>
		</Dialog.Header>
		<form
			class="space-y-1"
			onsubmit={(e) => {
				e.preventDefault();
				void save();
			}}
		>
			<label for="save-as-copy-name" class="text-sm font-medium">Name of the copy</label>
			<Input id="save-as-copy-name" bind:value={name} autocomplete="off" />
			{#if error}
				<p class="text-xs text-destructive">{error}</p>
			{/if}
		</form>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
			<Button disabled={!!error || saving} onclick={save}>Save as a copy</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
