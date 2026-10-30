<script lang="ts">
	import type { ComponentProps, Snippet } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { resolve } from '$app/paths';
	import {
		Bot,
		CircleAlert,
		CircleCheck,
		Download,
		FolderOpen,
		FolderSync,
		Info,
		ListChecks,
		RefreshCw,
		Unlink,
		TriangleAlert,
	} from '@lucide/svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import type { PluginCheckIssue } from '$lib/plugin/linkedPluginFolder';
	import { help } from '$lib/components/help/help';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import type { LinkedFolderAccess, PythonPlugin } from '$lib/plugin/types';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import NewPluginDialog from './NewPluginDialog.svelte';

	let { pluginRow }: { pluginRow: Snippet<[PythonPlugin]> } = $props();

	const editorCtx = getEditorViewContext();
	const devMode = $derived(editorCtx.pluginDevMode);
	const coordinator = $derived(editorCtx.pluginCoordinator);
	const agentRuns = $derived(editorCtx.agentRuns);
	const linkedPlugins = $derived(devMode.linkedPlugins);
	let linking = $state(false);

	const ACCESS_NOTES: Partial<Record<LinkedFolderAccess, string>> = {
		prompt: 'Foldnano will ask to read this folder again on Activate or Run.',
		denied: 'Reading this folder was not allowed. Activate or Run to ask again, or re-link it.',
		missing: "This folder can't be found. It may have been moved or deleted. Re-link it.",
	};

	async function act(label: string, action: () => Promise<unknown> | unknown) {
		try {
			await action();
		} catch (e) {
			toast.error(label, { description: e instanceof Error ? e.message : String(e) });
		}
	}

	let checkResult: { name: string; folderName: string; issues: PluginCheckIssue[] } | null =
		$state.raw(null);

	async function checkPlugin(plugin: PythonPlugin) {
		await act("Couldn't check the plugin", async () => {
			const issues = await devMode.checkFolder(plugin);
			checkResult = {
				name: plugin.manifest.name,
				folderName: plugin.linked?.folderName ?? '',
				issues,
			};
		});
	}

	let newPluginFolder: ComponentProps<typeof NewPluginDialog>['folder'] = $state.raw(null);

	/** A folder with fplugin.json is linked; any other folder opens the New plugin dialog. */
	async function linkFolder() {
		if (linking) return;
		linking = true;
		await act("Couldn't link the folder", async () => {
			const dir = await devMode.pickFolder();
			if (!dir) return;
			const state = await devMode.inspectFolder(dir);
			if (state.kind === 'new') {
				newPluginFolder = { dir, state };
				return;
			}
			const plugin = await devMode.linkPickedFolder(dir);
			if (plugin) toast.success(`Linked "${plugin.manifest.name}".`);
		});
		linking = false;
	}
</script>

<div class="flex h-full flex-col overflow-y-auto">
	<div class="space-y-1.5 border-b border-border px-3 py-2.5">
		<div class="flex items-center justify-between gap-2">
			<Label for="plugin-dev-mode" class="text-xs font-medium">Plugin dev mode</Label>
			<Switch
				id="plugin-dev-mode"
				checked={devMode.enabled}
				disabled={!devMode.supported}
				onCheckedChange={(v) => void act("Couldn't change dev mode", () => devMode.setEnabled(v))}
				class="h-4 w-7"
				{@attach help({
					title: 'Plugin dev mode',
					text: 'Turn on to link plugin folders from your computer. Turning it off stops and hides linked plugins.',
				})}
			/>
		</div>
		<p class="text-xs text-muted-foreground">
			Link a plugin folder on your computer and run it as you edit it in your own editor. Every Run
			reads the folder again; nothing is installed or copied.
		</p>
		{#if !devMode.supported}
			<p
				class="flex gap-1.5 rounded border border-amber-200 bg-amber-50 p-1.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
			>
				<TriangleAlert size={13} class="mt-0.5 shrink-0" />
				<span>
					Plugin dev mode is only available in Chromium-based browsers (Chrome, Edge, Brave, Arc).
					It reads your plugin folder directly from disk using the File System Access API, which
					other browsers don't support yet.
				</span>
			</p>
		{/if}
	</div>

	<div
		class="flex-1 transition-opacity"
		class:opacity-50={!devMode.enabled}
		class:pointer-events-none={!devMode.enabled}
		inert={!devMode.enabled}
	>
		<div class="space-y-1.5 border-b border-border px-3 py-2.5">
			<div class="flex items-center justify-between gap-2">
				<Label for="plugin-agent-runs" class="flex items-center gap-1.5 text-xs font-medium">
					Agent runs
					<span
						class="rounded border border-amber-300 bg-amber-50 px-1 text-[10px] font-semibold tracking-wide text-amber-700 uppercase dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300"
					>
						Experimental
					</span>
				</Label>
				<Switch
					id="plugin-agent-runs"
					checked={agentRuns.allowed}
					onCheckedChange={(v) =>
						void act("Couldn't change agent runs", () => agentRuns.setAllowed(v))}
					class="h-4 w-7"
					{@attach help({
						title: 'Agent runs (experimental)',
						text: 'Turn on to let a coding agent run Python from one linked folder. Turning it off stops agent runs in every folder.',
					})}
				/>
			</div>
			<p class="text-xs text-muted-foreground">
				Let a coding agent on your computer (Claude Code, Codex, a script) run Python against the
				open design through one linked folder, without clicking Run.
				<a
					href={resolve('/docs/[...slug]', { slug: 'plugin-development/agent-runs' })}
					target="_blank"
					rel="noopener"
					class="underline underline-offset-2 hover:text-foreground">How it works and the risks</a
				>
			</p>
			<p
				class="flex gap-1.5 rounded border border-amber-200 bg-amber-50 p-1.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
			>
				<TriangleAlert size={13} class="mt-0.5 shrink-0" />
				<span>
					Highly experimental: how it works, and the files it writes, may change or be removed.
					Results are applied as soon as a run finishes (Undo reverts each one). Only use it with
					folders and agents you trust.
					<strong class="mt-1 block font-medium">
						The agent can read your whole design, sequences included, and after every run it is
						shown a text overview of the design's structure (helices, routes, staple lengths; no
						sequences). Unless it uses a model on your own computer, what it reads is sent to its AI
						provider, which may keep it in chat history or use it under its own terms.
					</strong>
				</span>
			</p>
		</div>

		<div class="flex items-center justify-between border-b border-border px-3 py-2">
			<span class="text-xs font-medium text-muted-foreground">Linked folders</span>
			<Button
				variant="outline"
				size="sm"
				class="h-6 gap-1 px-2 text-xs"
				disabled={linking}
				onclick={linkFolder}
				{@attach help({
					title: 'Link plugin folder',
					text: 'Pick a plugin folder (fplugin.json and plugin.py at its top level), or an empty folder to start a new plugin.',
				})}
			>
				<FolderOpen size={13} />
				Link plugin folder…
			</Button>
		</div>

		{#if linkedPlugins.length === 0}
			<div class="px-4 py-6 text-center text-xs text-gray-400">
				No folders linked.<br />
				Click <strong>Link plugin folder…</strong> and pick a folder with <code>fplugin.json</code>
				and <code>plugin.py</code> at its top level, or an empty folder to start a new plugin.
			</div>
		{:else}
			{#each linkedPlugins as plugin (plugin.manifest.id)}
				{@const linked = plugin.linked}
				{@const note = linked ? ACCESS_NOTES[linked.access] : undefined}
				{@const agentOn = agentRuns.pluginId === plugin.manifest.id}
				<div class="border-b border-border">
					<div
						class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 bg-muted/40 px-3 py-1 text-xs text-muted-foreground"
					>
						<FolderOpen size={12} class="shrink-0" />
						<span class="min-w-24 flex-1 truncate" title={linked?.folderName}
							>{linked?.folderName}</span
						>
						{#if plugin.status === 'active'}
							<Button
								variant="ghost"
								size="sm"
								class="h-5 gap-1 px-1.5 text-[11px]"
								onclick={() =>
									void act("Couldn't restart the environment", () =>
										coordinator.restartLinkedEnvironment(plugin.manifest.id)
									)}
								title="Start a fresh dev environment and reinstall requirements"
							>
								<RefreshCw size={11} />
								Restart env
							</Button>
						{/if}
						{#if agentRuns.allowed}
							<Button
								variant="ghost"
								size="sm"
								class="h-5 gap-1 px-1.5 text-[11px] {agentOn
									? 'border border-primary bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary'
									: ''}"
								aria-pressed={agentOn}
								onclick={() =>
									void act("Couldn't change agent runs", () =>
										agentOn ? agentRuns.disable() : agentRuns.enable(plugin.manifest.id)
									)}
								title={agentOn
									? 'Stop accepting runs from a coding agent in this folder'
									: 'Let a coding agent in this folder run Python here (python .foldnano/run.py). Writes .foldnano/run.py and AGENTS.md.'}
							>
								<Bot size={11} />
								{agentOn ? 'Agent runs on' : 'Agent runs'}
							</Button>
						{/if}
						<Button
							variant="ghost"
							size="sm"
							class="h-5 gap-1 px-1.5 text-[11px]"
							onclick={() => void checkPlugin(plugin)}
							title="Check fplugin.json and the folder for problems, without running the plugin"
						>
							<ListChecks size={11} />
							Check
						</Button>
						<Button
							variant="ghost"
							size="sm"
							class="h-5 gap-1 px-1.5 text-[11px]"
							onclick={() => void act("Couldn't export the zip", () => devMode.exportZip(plugin))}
							title="Download the folder as a plugin zip for Import zip (ignored files left out)"
						>
							<Download size={11} />
							Zip
						</Button>
						<Button
							variant="ghost"
							size="sm"
							class="h-5 gap-1 px-1.5 text-[11px]"
							onclick={() =>
								void act("Couldn't re-link the folder", () =>
									devMode.relinkFolder(plugin.manifest.id)
								)}
							title="Pick this plugin's folder again, e.g. after moving it"
						>
							<FolderSync size={11} />
							Re-link
						</Button>
						<Button
							variant="ghost"
							size="sm"
							class="h-5 gap-1 px-1.5 text-[11px] hover:text-red-500"
							onclick={() =>
								void act("Couldn't unlink the plugin", () => devMode.unlink(plugin.manifest.id))}
							title="Forget this folder. Files on disk are not touched."
						>
							<Unlink size={11} />
							Unlink
						</Button>
					</div>
					{#if note}
						<p class="px-3 pt-1.5 text-xs text-amber-600">{note}</p>
					{/if}
					{#if agentOn}
						<p class="px-3 pt-1.5 text-xs text-muted-foreground">
							Connected to the design <strong>{agentRuns.connection?.docName}</strong>. A coding
							agent working in this folder can run <code>python .foldnano/run.py [script.py]</code>,
							and results are applied straight away (each run is one undo step). Instructions for
							the agent are in <code>AGENTS.md</code>.
						</p>
						{#if plugin.manifest.format !== 'foldnano_mini'}
							<p class="px-3 pt-1 text-xs text-amber-600">
								Agent scripts run as <code>{plugin.manifest.format}</code> and replace the whole
								{plugin.manifest.format === 'cadnano_json' ? 'region' : 'part'} on each run. For step-by-step
								design edits, a <code>foldnano_mini</code> plugin records each change instead.
							</p>
						{/if}
					{/if}
					{@render pluginRow(plugin)}
				</div>
			{/each}
		{/if}
	</div>
</div>

<NewPluginDialog
	bind:folder={newPluginFolder}
	onCreated={(plugin) => toast.success(`Created and linked "${plugin.manifest.name}".`)}
/>

{#if checkResult}
	{@const result = checkResult}
	<Dialog.Root
		open={true}
		onOpenChange={(v) => {
			if (!v) checkResult = null;
		}}
	>
		<Dialog.Content class="sm:max-w-lg">
			<Dialog.Header>
				<Dialog.Title>Check "{result.name}"</Dialog.Title>
				<Dialog.Description>From the folder "{result.folderName}", as it is now.</Dialog.Description
				>
			</Dialog.Header>
			<ul class="space-y-1.5 text-xs">
				{#each result.issues as issue, i (i)}
					<li class="flex gap-1.5">
						{#if issue.level === 'error'}
							<CircleAlert size={13} class="mt-0.5 shrink-0 text-red-500" />
						{:else if issue.level === 'warning'}
							<TriangleAlert size={13} class="mt-0.5 shrink-0 text-amber-500" />
						{:else if i === 0}
							<CircleCheck size={13} class="mt-0.5 shrink-0 text-green-600" />
						{:else}
							<Info size={13} class="mt-0.5 shrink-0 text-blue-500" />
						{/if}
						<span class="break-words">{issue.message}</span>
					</li>
				{/each}
			</ul>
			<Dialog.Footer>
				<Button onclick={() => (checkResult = null)}>Close</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
{/if}
