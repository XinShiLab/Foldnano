<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import PluginManifestInfo from './PluginManifestInfo.svelte';
	import type { LinkedPluginReviewGate } from './LinkedPluginReviewGate.svelte';

	let { gate }: { gate: LinkedPluginReviewGate } = $props();

	const describe = (values: string[] | undefined): string =>
		!values || values.length === 0 ? 'none' : values.join(', ');

	const changes = $derived.by(() => {
		const review = gate.pending;
		if (!review?.previous) return [];
		return [
			{
				label: 'Requirements',
				before: describe(review.previous.requirements),
				after: describe(review.manifest.requirements),
			},
			{
				label: 'Network access',
				before: describe(review.previous.network),
				after: describe(review.manifest.network),
			},
		].filter((change) => change.before !== change.after);
	});
</script>

{#if gate.pending}
	{@const review = gate.pending}
	<Dialog.Root
		open={true}
		onOpenChange={(v) => {
			if (!v) gate.decline();
		}}
	>
		<Dialog.Content class="sm:max-w-lg">
			<Dialog.Header>
				<Dialog.Title>
					{review.kind === 'link'
						? `Link "${review.manifest.name}"`
						: `"${review.manifest.name}" changed what it needs`}
				</Dialog.Title>
				<Dialog.Description>
					{#if review.kind === 'link'}
						From the folder "{review.folderName}". Foldnano reads this folder each time you run the
						plugin. Linking doesn't change any files in it.
					{:else}
						fplugin.json in "{review.folderName}" now declares different packages or network access.
						Accepting rebuilds its dev environment.
					{/if}
				</Dialog.Description>
			</Dialog.Header>

			<div class="space-y-2 text-sm text-muted-foreground">
				{#if changes.length > 0}
					<ul
						class="space-y-1 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
					>
						{#each changes as change (change.label)}
							<li>
								<strong>{change.label}:</strong>
								{change.before} → <strong>{change.after}</strong>
							</li>
						{/each}
					</ul>
				{/if}
				<PluginManifestInfo manifest={review.manifest} />
			</div>

			<Dialog.Footer>
				<Button variant="outline" onclick={() => gate.decline()}>Cancel</Button>
				<Button onclick={() => gate.accept()}>
					{review.kind === 'link' ? 'Link' : 'Accept'}
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
{/if}
