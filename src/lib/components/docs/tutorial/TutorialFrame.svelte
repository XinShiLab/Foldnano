<script lang="ts">
	import { cn } from '$lib/utils/utils';

	type Props = {
		title?: string;
		caption?: string;
		class?: string;
		children: import('svelte').Snippet;
	};

	let { title, caption, class: className, children }: Props = $props();
</script>

<section
	class={cn(
		'not-prose my-6 overflow-hidden rounded-md border border-border bg-background text-foreground shadow-sm',
		className
	)}
>
	{#if title || caption}
		<div class="border-b border-border bg-muted/30 px-4 py-3">
			{#if title}
				<h3 class="m-0 text-sm font-semibold">{title}</h3>
			{/if}
			{#if caption}
				<p class="mt-1 text-xs text-muted-foreground">{caption}</p>
			{/if}
		</div>
	{/if}
	<div class="p-4">
		{@render children()}
	</div>
</section>
