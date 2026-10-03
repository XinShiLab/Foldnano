<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { PluginActivationGate } from './PluginActivationGate.svelte';

	let { gate }: { gate: PluginActivationGate } = $props();
</script>

{#if gate.pending}
	<Dialog.Root
		open={true}
		onOpenChange={(v) => {
			if (!v) gate.cancelPending();
		}}
	>
		<Dialog.Content class="sm:max-w-md">
			<Dialog.Header>
				<Dialog.Title>Activate — {gate.pending.pluginName}</Dialog.Title>
			</Dialog.Header>

			<div class="space-y-2 text-sm text-muted-foreground">
				<p>
					"{gate.pending.pluginName}" needs a custom Python environment, and only one
					custom-environment plugin can be active at a time.
				</p>
				{#if gate.pending.runningPluginName}
					<p>
						Activating it will <strong>stop "{gate.pending.runningPluginName}"</strong>, which is
						currently busy.
					</p>
				{/if}
				{#if gate.pending.pendingApplyPluginName}
					<p>
						The unapplied result from "{gate.pending.pendingApplyPluginName}" will be
						<strong>discarded</strong>.
					</p>
				{/if}
			</div>

			<Dialog.Footer>
				<Button variant="outline" onclick={() => gate.cancelPending()}>Cancel</Button>
				<Button onclick={() => void gate.confirmPending()}>Activate</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
{/if}
