<script lang="ts">
	import { citationLink } from '$lib/plugin/manifestValidation';
	import type { PluginCitation } from '$lib/plugin/types';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Copy, ExternalLink } from '@lucide/svelte';
	import { notify } from '$lib/notifications/notify.svelte';

	let { citations }: { citations: PluginCitation[] } = $props();

	async function copyCitation(citation: PluginCitation) {
		const link = citationLink(citation);
		try {
			await navigator.clipboard.writeText(link ? `${citation.text} ${link.href}` : citation.text);
			notify.success('Citation copied');
		} catch {
			notify.error('Could not copy the citation');
		}
	}
</script>

<div class="flex flex-col gap-1 text-[11px] leading-snug">
	<span class="font-semibold text-foreground"
		>If you use this plugin in your work, please cite:</span
	>
	{#each citations as citation, i (i)}
		{@const link = citationLink(citation)}
		<div class="flex items-start gap-1">
			<div class="min-w-0 flex-1">
				<p class="break-words text-muted-foreground">{citation.text}</p>
				{#if link}
					<!-- eslint-disable svelte/no-navigation-without-resolve -- external https link from citationLink() -->
					<a
						href={link.href}
						target="_blank"
						rel="noopener noreferrer"
						class="inline-flex max-w-full items-center gap-1 text-blue-600 hover:underline dark:text-blue-400"
					>
						<span class="truncate">{link.label}</span>
						<ExternalLink size={10} class="shrink-0" />
					</a>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
				{/if}
			</div>
			<Button
				variant="ghost"
				size="icon"
				class="size-5 shrink-0"
				title="Copy citation"
				aria-label="Copy citation"
				onclick={() => copyCitation(citation)}
			>
				<Copy size={11} />
			</Button>
		</div>
	{/each}
</div>
