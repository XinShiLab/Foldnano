<script lang="ts">
	import { toast } from 'svelte-sonner';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import type { PickedFolderState } from '$lib/plugin/PluginDevMode.svelte';
	import {
		buildNewManifest,
		DEFAULT_NEW_PLUGIN_VERSION,
		manifestFileText,
		parseList,
		STRATEGIES_FOR_FORMAT,
		suggestPluginId,
		type ScaffoldFormat,
	} from '$lib/plugin/pluginScaffold';
	import type { ApplyStrategy, PythonPlugin } from '$lib/plugin/types';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';

	let {
		folder = $bindable(null),
		onCreated,
	}: {
		/** The picked folder with no fplugin.json; the dialog is open while this is set. */
		folder?: {
			dir: FileSystemDirectoryHandle;
			state: Extract<PickedFolderState, { kind: 'new' }>;
		} | null;
		onCreated: (plugin: PythonPlugin) => void;
	} = $props();

	const editorCtx = getEditorViewContext();

	const FORMAT_LABELS: Record<ScaffoldFormat, string> = {
		foldnano_mini: 'foldnano_mini: Python API, edits replayed as one undo step',
		foldnano_json: 'foldnano_json: the whole part as JSON',
		cadnano_json: 'cadnano_json: the active lattice region as cadnano JSON',
	};
	const STRATEGY_LABELS: Record<string, string> = {
		replayMutationLog: 'Edit the design',
		replayMutationLogInRegion: 'Edit the active region only',
		replacePartKeepAnnotationsWhereMatched: 'Replace the part, keep annotations where matched',
		replacePart: 'Replace the part',
		replaceRegionKeepAnnotationsWhereMatched: 'Replace the region, keep annotations where matched',
		replaceRegion: 'Replace the region',
		previewOnly: 'Report only, never change the design',
	};

	let name = $state('');
	let id = $state('');
	let idEdited = $state(false);
	let version = $state(DEFAULT_NEW_PLUGIN_VERSION);
	let description = $state('');
	let format: ScaffoldFormat = $state('foldnano_mini');
	let applyStrategy: ApplyStrategy = $state('replayMutationLog');
	let requirements = $state('');
	let network = $state('');
	let stubs = $state(true);
	let creating = $state(false);

	$effect(() => {
		if (!folder) return;
		// Each opening starts a fresh form, named after the folder.
		name = folder.dir.name;
		id = suggestPluginId(folder.dir.name);
		idEdited = false;
		version = DEFAULT_NEW_PLUGIN_VERSION;
		description = '';
		format = 'foldnano_mini';
		applyStrategy = 'replayMutationLog';
		requirements = '';
		network = '';
		stubs = true;
	});

	const strategies = $derived(STRATEGIES_FOR_FORMAT[format]);

	const result = $derived.by(() => {
		try {
			const manifest = buildNewManifest(
				{
					id,
					name,
					version,
					description,
					format,
					applyStrategy,
					requirements: parseList(requirements),
					network: parseList(network),
				},
				{ schemaUrl: `${location.origin}/schemas/fplugin-v2.schema.json` }
			);
			return { manifest, error: null };
		} catch (e) {
			return { manifest: null, error: e instanceof Error ? e.message : String(e) };
		}
	});

	function setName(value: string) {
		name = value;
		if (!idEdited) id = suggestPluginId(value);
	}

	function setFormat(value: string) {
		format = value as ScaffoldFormat;
		if (!STRATEGIES_FOR_FORMAT[format].includes(applyStrategy)) applyStrategy = strategies[0];
	}

	async function create() {
		const manifest = result.manifest;
		if (!folder || !manifest || creating) return;
		creating = true;
		try {
			const plugin = await editorCtx.pluginDevMode.createPlugin(folder.dir, manifest, { stubs });
			folder = null;
			onCreated(plugin);
		} catch (e) {
			toast.error("Couldn't create the plugin", {
				description: e instanceof Error ? e.message : String(e),
			});
		} finally {
			creating = false;
		}
	}
</script>

{#if folder}
	{@const { dir, state } = folder}
	<Dialog.Root
		open={true}
		onOpenChange={(v) => {
			if (!v && !creating) folder = null;
		}}
	>
		<Dialog.Content class="max-h-[90vh] overflow-y-auto sm:max-w-xl">
			<Dialog.Header>
				<Dialog.Title>New plugin in "{dir.name}"</Dialog.Title>
				<Dialog.Description>
					{#if state.hasPluginPy}
						This folder has a plugin.py but no fplugin.json. Foldnano writes the manifest and keeps
						your plugin.py, then links the folder.
					{:else if state.empty}
						Foldnano writes a manifest and a starter plugin.py into this empty folder, then links
						it.
					{:else}
						This folder has no fplugin.json. Foldnano adds a manifest and a starter plugin.py next
						to your files (nothing is overwritten), then links the folder.
					{/if}
				</Dialog.Description>
			</Dialog.Header>

			<form
				class="space-y-3"
				onsubmit={(e) => {
					e.preventDefault();
					void create();
				}}
			>
				<div class="grid grid-cols-2 gap-3">
					<div class="space-y-1">
						<Label for="new-plugin-name">Name</Label>
						<Input
							id="new-plugin-name"
							value={name}
							oninput={(e) => setName(e.currentTarget.value)}
						/>
					</div>
					<div class="space-y-1">
						<Label for="new-plugin-id">Id</Label>
						<Input
							id="new-plugin-id"
							value={id}
							oninput={(e) => {
								id = e.currentTarget.value;
								idEdited = true;
							}}
							class="font-mono text-xs"
						/>
					</div>
				</div>

				<div class="grid grid-cols-[1fr_7rem] gap-3">
					<div class="space-y-1">
						<Label for="new-plugin-description">Description</Label>
						<Input
							id="new-plugin-description"
							bind:value={description}
							placeholder="One line shown in the plugin list"
						/>
					</div>
					<div class="space-y-1">
						<Label for="new-plugin-version">Version</Label>
						<Input id="new-plugin-version" bind:value={version} class="font-mono text-xs" />
					</div>
				</div>

				<div class="space-y-1">
					<Label>Format</Label>
					<Select.Root type="single" value={format} onValueChange={setFormat}>
						<Select.Trigger class="w-full text-xs">{FORMAT_LABELS[format]}</Select.Trigger>
						<Select.Content>
							{#each Object.entries(FORMAT_LABELS) as [value, label] (value)}
								<Select.Item {value} {label} class="text-xs">{label}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>

				<div class="space-y-1">
					<Label>What it does to the design</Label>
					<Select.Root
						type="single"
						value={applyStrategy}
						onValueChange={(v) => (applyStrategy = v as ApplyStrategy)}
					>
						<Select.Trigger class="w-full text-xs">
							{STRATEGY_LABELS[applyStrategy]}
							<span class="ml-auto font-mono text-[10px] text-muted-foreground"
								>{applyStrategy}</span
							>
						</Select.Trigger>
						<Select.Content>
							{#each strategies as value (value)}
								<Select.Item {value} label={STRATEGY_LABELS[value]} class="text-xs">
									{STRATEGY_LABELS[value]}
									<span class="ml-auto font-mono text-[10px] text-muted-foreground">{value}</span>
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>

				<div class="grid grid-cols-2 gap-3">
					<div class="space-y-1">
						<Label for="new-plugin-requirements">Requirements</Label>
						<Textarea
							id="new-plugin-requirements"
							bind:value={requirements}
							rows={2}
							placeholder="e.g. numpy, networkx"
							class="font-mono text-xs"
						/>
					</div>
					<div class="space-y-1">
						<Label for="new-plugin-network">Network access</Label>
						<Textarea
							id="new-plugin-network"
							bind:value={network}
							rows={2}
							placeholder="Hosts, e.g. api.example.org (usually none)"
							class="font-mono text-xs"
						/>
					</div>
				</div>

				<div class="flex items-start gap-2 rounded border border-border p-2">
					<Switch id="new-plugin-stubs" bind:checked={stubs} class="mt-0.5" />
					<div class="space-y-0.5">
						<Label for="new-plugin-stubs">Add API stubs for editor autocomplete</Label>
						<p class="text-xs text-muted-foreground">
							Writes the foldnano and foldnano_mini type stubs into <code>.foldnano-stubs/</code>
							and a
							<code>pyrightconfig.json</code> for VS Code / Pylance. Neither is part of the plugin.
						</p>
					</div>
				</div>

				{#if result.error}
					<p
						class="rounded border border-red-200 bg-red-50 p-1.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
					>
						{result.error}
					</p>
				{:else if result.manifest}
					<details class="text-xs">
						<summary class="cursor-pointer text-muted-foreground">fplugin.json preview</summary>
						<pre
							class="mt-1 max-h-48 overflow-auto rounded bg-muted p-2 font-mono text-[11px]">{manifestFileText(
								result.manifest
							)}</pre>
					</details>
				{/if}

				<Dialog.Footer>
					<Button
						type="button"
						variant="outline"
						disabled={creating}
						onclick={() => (folder = null)}
					>
						Cancel
					</Button>
					<Button type="submit" disabled={!result.manifest || creating}>
						{creating ? 'Creating…' : 'Create and link'}
					</Button>
				</Dialog.Footer>
			</form>
		</Dialog.Content>
	</Dialog.Root>
{/if}
