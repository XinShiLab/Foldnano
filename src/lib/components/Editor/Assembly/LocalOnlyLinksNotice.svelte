<script lang="ts">
	import { TriangleAlert } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { breakPartLinkCmd } from '$lib/commands/partLinks';
	import { getEditorDocumentSession } from '../context/EditorDocumentSession.svelte';

	// Shown where a design goes to GitHub: links others can't follow from its repo, because the
	// source is kept only in this browser or is a file in another repo (docs/linked-parts.md).
	const session = getEditorDocumentSession();
	const links = $derived(session.partLinks.unfollowableLinks());
	const quote = (names: string[]) => names.map((name) => `"${name}"`).join(', ');
	const localNames = $derived(quote(links.localOnly.map((part) => part.name)));
	const otherRepoText = $derived(
		links.otherRepo.map(({ part, repo }) => `"${part.name}" (from ${repo})`).join(', ')
	);

	function embed() {
		const parts = [...links.localOnly, ...links.otherRepo.map(({ part }) => part)];
		for (const part of parts) breakPartLinkCmd(session.historyStack, part);
	}
</script>

{#if links.localOnly.length > 0 || links.otherRepo.length > 0}
	<div
		class="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
	>
		<TriangleAlert size={14} class="mt-0.5 shrink-0" />
		<div class="flex flex-1 flex-col gap-1.5">
			{#if links.localOnly.length > 0}
				<span
					>{localNames}
					{links.localOnly.length === 1 ? 'is' : 'are'} linked from designs kept only in this browser.
					The commit carries the copies, but others can't follow the links. Publish those designs to this
					repo first, then use Update from source in the Assembly panel; or embed the copies.</span
				>
			{/if}
			{#if links.otherRepo.length > 0}
				<span
					>{otherRepoText}
					{links.otherRepo.length === 1 ? 'is' : 'are'} linked from another repo. The commit carries the
					copies, but links are only followed within one repo. Embed the copies, or keep the source designs
					in this repo.</span
				>
			{/if}
			<Button size="sm" variant="outline" class="h-6 self-start text-xs" onclick={embed}
				>Embed copies (break links)</Button
			>
		</div>
	</div>
{/if}
