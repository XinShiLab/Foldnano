<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { PluginInstallGate } from './PluginInstallGate.svelte';
	import PluginManifestInfo from './PluginManifestInfo.svelte';
	import PluginTile from './PluginTile.svelte';
	import { readPluginIcon } from '$lib/plugin/pluginIcon';
	import { compareVersions } from '$lib/plugin/pluginUpdates';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';

	let { gate }: { gate: PluginInstallGate } = $props();

	// Restoring your own backup should stay editable unless the user says otherwise.
	let restoreAsEditable = $state(true);
	$effect(() => {
		if (gate.pending) restoreAsEditable = true;
	});

	const describeNetwork = (network: string[] | undefined): string =>
		!network || network.length === 0 ? 'none' : network.join(', ');

	// A new version can widen what the plugin reaches; call that out on replace.
	const networkChange = $derived.by(() => {
		const pending = gate.pending;
		if (!pending?.existing) return null;
		const before = describeNetwork(pending.existing.network);
		const after = describeNetwork(pending.incoming.network);
		return before === after ? null : { before, after };
	});

	const action = $derived.by(() => {
		const pending = gate.pending;
		if (!pending?.existing) return 'Install';
		return compareVersions(pending.incoming.version, pending.existing.version) > 0
			? 'Update'
			: 'Replace';
	});

	// The installer already checked the icon; a failure here just falls back to the default tile.
	const iconSvg = $derived.by(() => {
		const pending = gate.pending;
		if (!pending) return null;
		try {
			return readPluginIcon(pending.incoming, pending.files);
		} catch {
			return null;
		}
	});
</script>

{#if gate.pending}
	{@const { incoming, existing } = gate.pending}
	<Dialog.Root
		open={true}
		onOpenChange={(v) => {
			if (!v) gate.cancelPending();
		}}
	>
		<!-- Long declarations scroll in the body so the header and actions stay on screen. -->
		<Dialog.Content
			class="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-lg"
		>
			<Dialog.Header>
				<div class="flex items-center gap-2.5">
					<PluginTile manifest={incoming} {iconSvg} />
					<Dialog.Title class="text-base leading-snug">
						{action} — {existing?.name ?? incoming.name}
						<span class="ml-1 text-xs font-normal whitespace-nowrap text-muted-foreground"
							>{incoming.version}</span
						>
					</Dialog.Title>
				</div>
			</Dialog.Header>

			<div class="min-h-0 space-y-2 overflow-y-auto text-sm text-muted-foreground">
				{#if incoming.description}
					<p>{incoming.description}</p>
				{/if}
				{#if existing}
					{#if action === 'Update'}
						<p>
							Updates "{existing.name}" from v{existing.version} to v{incoming.version}. Check what
							the new version declares below.
						</p>
					{:else}
						<p>
							A plugin with ID "{incoming.id}" is already installed (v{existing.version}). Replacing
							it with v{incoming.version} will overwrite the installed plugin.
						</p>
					{/if}
					{#if gate.pending.endsEditing}
						<p
							class="rounded border border-amber-200 bg-amber-50 p-1.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
						>
							You made "{existing.name}" here. This zip has files, a side panel or packages its
							editor can't keep, so after replacing it you can no longer edit it here, and its
							unsaved edits are discarded.
						</p>
					{/if}
					{#if networkChange}
						<p
							class="rounded border border-amber-200 bg-amber-50 p-1.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
						>
							This version changes network access from <strong>{networkChange.before}</strong> to
							<strong>{networkChange.after}</strong>.
						</p>
					{/if}
				{:else}
					<p>
						Review what "{incoming.name}" v{incoming.version} declares before installing it. Only install
						plugins from people you trust.
					</p>
				{/if}
				<PluginManifestInfo manifest={incoming} />
				{#if gate.pending.restorable && !existing}
					<div class="flex items-start gap-2 rounded border border-border p-2">
						<Switch id="restore-as-editable" bind:checked={restoreAsEditable} class="mt-0.5" />
						<div class="space-y-0.5">
							<Label for="restore-as-editable">Restore as editable</Label>
							<p class="text-xs">
								This zip was exported from a plugin made with Script Lab. Restore it so you can keep
								editing it here.
							</p>
						</div>
					</div>
				{/if}
			</div>

			<Dialog.Footer>
				<Button variant="outline" onclick={() => gate.cancelPending()}>Cancel</Button>
				<Button onclick={() => void gate.confirmPending({ asEditable: restoreAsEditable })}>
					{action}
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
{/if}
