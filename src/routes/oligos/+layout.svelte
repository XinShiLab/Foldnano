<script lang="ts">
	import type { Snippet } from 'svelte';

	import AlphaAccessGate from '$lib/components/AlphaAccessGate.svelte';

	import type { LayoutData } from './$types';

	let { children, data }: { children: Snippet; data: LayoutData } = $props();
</script>

<AlphaAccessGate
	granted={data.alphaAccessGranted}
	title="Beta Testing"
	description="Foldnano is in beta and still under testing. Use it with caution and keep copies of important designs."
>
	{#snippet footer()}
		<p>Do not use it for production work.</p>
		<p>
			Design files are local-first: Foldnano does not provide a server for storing user designs.
			Local work is saved in this browser using IndexedDB, and files are sent to GitHub only if you
			connect GitHub and choose to sync or publish them there.
		</p>
	{/snippet}
	{@render children()}
</AlphaAccessGate>
