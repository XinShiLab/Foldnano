<script lang="ts">
	import { untrack } from 'svelte';
	import { Package } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { help } from '$lib/components/help/help';
	import PluginCodeEditorShell from './PluginCodeEditorShell.svelte';
	import ScriptLabReferenceCard from './ScriptLabReferenceCard.svelte';
	import MakePluginDialog from './MakePluginDialog.svelte';
	import PluginRunOutput, { hasRunOutput } from '../Plugin/PluginRunOutput.svelte';
	import PluginRunDialog from '../Plugin/PluginRunDialog.svelte';
	import PluginActivationConfirmDialog from '../Plugin/PluginActivationConfirmDialog.svelte';
	import { PluginActivationGate } from '../Plugin/PluginActivationGate.svelte';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import { toast } from 'svelte-sonner';
	import {
		SCRIPT_LAB_ANALYSIS_TEMPLATE,
		SCRIPT_LAB_BLANK_TEMPLATE,
		SCRIPT_LAB_FULL_API_DEMO_TEMPLATE,
		SCRIPT_LAB_MUTATION_TEMPLATE,
	} from '$lib/plugin/scriptLabManifest';
	import type { PythonPlugin } from '$lib/plugin/types';
	import { EditorCodeSaver } from '$lib/plugin/EditorCodeSaver.svelte';

	let { plugin }: { plugin: PythonPlugin } = $props();

	const editorCtx = getEditorViewContext();

	const panelTitle = $derived(plugin.manifest.sidePanel?.title ?? plugin.manifest.name);
	const panelDescription = $derived(
		plugin.manifest.description ?? 'Host-rendered code editor declared in the plugin manifest.'
	);
	const filename = $derived(plugin.manifest.sidePanel?.codeEditor?.filename ?? 'script.py');
	const initialCode = $derived(plugin.manifest.sidePanel?.codeEditor?.initialCode ?? '');
	const executionMode = $derived(plugin.manifest.sidePanel?.codeEditor?.execution ?? 'input');
	const isScriptLab = $derived(executionMode === 'entrypoint');
	const executionState = $derived(
		plugin.status === 'running' ? 'running' : plugin.status === 'error' ? 'stopped' : 'ready'
	);
	const showNoMutationNotice = $derived(
		Boolean(
			isScriptLab &&
			plugin.manifest.applyStrategy === 'replayMutationLog' &&
			plugin.status === 'active' &&
			plugin.lastRunMutationLogLength === 0 &&
			editorCtx.pluginCoordinator.pendingApply?.pluginId !== plugin.manifest.id
		)
	);

	const outputEmpty = $derived(
		!showNoMutationNotice &&
			!hasRunOutput(plugin, editorCtx.pluginCoordinator.pendingApply?.pluginId ?? null)
	);

	const activationGate = new PluginActivationGate(
		() => editorCtx.pluginCoordinator,
		() => editorCtx.pluginRegistry
	);

	async function activatePlugin() {
		await activationGate.requestActivate(plugin.manifest.id);
	}

	type PendingCodeRun = { readonly code: string; readonly filename: string };
	let pendingCodeRun: PendingCodeRun | null = $state(null);
	let showRunDialog = $state(false);
	let showMakePlugin = $state(false);

	/** Script Lab is the scratchpad again once its script lives on as a plugin. */
	function openNewPluginEditor(newPluginId: string) {
		plugin.sidePanelCode = initialCode;
		editorCtx.openPluginEditor(newPluginId);
	}

	async function handleRun(code: string) {
		plugin.sidePanelCode = code;
		// Freeze the request before activation so later editor changes cannot alter this run.
		pendingCodeRun = { code, filename };
		if (plugin.status !== 'active') {
			// false = activation is waiting on the eviction dialog (or was declined)
			const activated = await activationGate.requestActivate(plugin.manifest.id);
			if (!activated) {
				pendingCodeRun = null;
				return;
			}
		}
		if ((plugin.manifest.parameters ?? []).length > 0) {
			showRunDialog = true;
			return;
		}
		const request = pendingCodeRun;
		pendingCodeRun = null;
		await runCapturedRequest(request, {});
	}

	async function runCapturedRequest(request: PendingCodeRun, params: Record<string, unknown>) {
		try {
			await editorCtx.pluginCoordinator.runWithOptions(plugin.manifest.id, {
				params,
				sidePanelInput: {
					type: 'codeEditor',
					code: request.code,
					filename: request.filename,
				},
			});
		} catch (e) {
			// Run errors show in the output section; pre-run guard failures
			// (no design, empty editor, unapplied result, …) would otherwise be silent.
			if (plugin.status !== 'error') {
				toast.error('Plugin run failed', {
					description: e instanceof Error ? e.message : String(e),
				});
			}
		}
	}

	function handleRunConfirm(values: Record<string, unknown>) {
		const request = pendingCodeRun;
		pendingCodeRun = null;
		showRunDialog = false;
		if (!request) return;
		plugin.paramValues = values;
		void runCapturedRequest(request, values);
	}

	function handleRunCancel() {
		pendingCodeRun = null;
		showRunDialog = false;
	}

	function handleClearScript() {
		plugin.sidePanelCode = isScriptLab ? SCRIPT_LAB_BLANK_TEMPLATE : '';
	}

	function handleResetPlugin() {
		editorCtx.pluginCoordinator.resetPlugin(plugin.manifest.id);
	}

	function handleRestoreDefaultScript() {
		plugin.sidePanelCode = initialCode;
	}

	function handleDownload(code: string) {
		const blob = new Blob([code], { type: 'text/x-python' });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = filename;
		anchor.click();
		URL.revokeObjectURL(url);
	}

	function handleStop() {
		editorCtx.pluginCoordinator.stopPlugin(plugin.manifest.id);
	}

	function loadMutationTemplate() {
		plugin.sidePanelCode = SCRIPT_LAB_MUTATION_TEMPLATE;
	}

	function loadAnalysisTemplate() {
		plugin.sidePanelCode = SCRIPT_LAB_ANALYSIS_TEMPLATE;
	}

	function loadFullApiDemoTemplate() {
		plugin.sidePanelCode = SCRIPT_LAB_FULL_API_DEMO_TEMPLATE;
	}

	// The host keys this component by plugin id, so the id is fixed for its lifetime.
	const pluginId = untrack(() => plugin.manifest.id);
	const saver = new EditorCodeSaver((code) =>
		editorCtx.pluginCoordinator.persistEditorCode(pluginId, code)
	);
	const poppedOut = {
		get: () => editorCtx.poppedOutPluginPanels.has(pluginId),
		set: (next: boolean) => {
			if (next) editorCtx.poppedOutPluginPanels.add(pluginId);
			else editorCtx.poppedOutPluginPanels.delete(pluginId);
		},
	};
	// Unmounted for good (plugin removed or disabled): its popup has closed with it.
	$effect(() => () => poppedOut.set(false));

	let lastSeenCode: string | null = null;
	$effect(() => {
		const code = plugin.sidePanelCode;
		// The first value is what was loaded; only edits need saving.
		if (lastSeenCode !== null && code !== lastSeenCode) saver.schedule(code);
		lastSeenCode = code;
	});
	// Save a pending edit instead of dropping it when the panel closes or the page goes away.
	$effect(() => {
		const flush = () => void saver.flush();
		const onVisibilityChange = () => {
			if (document.visibilityState === 'hidden') flush();
		};
		document.addEventListener('visibilitychange', onVisibilityChange);
		window.addEventListener('pagehide', flush);
		return () => {
			document.removeEventListener('visibilitychange', onVisibilityChange);
			window.removeEventListener('pagehide', flush);
			flush();
		};
	});
</script>

<PluginCodeEditorShell
	title={panelTitle}
	description={panelDescription}
	{filename}
	popOutKey={plugin.manifest.id}
	code={plugin.sidePanelCode}
	{executionState}
	{outputEmpty}
	helpDoc={isScriptLab ? 'script-lab' : 'plugins-for-users'}
	runDisabled={plugin.status === 'activating' || pendingCodeRun !== null || showRunDialog}
	stopDisabled={plugin.status !== 'running'}
	onRun={handleRun}
	onStop={handleStop}
	onClearScript={handleClearScript}
	onResetPlugin={handleResetPlugin}
	onRestoreDefaultScript={handleRestoreDefaultScript}
	onDownload={handleDownload}
	onCodeChange={(code) => (plugin.sidePanelCode = code)}
	bind:poppedOut={poppedOut.get, poppedOut.set}
>
	{#snippet titleTail()}
		{#if saver.state === 'error'}
			<button
				class="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300"
				title="Your script couldn't be saved in this browser ({saver.errorMessage}). Click to retry, or download it."
				onclick={() => void saver.retry()}
			>
				Not saved
			</button>
		{/if}
		{#if plugin.status !== 'active' && plugin.status !== 'running' && plugin.status !== 'activating'}
			<button
				class="rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-primary transition-colors hover:bg-accent"
				onclick={activatePlugin}
			>
				Activate
			</button>
		{/if}
	{/snippet}
	{#snippet toolbarTail()}
		{#if isScriptLab}
			<Button
				size="xs"
				variant="outline"
				class="h-6 gap-1 px-1.5 text-[11px]"
				disabled={!plugin.sidePanelCode.trim()}
				onclick={() => (showMakePlugin = true)}
				title="Package this script as a plugin you can run from the Plugins panel and keep editing"
				{@attach help({
					title: 'Save as Plugin',
					text: 'Package this script as a plugin in the Plugins panel. You can run it from there and keep editing it in its own editor.',
					doc: 'script-lab',
				})}
			>
				<Package size={11} />
				Save as Plugin
			</Button>
			<ScriptLabReferenceCard
				onLoadMutationTemplate={loadMutationTemplate}
				onLoadAnalysisTemplate={loadAnalysisTemplate}
				onLoadFullApiDemoTemplate={loadFullApiDemoTemplate}
			/>
		{/if}
	{/snippet}
	{#snippet output()}
		<div class="flex h-full min-h-0 flex-col overflow-hidden">
			<div class="min-h-0 flex-1 overflow-y-auto px-3 py-3">
				{#if showNoMutationNotice}
					<div
						class="mb-3 rounded border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] text-sky-700 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-300"
					>
						This run completed without emitting a mutation log, so there is nothing to apply back to
						the design.
					</div>
				{/if}
				<PluginRunOutput {plugin} />
			</div>
		</div>
	{/snippet}
</PluginCodeEditorShell>

{#if showRunDialog}
	<PluginRunDialog {plugin} onRun={handleRunConfirm} onCancel={handleRunCancel} />
{/if}

<PluginActivationConfirmDialog gate={activationGate} />

{#if isScriptLab}
	<MakePluginDialog
		bind:open={showMakePlugin}
		code={plugin.sidePanelCode}
		onOpenEditor={openNewPluginEditor}
	/>
{/if}
