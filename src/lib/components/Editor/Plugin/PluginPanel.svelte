<script lang="ts">
	import { help } from '$lib/components/help/help';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import { getEditorDocumentSession } from '../context/EditorDocumentSession.svelte';
	import type { PythonPlugin } from '$lib/plugin/types';
	import { SvelteSet } from 'svelte/reactivity';
	import { toPluginSidePanelId } from '../sidePanels';
	import {
		Ellipsis,
		Play,
		Square,
		Trash2,
		RotateCcw,
		FolderOpen,
		FilePen,
		Download,
	} from '@lucide/svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { exportOwnedPlugin, needsBackup } from '$lib/plugin/ownedPluginActions';
	import PluginRunDialog from './PluginRunDialog.svelte';
	import PluginActivationConfirmDialog from './PluginActivationConfirmDialog.svelte';
	import { PluginActivationGate } from './PluginActivationGate.svelte';
	import { classifyEnv } from '$lib/plugin/envClassification';
	import { prepareLocalZipInstall, MAX_PLUGIN_ZIP_BYTES } from '$lib/plugin/PluginInstaller';
	import { toast } from 'svelte-sonner';
	import PluginHubPanel from './PluginHubPanel.svelte';
	import PluginDevPanel from './PluginDevPanel.svelte';
	import PluginRunOutput from './PluginRunOutput.svelte';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import PluginTile, { type PluginTileStatus } from './PluginTile.svelte';
	import PluginRowDetails from './PluginRowDetails.svelte';

	const editorCtx = getEditorViewContext();
	const registry = $derived(editorCtx.pluginRegistry);
	const coordinator = $derived(editorCtx.pluginCoordinator);
	const session = getEditorDocumentSession();

	// Linked (dev mode) plugins live in the Dev tab.
	let plugins = $derived(registry.all.filter((p) => p.origin !== 'linked'));

	let pendingRunPlugin: PythonPlugin | null = $state(null);
	let activeTab: string = $state('mine');
	const expandedPluginIds = new SvelteSet<string>();

	function toggleExpanded(id: string) {
		if (!expandedPluginIds.delete(id)) expandedPluginIds.add(id);
	}

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

	function hasRunOutput(plugin: PythonPlugin): boolean {
		return (
			plugin.logs.length > 0 ||
			Object.keys(plugin.artifacts).length > 0 ||
			plugin.pluginResult !== null
		);
	}

	function canReset(plugin: PythonPlugin): boolean {
		const isRunError =
			plugin.status === 'error' && (plugin.resolvedCode !== null || plugin.resolvedZipData != null);
		return isRunError || (plugin.status === 'active' && hasRunOutput(plugin));
	}

	let pendingRemove: PythonPlugin | null = $state(null);

	function removePlugin(plugin: PythonPlugin) {
		// A plugin made here has no other copy unless the user exported it.
		if (plugin.authoring) {
			pendingRemove = plugin;
			return;
		}
		registry.remove(plugin.manifest.id);
	}

	function confirmRemove() {
		const plugin = pendingRemove;
		pendingRemove = null;
		if (!plugin) return;
		editorCtx.closePluginEditor(plugin.manifest.id);
		registry.remove(plugin.manifest.id);
	}

	async function exportPlugin(plugin: PythonPlugin) {
		try {
			await exportOwnedPlugin(registry, plugin.manifest.id);
		} catch (e) {
			toast.error("Couldn't export the plugin", {
				description: e instanceof Error ? e.message : String(e),
			});
		}
	}

	function toggleBuiltinEnabled(plugin: PythonPlugin, enabled: boolean) {
		registry.setEnabled(plugin.manifest.id, enabled);
	}

	function tileStatus(plugin: PythonPlugin): PluginTileStatus | null {
		switch (plugin.status) {
			case 'activating':
			case 'running':
				return 'busy';
			case 'active':
				return 'ready';
			case 'error':
				return 'error';
			case 'needs-reinstall':
				return 'warning';
			default:
				return null;
		}
	}

	const STATUS_LABELS: Partial<Record<PythonPlugin['status'], string>> = {
		activating: 'Activating',
		running: 'Running',
		active: 'Active: ready to run',
		error: 'Error',
		'needs-reinstall': 'Needs reinstall',
	};

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

{#snippet pluginRow(plugin: PythonPlugin)}
	{@const isDisabledBuiltin = plugin.origin === 'builtin' && !plugin.enabled}
	{@const isExpanded = expandedPluginIds.has(plugin.manifest.id)}
	{@const isCustomEnv = plugin.origin !== 'linked' && classifyEnv(plugin.manifest) === 'custom'}
	{@const backupDue = !!plugin.authoring && needsBackup(plugin)}
	<!-- A collapsed card shows only what needs attention: output, errors, a running plugin's Stop. -->
	{@const showOutput =
		isExpanded ||
		hasRunOutput(plugin) ||
		plugin.status === 'error' ||
		coordinator.pendingApply?.pluginId === plugin.manifest.id}
	{@const showActions = isExpanded || plugin.status === 'running'}
	<div
		class="mb-1.5 rounded-md border border-border bg-card p-2 transition-colors hover:border-foreground/20"
		class:opacity-50={isDisabledBuiltin}
	>
		<div class="flex items-start gap-1.5">
			<button
				type="button"
				class="flex min-w-0 flex-1 items-start gap-2.5 text-left"
				aria-expanded={isExpanded}
				onclick={() => toggleExpanded(plugin.manifest.id)}
				{@attach help({
					title: 'Plugin details',
					text: 'Click a plugin to show its details, any papers its author asks you to cite, and its Activate, Run and Edit buttons.',
					doc: 'plugins-for-users',
				})}
			>
				<PluginTile
					manifest={plugin.manifest}
					iconSvg={plugin.iconSvg}
					status={plugin.enabled ? tileStatus(plugin) : null}
					statusLabel={STATUS_LABELS[plugin.status]}
				/>
				<div class="min-w-0 flex-1">
					<!-- Inline flow: meta follows the last line of a wrapped name. -->
					<div class="text-xs leading-snug">
						<span class="font-medium break-words text-foreground">{plugin.manifest.name}</span>
						{#if plugin.origin !== 'linked'}
							<span class="ml-1.5 text-[10px] whitespace-nowrap text-muted-foreground"
								>{plugin.manifest.version}</span
							>
						{/if}
						{#if plugin.authoring}
							<span
								class="ml-1.5 inline-block rounded bg-emerald-100 px-1.5 align-[1px] text-[10px] leading-4 whitespace-nowrap text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
								title="You made this plugin in this browser, so you can edit it.">Mine</span
							>
						{:else if plugin.origin === 'builtin'}
							<span class="ml-1.5 text-[10px] whitespace-nowrap text-muted-foreground">· Core</span>
						{:else if plugin.origin === 'linked'}
							<span
								class="ml-1.5 text-[10px] whitespace-nowrap text-violet-700 dark:text-violet-300"
								title="Linked from a folder on your computer; each run reads it again."
								>dev · linked</span
							>
						{/if}
						{#if isCustomEnv}
							<span
								class="ml-1.5 text-[10px] whitespace-nowrap text-amber-700 dark:text-amber-300"
								title="Custom environment: only one custom-environment plugin can be active at a time"
								>· custom env</span
							>
						{/if}
					</div>
					{#if plugin.manifest.description}
						<p
							class="mt-0.5 text-[11px] leading-snug text-muted-foreground {isExpanded
								? ''
								: 'truncate'}"
							title={isExpanded ? undefined : plugin.manifest.description}
						>
							{plugin.manifest.description}
						</p>
					{/if}
				</div>
			</button>
			{#if plugin.origin === 'builtin'}
				<Switch
					checked={plugin.enabled}
					onCheckedChange={(v) => toggleBuiltinEnabled(plugin, v)}
					class="mt-1 h-4 w-7 shrink-0"
					title={plugin.enabled ? 'Disable this plugin' : 'Enable this plugin'}
					{@attach help({
						title: 'Enable',
						text: 'Turn this built-in plugin on or off. Off hides its panel and actions.',
					})}
				/>
			{/if}
			{#if plugin.origin === 'user'}
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								variant="ghost"
								size="icon"
								class="relative size-6 shrink-0"
								title={backupDue
									? `More actions. v${plugin.manifest.version} isn't backed up.`
									: 'More actions'}
								aria-label="More actions"
							>
								<Ellipsis size={12} />
								{#if backupDue}
									<span class="absolute top-1 right-1 size-1.5 rounded-full bg-amber-500"></span>
								{/if}
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="end" class="w-48">
						{#if plugin.authoring}
							<DropdownMenu.Item
								class={backupDue ? 'text-amber-700 dark:text-amber-300' : ''}
								onclick={() => void exportPlugin(plugin)}
							>
								<Download size={12} />
								{backupDue ? 'Export zip · not backed up' : 'Export zip'}
							</DropdownMenu.Item>
						{/if}
						<DropdownMenu.Item variant="destructive" onclick={() => removePlugin(plugin)}>
							<Trash2 size={12} />
							Remove
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			{/if}
		</div>

		{#if isExpanded}
			<div class="mt-2">
				<PluginRowDetails {plugin} />
			</div>
		{/if}

		{#if plugin.enabled}
			<!-- Legacy-format notice -->
			{#if plugin.status === 'needs-reinstall'}
				<div class="mt-2 text-xs text-amber-600">
					Plugin format changed — re-import this plugin as a zip (or reinstall it from the Hub).
				</div>
			{/if}

			{#if !plugin.manifest.sidePanel && showOutput}
				<div class="mt-2">
					<PluginRunOutput {plugin} />
				</div>
			{/if}

			{#if showActions}
				<div class="mt-2 flex flex-wrap gap-1.5">
					{#if plugin.manifest.sidePanel}
						<Button
							variant="outline"
							size="sm"
							class="h-6 gap-1 border-blue-200 bg-blue-50 px-2 text-xs text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300 dark:hover:bg-blue-900"
							onclick={() => openPluginSidePanel(plugin)}
							{@attach help({
								title: 'Open panel',
								text: "Open this plugin's own side panel.",
							})}
						>
							Open panel
						</Button>
					{/if}
					{#if !plugin.manifest.sidePanel && (plugin.status === 'registered' || (plugin.status === 'error' && !plugin.resolvedCode && !plugin.resolvedZipData) || plugin.status === 'deactivated')}
						<Button
							variant="outline"
							size="sm"
							class="h-6 gap-1 px-2 text-xs"
							onclick={() => activatePlugin(plugin)}
							{@attach help({
								title: 'Activate',
								text: 'Load the plugin into the Python runtime so it can run.',
							})}
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
								{@attach help({
									title: 'Run',
									text: 'Run the plugin on the open design. Any design change it proposes waits for you to apply it.',
								})}
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
										<span class="self-center text-[10px] text-amber-500">no active region</span>
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
							{@attach help({ title: 'Stop', text: 'Stop the running plugin.' })}
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
							{@attach help({
								title: 'Reset',
								text: 'Clear the output, discard a result not yet applied, and return an errored run to ready.',
							})}
						>
							<RotateCcw size={11} />
							Reset
						</Button>
					{/if}
					{#if plugin.authoring && !plugin.manifest.sidePanel}
						<Button
							variant="outline"
							size="sm"
							class="h-6 gap-1 px-2 text-xs"
							onclick={() => editorCtx.openPluginEditor(plugin.manifest.id)}
							title="Edit this plugin's code"
							{@attach help({
								title: 'Edit',
								text: 'Open this plugin in its own editor to change, test and save new versions.',
								doc: 'script-lab',
							})}
						>
							<FilePen size={11} />
							Edit
						</Button>
					{/if}
				</div>
			{/if}
		{/if}
	</div>
{/snippet}

<div
	class="flex h-full flex-col overflow-hidden text-sm"
	{@attach help({
		area: true,
		title: 'Plugins',
		text: 'Python tools that generate, edit or analyse designs, run in your browser. Install them from the Hub or a .zip file.',
		doc: 'plugins-for-users',
	})}
>
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
					{@attach help({
						title: 'Import zip',
						text: 'Install a plugin from a .zip file on your computer.',
						doc: 'plugins-for-users',
					})}
				>
					<FolderOpen size={13} />
					Import zip
				</Button>
			</div>
		{/if}
	</div>

	<Tabs.Root bind:value={activeTab} class="flex flex-1 flex-col overflow-hidden">
		<Tabs.List variant="line" class="w-full border-b border-border">
			<Tabs.Trigger
				value="mine"
				class="flex-1 text-xs"
				{@attach help({
					title: 'My Plugins',
					text: 'Installed plugins: activate, run, reset or remove them.',
				})}>My Plugins</Tabs.Trigger
			>
			<Tabs.Trigger
				value="hub"
				class="flex-1 text-xs"
				{@attach help({ title: 'Hub', text: 'Plugins you can install with one click.' })}
				>Hub</Tabs.Trigger
			>
			<Tabs.Trigger
				value="dev"
				class="flex-1 text-xs"
				{@attach help({
					title: 'Dev',
					text: 'Plugin dev mode: link plugin folders from your computer and run them as you edit.',
				})}>Dev</Tabs.Trigger
			>
		</Tabs.List>

		<Tabs.Content value="dev" class="mt-0 flex-1 overflow-hidden p-0">
			<PluginDevPanel {pluginRow} />
		</Tabs.Content>

		<Tabs.Content value="hub" class="mt-0 flex-1 overflow-hidden p-0">
			<PluginHubPanel onInstalled={() => (activeTab = 'mine')} />
		</Tabs.Content>

		<Tabs.Content value="mine" class="mt-0 flex-1 overflow-hidden p-0">
			<!-- Plugin list -->
			<div class="h-full flex-1 overflow-y-auto px-3 py-2">
				{#if plugins.length === 0}
					<div class="px-4 py-6 text-center text-xs text-gray-400">
						No plugins installed.<br />
						Install one from the <strong>Hub</strong>, or click <strong>Import zip</strong> to
						install a plugin <code>.zip</code> from your computer.
					</div>
				{:else}
					{#each plugins as plugin (plugin.manifest.id)}
						{@render pluginRow(plugin)}
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

{#if pendingRemove}
	{@const plugin = pendingRemove}
	<Dialog.Root
		open={true}
		onOpenChange={(v) => {
			if (!v) pendingRemove = null;
		}}
	>
		<Dialog.Content class="sm:max-w-sm">
			<Dialog.Header>
				<Dialog.Title>Remove "{plugin.manifest.name}"?</Dialog.Title>
				<Dialog.Description>
					You made this plugin in this browser. Removing it deletes the only copy here. Export it
					first if you may want it back.
				</Dialog.Description>
			</Dialog.Header>
			{#if plugin.draftCode !== null}
				<p
					class="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
				>
					It has unsaved edits. Export saves v{plugin.manifest.version} without them; to keep them, cancel
					and use <strong>Save version</strong> in its editor first.
				</p>
			{/if}
			<Dialog.Footer>
				<Button variant="outline" onclick={() => (pendingRemove = null)}>Cancel</Button>
				<Button variant="outline" onclick={() => void exportPlugin(plugin)}>
					<Download size={13} />
					Export first
				</Button>
				<Button variant="destructive" onclick={confirmRemove}>Remove</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
{/if}
