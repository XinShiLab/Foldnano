<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { DesignIssueSeverity } from '$lib/model/checks/designIssue';
	import { designCheckPrompt } from './designCheckPrompt.svelte';

	const pending = $derived(designCheckPrompt.pending);
	const blocked = $derived(pending?.issues.some((issue) => issue.severity === 'error') ?? false);
	const groups = $derived(
		(['error', 'warning', 'info'] as const)
			.map((severity) => ({
				severity,
				issues: pending?.issues.filter((issue) => issue.severity === severity) ?? [],
			}))
			.filter((group) => group.issues.length > 0)
	);

	const GROUP_LABEL: Record<DesignIssueSeverity, string> = {
		error: 'Must be fixed first',
		warning: 'Will be lost or changed',
		info: 'Not included',
	};
	const GROUP_CLASS: Record<DesignIssueSeverity, string> = {
		error: 'text-destructive',
		warning: 'text-amber-700 dark:text-amber-400',
		info: 'text-muted-foreground',
	};
</script>

<Dialog.Root
	open={pending !== null}
	onOpenChange={(isOpen) => {
		if (!isOpen) designCheckPrompt.answer(false);
	}}
>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{pending?.title}</Dialog.Title>
			<Dialog.Description>{pending?.description}</Dialog.Description>
		</Dialog.Header>
		<div class="max-h-80 space-y-3 overflow-y-auto text-sm">
			{#each groups as group (group.severity)}
				<div>
					<p class="font-medium {GROUP_CLASS[group.severity]}">{GROUP_LABEL[group.severity]}</p>
					<ul class="mt-1 list-disc space-y-1 pl-5">
						{#each group.issues as issue, i (i)}
							<li>{issue.message}</li>
						{/each}
					</ul>
				</div>
			{/each}
		</div>
		<Dialog.Footer class="flex gap-2">
			{#if blocked}
				<Button onclick={() => designCheckPrompt.answer(false)}>Close</Button>
			{:else}
				<Button variant="outline" onclick={() => designCheckPrompt.answer(false)}>Cancel</Button>
				<Button onclick={() => designCheckPrompt.answer(true)}>{pending?.proceedLabel}</Button>
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
