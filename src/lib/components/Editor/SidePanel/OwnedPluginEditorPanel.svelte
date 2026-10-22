<script lang="ts">
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Download, Image, Save, Undo2, X } from '@lucide/svelte';
	import PluginCodeEditorShell from './PluginCodeEditorShell.svelte';
	import PluginRunOutput, { hasRunOutput } from '../Plugin/PluginRunOutput.svelte';
	import PluginActivationConfirmDialog from '../Plugin/PluginActivationConfirmDialog.svelte';
	import PluginIconPicker from '../Plugin/PluginIconPicker.svelte';
	import { PluginActivationGate } from '../Plugin/PluginActivationGate.svelte';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { help } from '$lib/components/help/help';
	import { SCRIPT_LAB_BLANK_TEMPLATE } from '$lib/plugin/scriptLabManifest';
	import { readPluginPy } from '$lib/plugin/ownedPlugins';
	import {
		changeOwnedPluginIcon,
		exportOwnedPlugin,
		loadOwnedPluginZip,
		needsBackup,
		saveOwnedPluginVersion,
	} from '$lib/plugin/ownedPluginActions';
	import { EditorCodeSaver } from '$lib/plugin/EditorCodeSaver.svelte';
	import type { PythonPlugin } from '$lib/plugin/types';

	let { plugin }: { plugin: PythonPlugin } = $props();

	const editorCtx = getEditorViewContext();
	// The host keys this component by plugin id, so the id is fixed for its lifetime.
	const pluginId = untrack(() => plugin.manifest.id);

	/** plugin.py of the saved version; null until it has loaded from IndexedDB. */
	let savedCode: string | null = $state(null);
	/** Plugin instance `savedCode` was loaded for. Any install replaces the instance, even one
	 *  that keeps the version number, so this (not the version) decides when to reload. */
	let loadedFor: PythonPlugin | null = null;
	let loadError: string | null = $state(null);
	let saving = $state(false);
	let confirmDiscard = $state(false);
	let iconDialogOpen = $state(false);
	let iconChoice: string | null = $state(null);

	$effect(() => {
		const target = plugin;
		if (target === loadedFor) return;
		loadedFor = target;
		loadOwnedPluginZip(pluginId)
			.then((zip) => {
				if (loadedFor === target) savedCode = readPluginPy(zip);
			})
			.catch((e) => (loadError = e instanceof Error ? e.message : String(e)));
	});

	const code = $derived(plugin.draftCode ?? savedCode ?? '');
	const hasDraft = $derived(plugin.draftCode !== null);
	const executionState = $derived(
		plugin.status === 'running' ? 'running' : plugin.status === 'error' ? 'stopped' : 'ready'
	);
	const outputEmpty = $derived(
		!hasRunOutput(plugin, editorCtx.pluginCoordinator.pendingApply?.pluginId ?? null)
	);

	const saver = new EditorCodeSaver((next) =>
		editorCtx.pluginRegistry.persistDraft(pluginId, next === savedCode ? null : next)
	);

	function setCode(next: string) {
		// The editor is read-only while saving; this also covers Clear and Discard.
		if (saving) return;
		plugin.draftCode = next === savedCode ? null : next;
		saver.schedule(next);
	}

	const activationGate = new PluginActivationGate(
		() => editorCtx.pluginCoordinator,
		() => editorCtx.pluginRegistry
	);

	let runPending = $state(false);

	async function handleRun(current: string) {
		// Freeze the draft before activation so later edits cannot alter this run.
		const draft = current;
		runPending = true;
		try {
			if (plugin.status !== 'active') {
				const activated = await activationGate.requestActivate(pluginId);
				if (!activated) return;
			}
			await editorCtx.pluginCoordinator.runWithOptions(pluginId, { draftCode: draft });
		} catch (e) {
			if (plugin.status !== 'error') {
				toast.error('Plugin run failed', {
					description: e instanceof Error ? e.message : String(e),
				});
			}
		} finally {
			runPending = false;
		}
	}

	// The editor is read-only from here until the save settles, so the draft saved is the draft
	// shown: an edit typed meanwhile would otherwise be cleared along with the saved draft.
	async function saveVersion() {
		if (!hasDraft || saving) return;
		const draft = code;
		saving = true;
		try {
			await saver.flush();
			const saved = await saveOwnedPluginVersion(
				{ registry: editorCtx.pluginRegistry, coordinator: editorCtx.pluginCoordinator },
				pluginId,
				draft
			);
			loadedFor = saved;
			savedCode = draft;
			toast.success(`Saved ${saved.manifest.name} v${saved.manifest.version}`);
		} catch (e) {
			toast.error("Couldn't save the plugin", {
				description: e instanceof Error ? e.message : String(e),
			});
		} finally {
			saving = false;
		}
	}

	async function discardChanges() {
		confirmDiscard = false;
		if (savedCode === null) return;
		setCode(savedCode);
		await saver.flush();
	}

	function openIconDialog() {
		iconChoice = plugin.iconSvg;
		iconDialogOpen = true;
	}

	async function saveIcon() {
		if (saving) return;
		iconDialogOpen = false;
		if (iconChoice === plugin.iconSvg) return;
		saving = true;
		try {
			await saver.flush();
			const saved = await changeOwnedPluginIcon(
				{ registry: editorCtx.pluginRegistry, coordinator: editorCtx.pluginCoordinator },
				pluginId,
				iconChoice
			);
			loadedFor = saved;
			toast.success(`Saved ${saved.manifest.name} v${saved.manifest.version} with the new icon`);
		} catch (e) {
			toast.error("Couldn't change the icon", {
				description: e instanceof Error ? e.message : String(e),
			});
		} finally {
			saving = false;
		}
	}

	async function exportZip() {
		try {
			await exportOwnedPlugin(editorCtx.pluginRegistry, pluginId);
		} catch (e) {
			toast.error("Couldn't export the plugin", {
				description: e instanceof Error ? e.message : String(e),
			});
		}
	}

	function handleDownload(current: string) {
		const blob = new Blob([current], { type: 'text/x-python' });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = 'plugin.py';
		anchor.click();
		setTimeout(() => URL.revokeObjectURL(url), 0);
	}

	const poppedOut = {
		get: () => editorCtx.poppedOutPluginPanels.has(pluginId),
		set: (next: boolean) => {
			if (next) editorCtx.poppedOutPluginPanels.add(pluginId);
			else editorCtx.poppedOutPluginPanels.delete(pluginId);
		},
	};
	$effect(() => () => poppedOut.set(false));

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

<!-- Mount the editor only with the saved code in hand: an editor created empty reports its
     empty value back after the load, which would be stored as an empty draft. -->
{#if savedCode !== null}
	<PluginCodeEditorShell
		title={plugin.manifest.name}
		description={plugin.manifest.description ?? 'A plugin you made from Script Lab.'}
		filename="plugin.py"
		popOutKey={pluginId}
		{code}
		{executionState}
		{outputEmpty}
		helpDoc="script-lab"
		runDisabled={plugin.status === 'activating' || runPending || saving}
		stopDisabled={plugin.status !== 'running'}
		onRun={handleRun}
		onStop={() => editorCtx.pluginCoordinator.stopPlugin(pluginId)}
		onClearScript={() => setCode(SCRIPT_LAB_BLANK_TEMPLATE)}
		onResetPlugin={() => editorCtx.pluginCoordinator.resetPlugin(pluginId)}
		onDownload={handleDownload}
		onCodeChange={setCode}
		readOnly={saving}
		bind:poppedOut={poppedOut.get, poppedOut.set}
	>
		{#snippet titleTail()}
			<span
				class="rounded px-1.5 py-0.5 text-[10px] {hasDraft
					? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
					: 'bg-muted text-muted-foreground'}"
				title={hasDraft
					? 'Runs here use your edits. Running from the Plugins list uses the saved version.'
					: undefined}
			>
				v{plugin.manifest.version}{hasDraft ? ' · unsaved changes' : ''}
			</span>
			{#if saver.state === 'error'}
				<button
					class="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300"
					title="Your edits couldn't be stored in this browser ({saver.errorMessage}). Click to retry."
					onclick={() => void saver.retry()}
				>
					Not saved
				</button>
			{/if}
			<button
				class="ml-auto rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
				title="Close the editor (unsaved changes are kept)"
				aria-label="Close the editor"
				onclick={() => editorCtx.closePluginEditor(pluginId)}
			>
				<X size={12} />
			</button>
		{/snippet}
		{#snippet toolbarTail()}
			<Button
				size="xs"
				class="h-6 gap-1 px-1.5 text-[11px]"
				disabled={!hasDraft || saving || plugin.status === 'running'}
				onclick={() => void saveVersion()}
				title="Save your edits as the next version"
				{@attach help({
					title: 'Save version',
					text: 'Save your edits as the next version. Running from the Plugins list uses the saved version.',
					doc: 'script-lab',
				})}
			>
				<Save size={11} />
				{saving ? 'Saving…' : 'Save version'}
			</Button>
			<Button
				size="xs"
				variant="outline"
				class="h-6 gap-1 px-1.5 text-[11px]"
				disabled={!hasDraft || saving}
				onclick={() => (confirmDiscard = true)}
				title="Go back to the saved version"
				{@attach help({
					title: 'Discard',
					text: 'Drop your edits and go back to the saved version.',
				})}
			>
				<Undo2 size={11} />
				Discard
			</Button>
			<Button
				size="xs"
				variant="outline"
				class="h-6 gap-1 px-1.5 text-[11px] {needsBackup(plugin)
					? 'border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300'
					: ''}"
				onclick={() => void exportZip()}
				title={needsBackup(plugin)
					? `v${plugin.manifest.version} isn't backed up. Download it as a zip.`
					: `Download v${plugin.manifest.version} as a zip`}
				{@attach help({
					title: 'Export',
					text: 'Download the saved version as a plugin zip. Clearing browser data deletes the in-browser copy; import the zip to restore it.',
					doc: 'script-lab',
				})}
			>
				<Download size={11} />
				Export
			</Button>
			<Button
				size="xs"
				variant="outline"
				class="h-6 gap-1 px-1.5 text-[11px]"
				disabled={saving || plugin.status === 'running'}
				onclick={openIconDialog}
				title="Change the plugin's icon"
				{@attach help({
					title: 'Icon',
					text: 'Pick or upload the icon shown in the sidebar and the Plugins list. Saves a new version; your unsaved edits stay.',
					doc: 'script-lab',
				})}
			>
				<Image size={11} />
				Icon
			</Button>
		{/snippet}
		{#snippet output()}
			<div class="h-full min-h-0 overflow-y-auto px-3 py-3">
				{#if loadError}
					<p class="mb-3 text-[11px] text-red-500">Couldn't load the saved plugin: {loadError}</p>
				{/if}
				<PluginRunOutput {plugin} />
			</div>
		{/snippet}
	</PluginCodeEditorShell>
{:else}
	<div
		class="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground"
	>
		{loadError ? `Couldn't load the saved plugin: ${loadError}` : 'Loading…'}
	</div>
{/if}

<PluginActivationConfirmDialog gate={activationGate} />

<Dialog.Root bind:open={confirmDiscard}>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Discard changes?</Dialog.Title>
			<Dialog.Description>
				Your edits are dropped and the editor goes back to v{plugin.manifest.version}.
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (confirmDiscard = false)}>Cancel</Button>
			<Button variant="destructive" onclick={() => void discardChanges()}>Discard</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={iconDialogOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Plugin icon</Dialog.Title>
			<Dialog.Description>
				Shown in the sidebar and the Plugins list. Changing it saves v{plugin.manifest.version} as a new
				version; your unsaved edits stay.
			</Dialog.Description>
		</Dialog.Header>
		<PluginIconPicker bind:value={iconChoice} />
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (iconDialogOpen = false)}>Cancel</Button>
			<Button disabled={iconChoice === plugin.iconSvg} onclick={() => void saveIcon()}>
				Save icon
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
