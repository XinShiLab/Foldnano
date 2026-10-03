<script lang="ts">
	import { browser } from '$app/environment';
	import type { PageData } from './$types';
	import type { Component } from 'svelte';

	let { data }: { data: PageData } = $props();

	// Derive the boolean first: a load-data refresh must not re-run the import and remount the editor.
	const canLoad = $derived(browser && data.alphaAccessGranted);
	const MyCanvas = $derived(
		canLoad
			? import('$lib/components/Editor/Editor.svelte').then((module) => module.default as Component)
			: (new Promise(() => {}) as Promise<Component>)
	);
</script>

<div class="h-dvh w-full overflow-hidden">
	{#await MyCanvas}
		<p>Loading...</p>
	{:then Editor}
		<Editor docId={data.docId} />
	{:catch error}
		<p>Something went wrong: {error.message}</p>
	{/await}
</div>
