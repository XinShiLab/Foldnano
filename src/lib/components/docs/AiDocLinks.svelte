<script lang="ts">
	import { page } from '$app/state';
	import Check from '@lucide/svelte/icons/check';
	import Copy from '@lucide/svelte/icons/copy';

	const links = [
		{ path: '/llms.txt', label: 'Index of every page', hint: 'For agents that can open links' },
		{
			path: '/llms-full.txt',
			label: 'All docs in one file',
			hint: 'For chats that need it all at once',
		},
		{
			path: '/docs/guide/llms.txt',
			label: 'User guide only',
			hint: 'Using the editor, no plugin docs',
		},
	];

	const origin = $derived(page.url.origin);
	const prompt = $derived(
		`Read ${origin}/llms.txt and use the Foldnano documentation it links to when answering my questions. ` +
			`Cite the page you used for each answer.`
	);

	let copied = $state<string | null>(null);

	async function copy(key: string, text: string) {
		await navigator.clipboard.writeText(text);
		copied = key;
		setTimeout(() => {
			if (copied === key) copied = null;
		}, 1500);
	}
</script>

{#snippet copyButton(key: string, text: string)}
	<button
		type="button"
		onclick={() => copy(key, text)}
		class="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
		aria-label="Copy"
		title="Copy"
	>
		{#if copied === key}<Check size={14} />{:else}<Copy size={14} />{/if}
	</button>
{/snippet}

<div class="not-prose my-6 space-y-3 text-sm">
	<ul class="divide-y divide-border rounded-lg border border-border">
		{#each links as link (link.path)}
			<li class="flex items-center gap-3 px-3 py-2">
				<div class="min-w-0 flex-1">
					<div class="font-medium">{link.label}</div>
					<div class="truncate font-mono text-xs text-muted-foreground">{origin}{link.path}</div>
				</div>
				<span class="hidden text-xs text-muted-foreground md:block">{link.hint}</span>
				{@render copyButton(link.path, `${origin}${link.path}`)}
			</li>
		{/each}
	</ul>
	<div class="flex items-start gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2">
		<div class="min-w-0 flex-1">
			<div class="mb-0.5 text-xs font-semibold text-muted-foreground">Starter prompt</div>
			<p class="text-sm">{prompt}</p>
		</div>
		{@render copyButton('prompt', prompt)}
	</div>
</div>
