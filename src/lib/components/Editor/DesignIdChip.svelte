<script lang="ts">
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import { help } from '$lib/components/help/help';
	import { notify } from '$lib/notifications/notify.svelte';
	import { shortDesignId } from '$lib/model/io/designFileName';
	import { cn } from '$lib/utils/utils';

	let { id, class: className = '' }: { id: string; class?: string } = $props();

	const TOOLTIP =
		'Design ID. Foldnano uses it to recognise the same design across this browser, files and GitHub: files with this ID are treated as versions of this design, whatever their name. To start a separate design from this one, use Save as a copy. Click to copy the full ID.';

	async function copy() {
		try {
			await navigator.clipboard.writeText(id);
			notify.success('Design ID copied', { description: id });
		} catch {
			notify.error("Couldn't copy the design ID", { description: id });
		}
	}
</script>

<Tooltip.Provider delayDuration={300}>
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<button
					{...props}
					type="button"
					class={cn(
						'shrink-0 cursor-pointer rounded px-1 font-mono text-xs text-muted-foreground/80 hover:bg-muted hover:text-foreground',
						className
					)}
					aria-label="Design ID {id}, click to copy"
					onclick={copy}
					{@attach help({ title: 'Design ID', text: TOOLTIP, doc: 'saving-github' })}
					>{shortDesignId(id)}</button
				>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content class="block max-w-72 text-xs leading-relaxed">{TOOLTIP}</Tooltip.Content>
	</Tooltip.Root>
</Tooltip.Provider>
