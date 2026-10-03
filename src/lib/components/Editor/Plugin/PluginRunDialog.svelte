<script lang="ts">
	import type { PythonPlugin, PluginParamDef } from '$lib/plugin/types';
	import { coercePluginFieldValues } from '$lib/plugin/fieldValidation';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import PluginFieldInputs from './PluginFieldInputs.svelte';

	let {
		plugin,
		onRun,
		onCancel,
	}: {
		plugin: PythonPlugin;
		onRun: (values: Record<string, unknown>) => void;
		onCancel: () => void;
	} = $props();

	// Local copy of values so edits don't mutate plugin.paramValues until confirmed.
	let values: Record<string, unknown> = $state({ ...plugin.paramValues });

	let validationError: string | null = $state(null);

	const params: PluginParamDef[] = $derived(plugin.manifest.parameters ?? []);

	function handleSubmit() {
		validationError = null;
		const result = coercePluginFieldValues(params, values);
		if (!result.ok) {
			validationError = result.error;
			return;
		}
		onRun(result.values);
	}
</script>

<Dialog.Root
	open={true}
	onOpenChange={(v) => {
		if (!v) onCancel();
	}}
>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Run — {plugin.manifest.name}</Dialog.Title>
		</Dialog.Header>

		<div class="max-h-[60vh] overflow-y-auto">
			{#if params.length === 0}
				<p class="text-sm text-muted-foreground">No parameters to configure.</p>
			{:else}
				<PluginFieldInputs fields={params} {values} />
			{/if}

			{#if validationError}
				<p class="mt-2 text-xs text-destructive">{validationError}</p>
			{/if}
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={onCancel}>Cancel</Button>
			<Button onclick={handleSubmit}>Run</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
