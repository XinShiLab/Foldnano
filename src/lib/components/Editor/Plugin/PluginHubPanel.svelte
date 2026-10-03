<script lang="ts">
	import { hubPlugins } from '$lib/plugin/corePlugins';
	import { classifyEnv } from '$lib/plugin/envClassification';
	import { preparePointerInstall } from '$lib/plugin/PluginInstaller';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import { Download, CircleCheckBig, X } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { toast } from 'svelte-sonner';
	import PluginManifestInfo from './PluginManifestInfo.svelte';

	const { onInstalled }: { onInstalled: () => void } = $props();

	const editorCtx = getEditorViewContext();
	const registry = $derived(editorCtx.pluginRegistry);

	// Two-step install: first click reveals the manifest info card and switches
	// the button to Confirm; second click actually registers. Track the id of
	// the manifest currently awaiting confirmation (only one at a time).
	let pendingConfirmId = $state<string | null>(null);

	function isInstalled(id: string): boolean {
		return registry.get(id) !== undefined;
	}

	function requestInstall(manifest: (typeof hubPlugins)[number]) {
		pendingConfirmId = manifest.id;
	}

	let installingId = $state<string | null>(null);

	async function confirmInstall(manifest: (typeof hubPlugins)[number]) {
		installingId = manifest.id;
		try {
			const outcome = await editorCtx.pluginInstallGate.requestInstall(() =>
				preparePointerInstall(manifest, registry)
			);
			if (outcome.status === 'installed') {
				pendingConfirmId = null;
				onInstalled();
			} else if (outcome.status === 'error') {
				toast.error('Cannot install plugin', { description: outcome.message });
			}
		} finally {
			installingId = null;
		}
	}
</script>

<div class="h-full space-y-4 overflow-y-auto px-3 py-2">
	<!-- Core Plugins -->
	<section>
		<div class="mb-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
			Core Plugins
		</div>
		{#each hubPlugins as manifest (manifest.id)}
			{@const isPending = pendingConfirmId === manifest.id}
			<div
				class="mb-1.5 flex flex-col gap-2 rounded border border-border bg-card px-2.5 py-2 hover:border-border/80"
			>
				<div class="flex items-start gap-2">
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-1.5">
							<span class="truncate text-xs font-medium text-card-foreground">{manifest.name}</span>
							<span class="shrink-0 text-[10px] text-muted-foreground">{manifest.version}</span>
						</div>
						{#if manifest.description}
							<div class="mt-0.5 text-[11px] leading-snug text-muted-foreground">
								{manifest.description}
							</div>
						{/if}
						{#if !isPending}
							{@const envTier = classifyEnv(manifest)}
							<div class="mt-1 flex flex-col gap-1">
								<Badge variant="secondary" class="px-1.5 py-0.5 text-[10px]"
									>{manifest.format}</Badge
								>
								<Badge variant="secondary" class="px-1.5 py-0.5 text-[10px]"
									>{manifest.applyStrategy}</Badge
								>
								<Badge
									variant="secondary"
									class="px-1.5 py-0.5 text-[10px] {envTier === 'custom'
										? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
										: ''}"
									title={envTier === 'standard'
										? 'Standard environment — shares the persistent Python runtime'
										: 'Custom environment — only one custom-environment plugin can be active at a time'}
								>
									{envTier} env
								</Badge>
							</div>
						{/if}
					</div>
					{#if isInstalled(manifest.id)}
						<span class="mt-0.5 flex shrink-0 items-center gap-1 text-[11px] text-green-600">
							<CircleCheckBig size={11} />
							Installed
						</span>
					{:else if isPending}
						<div class="mt-0.5 flex shrink-0 items-center gap-1">
							<Button
								size="sm"
								class="h-6 gap-1 px-2 text-xs font-normal"
								onclick={() => confirmInstall(manifest)}
								disabled={installingId === manifest.id}
							>
								<Download size={11} />
								{installingId === manifest.id ? 'Installing…' : 'Confirm'}
							</Button>
							<Button
								variant="ghost"
								size="icon"
								class="size-6"
								onclick={() => (pendingConfirmId = null)}
								title="Cancel"
							>
								<X size={11} />
							</Button>
						</div>
					{:else}
						<Button
							variant="outline"
							size="sm"
							class="mt-0.5 h-6 shrink-0 gap-1 px-2 text-xs font-normal"
							onclick={() => requestInstall(manifest)}
						>
							<Download size={11} />
							Install
						</Button>
					{/if}
				</div>

				{#if isPending}
					<PluginManifestInfo {manifest} />
				{/if}
			</div>
		{/each}
	</section>

	<!-- Community Plugins (placeholder) -->
	<section>
		<div class="mb-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
			Community Plugins
		</div>
		<div
			class="rounded border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground"
		>
			Community plugins coming soon.
		</div>
	</section>
</div>
