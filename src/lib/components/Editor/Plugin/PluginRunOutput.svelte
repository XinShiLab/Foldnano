<script lang="ts">
	import { Download, X } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import { getEditorDocumentSession } from '../context/EditorDocumentSession.svelte';
	import PluginDiffPreview from './PluginDiffPreview.svelte';
	import { RUN_FAILED_WITHOUT_MESSAGE } from '$lib/plugin/PluginCoordinator.svelte';
	import type { PythonPlugin } from '$lib/plugin/types';

	let { plugin }: { plugin: PythonPlugin } = $props();

	const editorCtx = getEditorViewContext();
	const session = getEditorDocumentSession();
	const coordinator = $derived(editorCtx.pluginCoordinator);
	const currentDocId = $derived(session.currentDoc.id);
	const currentPartFingerprint = $derived(
		session.currentDoc.parts.length > 0
			? JSON.stringify(session.currentDoc.parts[0].toJSON())
			: null
	);
	const pluginResultJson = $derived(
		plugin.pluginResult ? JSON.stringify(plugin.pluginResult, null, 2) : null
	);
	const isPending = $derived(coordinator.pendingApply?.pluginId === plugin.manifest.id);
	const isPendingStale = $derived(
		Boolean(
			isPending &&
			(coordinator.pendingApply?.docId !== currentDocId ||
				coordinator.pendingApply?.partFingerprint !== currentPartFingerprint)
		)
	);
	const artifactNames = $derived(Object.keys(plugin.artifacts));
	const hasConsole = $derived(plugin.logs.length > 0);
	const hasResult = $derived(pluginResultJson !== null);
	const hasArtifacts = $derived(artifactNames.length > 0);
	const hasApply = $derived(isPending && coordinator.pendingApply !== null);
	type OutputTabId = 'console' | 'result' | 'artifacts' | 'apply';
	const sections = $derived.by((): Array<{ id: OutputTabId; label: string; count?: number }> => {
		const next: Array<{ id: OutputTabId; label: string; count?: number }> = [];
		if (hasConsole) next.push({ id: 'console', label: 'Console', count: plugin.logs.length });
		if (hasResult) next.push({ id: 'result', label: 'Result' });
		if (hasArtifacts)
			next.push({ id: 'artifacts', label: 'Artifacts', count: artifactNames.length });
		if (hasApply) next.push({ id: 'apply', label: 'Apply' });
		return next;
	});
	const showTabs = $derived(sections.length > 1);
	let activeTab = $state<OutputTabId>('console');

	$effect(() => {
		if (hasApply) {
			activeTab = 'apply';
			return;
		}

		if (!sections.some((section) => section.id === activeTab)) {
			activeTab = sections[0]?.id ?? 'console';
		}
	});

	function downloadArtifact(name: string, data: string | Uint8Array) {
		const blobData: BlobPart =
			data instanceof Uint8Array ? (new Uint8Array(data).buffer as ArrayBuffer) : data;
		const blob = new Blob([blobData], { type: 'text/plain' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = name;
		a.click();
		URL.revokeObjectURL(url);
	}

	function deleteArtifact(name: string) {
		const next = { ...plugin.artifacts };
		delete next[name];
		plugin.artifacts = next;
	}
</script>

<div class="flex min-h-0 flex-col gap-3">
	{#if plugin.status === 'error'}
		<div
			class="rounded border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive"
		>
			<div>{plugin.errorMessage || RUN_FAILED_WITHOUT_MESSAGE}</div>
			{#if plugin.errorTraceback}
				<pre class="mt-2 text-[11px] break-all whitespace-pre-wrap">{plugin.errorTraceback}</pre>
			{/if}
		</div>
	{/if}

	{#if sections.length > 0}
		{#if showTabs}
			<Tabs.Root bind:value={activeTab} class="flex min-h-0 flex-col overflow-hidden">
				<Tabs.List variant="line" class="w-full border-b border-border">
					{#each sections as section (section.id)}
						<Tabs.Trigger value={section.id} class="flex-1 text-xs">
							{section.label}
							{#if section.count !== undefined}
								<span class="ml-1 text-[10px] text-muted-foreground">({section.count})</span>
							{/if}
						</Tabs.Trigger>
					{/each}
				</Tabs.List>

				{#if hasConsole}
					<Tabs.Content value="console" class="mt-0 p-0 pt-3">
						<div class="rounded border border-border bg-muted px-3 py-2">
							<div class="max-h-40 overflow-y-auto font-mono text-[11px] text-muted-foreground">
								{#each plugin.logs as line, i (i)}
									<div>{line}</div>
								{/each}
							</div>
						</div>
					</Tabs.Content>
				{/if}

				{#if hasResult}
					<Tabs.Content value="result" class="mt-0 p-0 pt-3">
						<div class="rounded border border-border bg-background px-3 py-2">
							<pre
								class="max-h-40 overflow-y-auto text-[11px] whitespace-pre-wrap">{pluginResultJson}</pre>
						</div>
					</Tabs.Content>
				{/if}

				{#if hasArtifacts}
					<Tabs.Content value="artifacts" class="mt-0 p-0 pt-3">
						<div class="rounded border border-border bg-background px-3 py-2">
							<div class="flex flex-col gap-1">
								{#each artifactNames as name (name)}
									<div class="flex items-center gap-2">
										<Button
											variant="ghost"
											size="sm"
											class="h-auto gap-1 px-0 text-[11px] text-blue-600 hover:bg-transparent hover:text-blue-700"
											onclick={() => downloadArtifact(name, plugin.artifacts[name])}
											title="Download {name}"
										>
											<Download size={10} />
											{name}
										</Button>
										<Button
											variant="ghost"
											size="sm"
											class="ml-auto h-auto p-0.5 text-muted-foreground hover:bg-muted hover:text-red-500"
											onclick={() => deleteArtifact(name)}
											title="Remove artifact"
										>
											<X size={10} />
										</Button>
									</div>
								{/each}
							</div>
						</div>
					</Tabs.Content>
				{/if}

				{#if hasApply && coordinator.pendingApply}
					<Tabs.Content value="apply" class="mt-0 p-0 pt-3">
						{#if isPendingStale}
							<div
								class="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700"
							>
								Result is stale because the document changed since the plugin ran.
								<button
									class="ml-1 underline"
									onclick={() => coordinator.cancelApply(plugin.manifest.id)}
								>
									Discard
								</button>
							</div>
						{:else}
							<PluginDiffPreview
								pending={coordinator.pendingApply}
								onConfirm={() => coordinator.confirmApply(plugin.manifest.id)}
								onCancel={() => coordinator.cancelApply(plugin.manifest.id)}
								readOnly={!editorCtx.isTabOwner}
							/>
						{/if}
					</Tabs.Content>
				{/if}
			</Tabs.Root>
		{:else if hasConsole}
			<div class="rounded border border-border bg-muted px-3 py-2">
				<div class="max-h-40 overflow-y-auto font-mono text-[11px] text-muted-foreground">
					{#each plugin.logs as line, i (i)}
						<div>{line}</div>
					{/each}
				</div>
			</div>
		{:else if hasResult}
			<div class="rounded border border-border bg-background px-3 py-2">
				<pre
					class="max-h-40 overflow-y-auto text-[11px] whitespace-pre-wrap">{pluginResultJson}</pre>
			</div>
		{:else if hasArtifacts}
			<div class="rounded border border-border bg-background px-3 py-2">
				<div class="flex flex-col gap-1">
					{#each artifactNames as name (name)}
						<div class="flex items-center gap-2">
							<Button
								variant="ghost"
								size="sm"
								class="h-auto gap-1 px-0 text-[11px] text-blue-600 hover:bg-transparent hover:text-blue-700"
								onclick={() => downloadArtifact(name, plugin.artifacts[name])}
								title="Download {name}"
							>
								<Download size={10} />
								{name}
							</Button>
							<Button
								variant="ghost"
								size="sm"
								class="ml-auto h-auto p-0.5 text-muted-foreground hover:bg-muted hover:text-red-500"
								onclick={() => deleteArtifact(name)}
								title="Remove artifact"
							>
								<X size={10} />
							</Button>
						</div>
					{/each}
				</div>
			</div>
		{:else if hasApply && coordinator.pendingApply}
			{#if isPendingStale}
				<div
					class="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700"
				>
					Result is stale because the document changed since the plugin ran.
					<button
						class="ml-1 underline"
						onclick={() => coordinator.cancelApply(plugin.manifest.id)}
					>
						Discard
					</button>
				</div>
			{:else}
				<PluginDiffPreview
					pending={coordinator.pendingApply}
					onConfirm={() => coordinator.confirmApply(plugin.manifest.id)}
					onCancel={() => coordinator.cancelApply(plugin.manifest.id)}
					readOnly={!editorCtx.isTabOwner}
				/>
			{/if}
		{/if}
	{/if}
</div>
