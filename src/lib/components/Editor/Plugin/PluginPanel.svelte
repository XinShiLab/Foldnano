<script lang="ts">
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import { getEditorDocumentSession } from '../context/EditorDocumentSession.svelte';
	import type { PythonPlugin } from '$lib/plugin/types';
	import { toPluginSidePanelId } from '../sidePanels';
	import {
		Play,
		Square,
		Trash2,
		CircleAlert,
		CircleCheckBig,
		Loader,
		RotateCcw,
		FolderOpen,
	} from '@lucide/svelte';
	import PluginRunDialog from './PluginRunDialog.svelte';
	import PluginActivationConfirmDialog from './PluginActivationConfirmDialog.svelte';
	import { PluginActivationGate } from './PluginActivationGate.svelte';
	import { classifyEnv } from '$lib/plugin/envClassification';
	import { prepareLocalZipInstall, MAX_PLUGIN_ZIP_BYTES } from '$lib/plugin/PluginInstaller';
	import { toast } from 'svelte-sonner';
	import PluginHubPanel from './PluginHubPanel.svelte';
	import PluginRunOutput from './PluginRunOutput.svelte';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';

	const editorCtx = getEditorViewContext();
	const registry = $derived(editorCtx.pluginRegistry);
	const coordinator = $derived(editorCtx.pluginCoordinator);
	const session = getEditorDocumentSession();

	let plugins = $derived(registry.all);

	let pendingRunPlugin: PythonPlugin | null = $state(null);
	let activeTab: string = $state('mine');

	// ---------------------------------------------------------------------------
	// Plugin actions
	// ---------------------------------------------------------------------------
	const activationGate = new PluginActivationGate(
		() => editorCtx.pluginCoordinator,
		() => registry
	);

	async function activatePlugin(plugin: PythonPlugin) {
		await activationGate.requestActivate(plugin.manifest.id);
	}

	async function runPlugin(plugin: PythonPlugin) {
		if ((plugin.manifest.parameters ?? []).length > 0) {
			pendingRunPlugin = plugin;
		} else {
			await runNow(plugin.manifest.id);
		}
	}

	async function handleRunWithParams(values: Record<string, unknown>) {
		if (!pendingRunPlugin) return;
		pendingRunPlugin.paramValues = values;
		const id = pendingRunPlugin.manifest.id;
		pendingRunPlugin = null;
		await runNow(id);
	}

	async function runNow(pluginId: string) {
		try {
			await editorCtx.pluginCoordinator.run(pluginId);
		} catch (e) {
			// Run errors land on the plugin row via status='error'; pre-run guard
			// failures (no design, unapplied result, …) would otherwise be silent.
			if (registry.get(pluginId)?.status !== 'error') {
				toast.error('Plugin run failed', {
					description: e instanceof Error ? e.message : String(e),
				});
			}
		}
	}

	function resetPlugin(plugin: PythonPlugin) {
		coordinator.resetPlugin(plugin.manifest.id);
	}

	function canReset(plugin: PythonPlugin): boolean {
		const hasRunOutput =
			plugin.logs.length > 0 ||
			Object.keys(plugin.artifacts).length > 0 ||
			plugin.pluginResult !== null;
		const isRunError =
			plugin.status === 'error' && (plugin.resolvedCode !== null || plugin.resolvedZipData != null);
		return isRunError || (plugin.status === 'active' && hasRunOutput);
	}

	function removePlugin(plugin: PythonPlugin) {
		registry.remove(plugin.manifest.id);
	}

	function toggleBuiltinEnabled(plugin: PythonPlugin, enabled: boolean) {
		registry.setEnabled(plugin.manifest.id, enabled);
	}

	function statusIcon(plugin: PythonPlugin) {
		switch (plugin.status) {
			case 'activating':
			case 'running':
				return Loader;
			case 'active':
				return CircleCheckBig;
			case 'error':
			case 'needs-reinstall':
				return CircleAlert;
			default:
				return null;
		}
	}

	function statusColor(plugin: PythonPlugin): string {
		switch (plugin.status) {
			case 'active':
				return 'text-green-600';
			case 'error':
				return 'text-red-500';
			case 'needs-reinstall':
				return 'text-amber-500';
			case 'activating':
			case 'running':
				return 'text-blue-500';
			default:
				return 'text-gray-400';
		}
	}

	function openPluginSidePanel(plugin: PythonPlugin) {
		editorCtx.openSidePanel(toPluginSidePanelId(plugin.manifest.id));
	}

	let localFileInput: HTMLInputElement;

	async function handleLocalPluginFile(event: Event) {
		const file = (event.target as HTMLInputElement).files?.[0];
		if (!file) return;
		// Reset so the same file can be re-selected after an error
		(event.target as HTMLInputElement).value = '';
		if (file.size > MAX_PLUGIN_ZIP_BYTES) {
			toast.error(`"${file.name}" exceeds the 50 MB limit.`);
			return;
		}
		// Nothing else shows this zip's details before it installs, so ask the user to review them.
		const outcome = await editorCtx.pluginInstallGate.requestInstall(
			() => prepareLocalZipInstall(file, registry),
			{ review: true }
		);
		if (outcome.status === 'installed') {
			toast.success('Local plugin installed.');
			activeTab = 'mine';
		} else if (outcome.status === 'error') {
			toast.error('Failed to install plugin', { description: outcome.message });
		}
	}
</script>

<div class="flex h-full flex-col overflow-hidden text-sm">
	<!-- Header -->
	<div class="flex h-9 items-center justify-between border-b border-border px-3 py-2">
		<span class="text-xs font-semibold tracking-wide uppercase">Plugins</span>
		{#if activeTab === 'mine'}
			<div class="flex gap-1">
				<Button
					variant="ghost"
					size="sm"
					class="h-6 gap-1 px-2 text-xs"
					onclick={() => localFileInput.click()}
					title="Install plugin from a local .zip file"
				>
					<FolderOpen size={13} />
					Import zip
				</Button>
			</div>
		{/if}
	</div>

	<Tabs.Root bind:value={activeTab} class="flex flex-1 flex-col overflow-hidden">
		<Tabs.List variant="line" class="w-full border-b border-border">
			<Tabs.Trigger value="mine" class="flex-1 text-xs">My Plugins</Tabs.Trigger>
			<Tabs.Trigger value="hub" class="flex-1 text-xs">Hub</Tabs.Trigger>
		</Tabs.List>

		<Tabs.Content value="hub" class="mt-0 flex-1 overflow-hidden p-0">
			<PluginHubPanel onInstalled={() => (activeTab = 'mine')} />
		</Tabs.Content>

		<Tabs.Content value="mine" class="mt-0 flex-1 overflow-hidden p-0">
			<!-- Plugin list -->
			<div class="h-full flex-1 overflow-y-auto">
				{#if plugins.length === 0}
					<div class="px-4 py-6 text-center text-xs text-gray-400">
						No plugins installed.<br />
						Install one from the <strong>Hub</strong>, or click <strong>Import zip</strong> to
						install a plugin <code>.zip</code> from your computer.
					</div>
				{:else}
					{#each plugins as plugin (plugin.manifest.id)}
						{@const Icon = statusIcon(plugin)}
						{@const isDisabledBuiltin = plugin.origin === 'builtin' && !plugin.enabled}
						<div
							class="border-b border-border px-3 py-2 hover:bg-muted"
							class:opacity-50={isDisabledBuiltin}
						>
							<div class="flex items-center gap-2">
								<!-- Status icon -->
								{#if Icon && plugin.enabled}
									<span class={statusColor(plugin)}>
										<Icon
											size={13}
											class={plugin.status === 'activating' || plugin.status === 'running'
												? 'animate-spin'
												: ''}
										/>
									</span>
								{:else}
									<span class="h-[13px] w-[13px]"></span>
								{/if}

								<!-- Name + version -->
								<span class="flex-1 truncate font-medium text-foreground"
									>{plugin.manifest.name}</span
								>
								{#if plugin.origin === 'builtin'}
									<span
										class="shrink-0 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700 dark:bg-blue-950 dark:text-blue-300"
									>
										Core
									</span>
									<Switch
										checked={plugin.enabled}
										onCheckedChange={(v) => toggleBuiltinEnabled(plugin, v)}
										class="h-4 w-7 shrink-0"
										title={plugin.enabled ? 'Disable this plugin' : 'Enable this plugin'}
									/>
								{/if}
								<span class="shrink-0 text-xs text-gray-400">{plugin.manifest.version}</span>
							</div>

							{#if plugin.enabled}
								<!-- Format + strategy + env badges -->
								{@const envTier = classifyEnv(plugin.manifest)}
								<div class="mt-1 ml-5 flex flex-wrap gap-1">
									<span
										class="max-w-full truncate rounded bg-muted px-1.5 py-0.5 text-[10px] whitespace-nowrap text-muted-foreground"
									>
										{plugin.manifest.format}
									</span>
									<span
										class="max-w-full truncate rounded bg-muted px-1.5 py-0.5 text-[10px] whitespace-nowrap text-muted-foreground"
										title={plugin.manifest.applyStrategy}
									>
										{plugin.manifest.applyStrategy}
									</span>
									<span
										class="max-w-full truncate rounded px-1.5 py-0.5 text-[10px] whitespace-nowrap {envTier ===
										'standard'
											? 'bg-muted text-muted-foreground'
											: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'}"
										title={envTier === 'standard'
											? 'Standard environment — shares the persistent Python runtime'
											: 'Custom environment — only one custom-environment plugin can be active at a time'}
									>
										{envTier} env
									</span>
								</div>

								<!-- Legacy-format notice -->
								{#if plugin.status === 'needs-reinstall'}
									<div class="mt-1 ml-5 text-xs text-amber-600">
										Plugin format changed — re-import this plugin as a zip (or reinstall it from the
										Hub).
									</div>
								{/if}

								{#if !plugin.manifest.sidePanel}
									<div class="mt-2 ml-5">
										<PluginRunOutput {plugin} />
									</div>
								{/if}

								<!-- Actions -->
								<div class="mt-2 ml-5 flex gap-1.5">
									{#if plugin.manifest.sidePanel}
										<Button
											variant="outline"
											size="sm"
											class="h-6 gap-1 border-blue-200 bg-blue-50 px-2 text-xs text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300 dark:hover:bg-blue-900"
											onclick={() => openPluginSidePanel(plugin)}
										>
											Open Panel
										</Button>
									{/if}
									{#if !plugin.manifest.sidePanel && (plugin.status === 'registered' || (plugin.status === 'error' && !plugin.resolvedCode && !plugin.resolvedZipData) || plugin.status === 'deactivated')}
										<Button
											variant="outline"
											size="sm"
											class="h-6 gap-1 px-2 text-xs"
											onclick={() => activatePlugin(plugin)}
										>
											Activate
										</Button>
									{:else if plugin.status === 'active'}
										{#if !plugin.manifest.sidePanel}
											{@const activeRegion = editorCtx.activeRegion}
											{@const isCadnanoPlugin = plugin.manifest.format === 'cadnano_json'}
											{@const activeRegionIdx = activeRegion
												? (session.currentDoc.parts[0]?.regions.indexOf(activeRegion) ?? -1)
												: -1}
											<Button
												variant="outline"
												size="sm"
												class="h-6 gap-1 border-blue-200 bg-blue-50 px-2 text-xs text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300 dark:hover:bg-blue-900"
												onclick={() => runPlugin(plugin)}
												disabled={coordinator.pendingApply?.pluginId === plugin.manifest.id}
												title={isCadnanoPlugin && activeRegion
													? `Run on region: ${activeRegion.name}`
													: undefined}
											>
												<Play size={11} />
												Run
												{#if isCadnanoPlugin}
													{#if activeRegion && activeRegionIdx >= 0}
														<span
															class="my-auto self-center text-[10px] text-muted-foreground"
															title={activeRegion.name}
														>
															on R{activeRegionIdx + 1}
														</span>
													{:else}
														<span class="self-center text-[10px] text-amber-500"
															>no active region</span
														>
													{/if}
												{/if}
											</Button>
										{/if}
									{/if}
									{#if plugin.status === 'running'}
										<Button
											variant="outline"
											size="sm"
											class="h-6 gap-1 px-2 text-xs"
											onclick={() => coordinator.stopPlugin(plugin.manifest.id)}
											title="Stop running plugin"
										>
											<Square size={11} />
											Stop
										</Button>
									{/if}
									{#if canReset(plugin)}
										<Button
											variant="outline"
											size="sm"
											class="h-6 gap-1 px-2 text-xs"
											onclick={() => resetPlugin(plugin)}
											title="Clear run output and reset to ready state"
										>
											<RotateCcw size={11} />
											Reset
										</Button>
									{/if}
									{#if plugin.origin !== 'builtin'}
										<Button
											variant="outline"
											size="sm"
											class="h-6 gap-1 px-2 text-xs hover:border-red-300 hover:text-red-500"
											onclick={() => removePlugin(plugin)}
											title="Remove plugin"
										>
											<Trash2 size={11} />
											Remove
										</Button>
									{/if}
								</div>
							{/if}
						</div>
					{/each}
				{/if}
			</div>
		</Tabs.Content>
	</Tabs.Root>
</div>

<input
	bind:this={localFileInput}
	type="file"
	accept=".zip"
	class="hidden"
	onchange={handleLocalPluginFile}
/>

<PluginActivationConfirmDialog gate={activationGate} />

{#if pendingRunPlugin}
	<PluginRunDialog
		plugin={pendingRunPlugin}
		onRun={handleRunWithParams}
		onCancel={() => (pendingRunPlugin = null)}
	/>
{/if}
