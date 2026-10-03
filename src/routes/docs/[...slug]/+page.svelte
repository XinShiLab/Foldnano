<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Uppercase alias so Svelte 5 treats it as a component reference in the template
	const Content = $derived(data.content);

	let articleEl = $state<HTMLElement | null>(null);
	let tocItems = $state<{ id: string; text: string; level: number }[]>([]);

	$effect(() => {
		// Reading Content creates a reactive dependency so the effect re-runs on page navigation
		const _track = Content;
		if (!articleEl) return;
		// Only markdown headings get ids from rehypeSlug; skip component-internal
		// headings (no id) — they aren't anchorable and would collide as duplicate keys.
		tocItems = Array.from(articleEl.querySelectorAll('h2[id], h3[id]')).map((h) => ({
			id: h.id,
			text: h.textContent ?? '',
			level: parseInt(h.tagName[1]),
		}));
	});
</script>

<svelte:head>
	<title>{data.title} – Foldnano Docs</title>
	<meta name="description" content={data.description} />
</svelte:head>

<div class="flex gap-8">
	<article
		bind:this={articleEl}
		class="prose max-w-none min-w-0 flex-1 py-8 dark:prose-invert prose-headings:scroll-mt-20"
	>
		<Content />
	</article>

	{#if tocItems.length > 0}
		<nav class="hidden w-48 shrink-0 xl:block print:hidden">
			<div class="sticky top-20 pt-8">
				<p class="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
					On this page
				</p>
				<ul class="space-y-1 text-sm">
					{#each tocItems as item (item.id)}
						<li style:padding-left="{(item.level - 2) * 0.75}rem">
							<a
								href="#{item.id}"
								class="block text-muted-foreground transition-colors hover:text-foreground"
							>
								{item.text}
							</a>
						</li>
					{/each}
				</ul>
			</div>
		</nav>
	{/if}
</div>
