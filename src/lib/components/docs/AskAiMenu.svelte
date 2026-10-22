<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import Bot from '@lucide/svelte/icons/bot';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Copy from '@lucide/svelte/icons/copy';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import FileText from '@lucide/svelte/icons/file-text';
	import Info from '@lucide/svelte/icons/info';
	import { toast } from 'svelte-sonner';

	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';

	const { category, slug }: { category: string; slug: string } = $props();

	const markdownPath = $derived(resolve(`/docs/${category}/${slug}.md`));
	const markdownUrl = $derived(`${page.url.origin}${markdownPath}`);
	const prompt = $derived(
		`Read ${markdownUrl} so you can answer my questions about this Foldnano documentation page. ` +
			`If you need other pages, the full docs index is at ${page.url.origin}/llms.txt.`
	);

	async function fetchMarkdown(): Promise<string> {
		const res = await fetch(markdownPath);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return res.text();
	}

	// ClipboardItem takes the pending fetch so the write stays inside the click's user
	// activation; Safari rejects a writeText that runs after an awaited fetch.
	async function copyMarkdown() {
		try {
			if (typeof ClipboardItem !== 'undefined') {
				const blob = fetchMarkdown().then((text) => new Blob([text], { type: 'text/plain' }));
				await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
			} else {
				await navigator.clipboard.writeText(await fetchMarkdown());
			}
			toast.success('Page copied as Markdown');
		} catch (err) {
			toast.error(`Could not copy page: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<Button {...props} variant="outline" size="sm" class="gap-1.5">
				<Bot class="size-3.5" />Ask AI<ChevronDown class="size-3.5 opacity-60" />
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="end" class="w-64">
		<DropdownMenu.Item onSelect={copyMarkdown}>
			<Copy />
			<div>
				<div>Copy page as Markdown</div>
				<div class="text-muted-foreground">Paste into any AI chat</div>
			</div>
		</DropdownMenu.Item>
		<DropdownMenu.Item>
			{#snippet child({ props })}
				<a {...props} href={markdownPath} target="_blank" rel="noopener">
					<FileText />View as Markdown
				</a>
			{/snippet}
		</DropdownMenu.Item>
		<DropdownMenu.Separator />
		<DropdownMenu.Item>
			{#snippet child({ props })}
				<a
					{...props}
					href={`https://chatgpt.com/?q=${encodeURIComponent(prompt)}`}
					target="_blank"
					rel="noopener noreferrer"
				>
					<ExternalLink />Open in ChatGPT
				</a>
			{/snippet}
		</DropdownMenu.Item>
		<DropdownMenu.Item>
			{#snippet child({ props })}
				<a
					{...props}
					href={`https://claude.ai/new?q=${encodeURIComponent(prompt)}`}
					target="_blank"
					rel="noopener noreferrer"
				>
					<ExternalLink />Open in Claude
				</a>
			{/snippet}
		</DropdownMenu.Item>
		<DropdownMenu.Separator />
		<DropdownMenu.Item>
			{#snippet child({ props })}
				<a {...props} href={resolve('/docs/guide/ai-assistants')}>
					<Info />Using the docs with AI
				</a>
			{/snippet}
		</DropdownMenu.Item>
	</DropdownMenu.Content>
</DropdownMenu.Root>
