<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import type { Component } from 'svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import { getEditorViewContext } from '$lib/components/Editor/context/EditorViewContext.svelte';
	import type { Part } from '$lib/model/Part';
	import { createTutorialDesign } from './TutorialPartFactory';

	let StrandViewer: Component<{ part: Part }> | null = $state(null);
	const editorViewContext = getEditorViewContext();
	const part = $derived(editorViewContext.currentDoc.parts[0]);

	onMount(async () => {
		if (!browser) return;
		StrandViewer = (await import('$lib/components/Editor/StrandView/StrandViewer.svelte')).default;
	});

	function resetTutorialDesign() {
		const design = createTutorialDesign();
		editorViewContext.session.replaceCurrentDocumentForTesting(design.doc);
		editorViewContext.setActiveRegion(design.region.id);
	}
</script>

<div class="rounded-md border border-border bg-background">
	<div class="flex items-center justify-between border-b border-border px-3 py-2">
		<div>
			<p class="text-xs font-semibold">Mini StrandView</p>
			<p class="text-[11px] text-muted-foreground">Sandboxed tutorial design</p>
		</div>
		<Button variant="outline" size="sm" onclick={resetTutorialDesign}>Reset</Button>
	</div>
	<div class="h-80 overflow-hidden">
		{#if StrandViewer && part}
			<StrandViewer {part} />
		{:else}
			<div class="flex h-full items-center justify-center text-sm text-muted-foreground">
				Loading strand tutorial...
			</div>
		{/if}
	</div>
</div>
