<script lang="ts">
	import type { Snippet } from 'svelte';

	import { noticeStack } from '$lib/notices/noticeStack.svelte';

	let { children }: { children?: Snippet } = $props();
</script>

<!-- Messages for the user always appear here, bottom right; reversed so the first child sits in the corner. -->
<div
	class="pointer-events-none fixed right-4 bottom-4 left-4 z-[999] flex flex-col-reverse gap-2 *:pointer-events-auto sm:left-auto sm:w-sm"
>
	{@render children?.()}
	{#if noticeStack.announcement}
		{@render noticeStack.announcement()}
	{/if}
</div>
