<script lang="ts">
	import { BitsConfig } from 'bits-ui';
	import type { Snippet } from 'svelte';

	let { children, portalTarget }: { children: Snippet; portalTarget: HTMLElement } = $props();
</script>

<!-- Menus and tooltips would otherwise portal into the main window's <body>. -->
<BitsConfig defaultPortalTo={portalTarget}>
	<div class="h-dvh w-screen overflow-hidden bg-background text-foreground">
		{@render children()}
	</div>
</BitsConfig>
