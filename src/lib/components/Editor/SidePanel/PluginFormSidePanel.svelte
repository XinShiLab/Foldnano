<script lang="ts">
	import { LoaderCircle, Play, Square } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import PluginFieldInputs from '../Plugin/PluginFieldInputs.svelte';
	import PluginRunOutput from '../Plugin/PluginRunOutput.svelte';
	import PluginActivationConfirmDialog from '../Plugin/PluginActivationConfirmDialog.svelte';
	import { PluginActivationGate } from '../Plugin/PluginActivationGate.svelte';
	import { coercePluginFieldValues } from '$lib/plugin/fieldValidation';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import type { PythonPlugin } from '$lib/plugin/types';

	let { plugin }: { plugin: PythonPlugin } = $props();

	const editorCtx = getEditorViewContext();
	const activationGate = new PluginActivationGate(
		() => editorCtx.pluginCoordinator,
		() => editorCtx.pluginRegistry
	);

	let validationError: string | null = $state(null);

	// Reset on plugin switch — this error belongs to the previous plugin's last run, not the new one.
	$effect(() => {
		const _track = plugin.manifest.id;
		validationError = null;
	});

	const panelTitle = $derived(plugin.manifest.sidePanel?.title ?? plugin.manifest.name);
	const submitLabel = $derived(plugin.manifest.sidePanel?.form?.submitLabel ?? 'Run');
	const fields = $derived(plugin.manifest.sidePanel?.form?.fields ?? []);
	const isReady = $derived(plugin.status === 'active');
	const isBusy = $derived(plugin.status === 'activating' || plugin.status === 'running');

	async function activatePlugin() {
		await activationGate.requestActivate(plugin.manifest.id);
	}

	async function runPlugin() {
		validationError = null;
		const result = coercePluginFieldValues(fields, plugin.sidePanelValues);
		if (!result.ok) {
			validationError = result.error;
			return;
		}

		plugin.sidePanelValues = result.values;
		try {
			await editorCtx.pluginCoordinator.runWithOptions(plugin.manifest.id, {
				params: result.values,
				sidePanelInput: { type: 'form' },
			});
		} catch (e) {
			// Run errors show in the output section; pre-run guard failures
			// (no design, unapplied result, …) would otherwise be silent.
			if (plugin.status !== 'error') {
				validationError = e instanceof Error ? e.message : String(e);
			}
		}
	}
</script>

<div class="flex h-full min-h-0 flex-col overflow-hidden text-sm">
	<div class="border-b border-border px-3 py-3">
		<h2 class="truncate text-sm font-semibold text-foreground">{panelTitle}</h2>
		{#if plugin.manifest.description}
			<p class="mt-1 text-[11px] leading-5 text-muted-foreground">{plugin.manifest.description}</p>
		{/if}
	</div>

	<div class="min-h-0 flex-1 overflow-y-auto px-3 py-3">
		<div class="flex flex-col gap-4">
			<div class="rounded border border-border bg-background px-3 py-3">
				<div class="mb-3 flex items-center justify-between gap-2">
					<div>
						<div class="text-xs font-semibold tracking-wide text-foreground uppercase">Input</div>
						<div class="text-[11px] text-muted-foreground">
							Host-rendered form declared in the plugin manifest.
						</div>
					</div>
					{#if !isReady}
						<Button
							variant="outline"
							size="sm"
							class="h-7 px-2 text-xs"
							onclick={activatePlugin}
							disabled={isBusy}
						>
							{#if plugin.status === 'activating'}
								<LoaderCircle size={12} class="animate-spin" />
								Activating
							{:else}
								Activate
							{/if}
						</Button>
					{/if}
				</div>

				<PluginFieldInputs {fields} values={plugin.sidePanelValues} />

				{#if validationError}
					<p class="mt-3 text-xs text-destructive">{validationError}</p>
				{/if}

				<div class="mt-4 flex justify-end gap-2">
					{#if plugin.status === 'running'}
						<Button
							variant="outline"
							class="h-8 gap-1 px-3 text-xs"
							onclick={() => editorCtx.pluginCoordinator.stopPlugin(plugin.manifest.id)}
						>
							<Square size={12} />
							Stop
						</Button>
					{/if}
					<Button
						class="h-8 gap-1 px-3 text-xs"
						onclick={runPlugin}
						disabled={!isReady || plugin.status === 'running'}
					>
						{#if plugin.status === 'running'}
							<LoaderCircle size={12} class="animate-spin" />
							Running
						{:else}
							<Play size={12} />
							{submitLabel}
						{/if}
					</Button>
				</div>
			</div>

			<div class="rounded border border-border bg-background px-3 py-3">
				<div class="mb-3 text-xs font-semibold tracking-wide text-foreground uppercase">Output</div>
				<PluginRunOutput {plugin} />
			</div>
		</div>
	</div>
</div>

<PluginActivationConfirmDialog gate={activationGate} />
