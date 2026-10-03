<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { PluginInstallGate } from './PluginInstallGate.svelte';
	import PluginManifestInfo from './PluginManifestInfo.svelte';

	let { gate }: { gate: PluginInstallGate } = $props();

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
</script>

{#if gate.pending}
	{@const { incoming, existing } = gate.pending}
	<Dialog.Root
		open={true}
		onOpenChange={(v) => {
			if (!v) gate.cancelPending();
		}}
	>
		<Dialog.Content class="sm:max-w-lg">
			<Dialog.Header>
				<Dialog.Title>
					{existing ? 'Replace' : 'Install'} — {existing?.name ?? incoming.name}
				</Dialog.Title>
			</Dialog.Header>

			<div class="space-y-2 text-sm text-muted-foreground">
				{#if existing}
					<p>
						A plugin with ID "{incoming.id}" is already installed (v{existing.version}). Replacing
						it with v{incoming.version} will overwrite the installed plugin.
					</p>
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
			</div>

			<Dialog.Footer>
				<Button variant="outline" onclick={() => gate.cancelPending()}>Cancel</Button>
				<Button onclick={() => void gate.confirmPending()}>
					{existing ? 'Replace' : 'Install'}
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
{/if}
