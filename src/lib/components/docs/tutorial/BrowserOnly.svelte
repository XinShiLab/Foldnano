<script lang="ts">
	import { browser } from '$app/environment';

	type Props = {
		children: import('svelte').Snippet;
		fallback?: import('svelte').Snippet;
	};

	let { children, fallback }: Props = $props();
</script>

{#if browser}
	{@render children()}
{:else if fallback}
	{@render fallback()}
{/if}
