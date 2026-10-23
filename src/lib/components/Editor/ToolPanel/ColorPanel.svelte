<script lang="ts">
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import { generateOKLCHPalette } from '../../../model/colorGenerator';
	import { RefreshCw } from '@lucide/svelte';
	import ColorPicker from 'svelte-awesome-color-picker';
	import * as Separator from '$lib/components/ui/separator/index.js';

	import { draggable, droppable, type DragDropState } from '@thisux/sveltednd';

	let editorViewContext = getEditorViewContext();
	let colorContext = $derived(editorViewContext.strandViewContext.colorContext);
	// Matches PaintTool: a click paints every oligo owning a selected end.
	let selectedOligoCount = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local scratch set
		const ids = new Set<string>();
		for (const end of editorViewContext.strandViewContext.selected.ends) {
			const id = end.segment.oligo?.id;
			if (id) ids.add(id);
		}
		return ids.size;
	});
	let randomColors = $state(generateOKLCHPalette(20));
	const GRID_SIZE = 20;

	const regenerateColors = () => {
		console.log('regenerating colors');
		randomColors = generateOKLCHPalette(GRID_SIZE);
	};

	const setCurrentColor = (color: string) => {
		colorContext.currentColor = color;
	};

	let isInDropZone = $state(false);
	// Handle drops between containers
	function handleDrop(state: DragDropState<string>) {
		const { draggedItem, sourceContainer, targetContainer } = state;
		if (!targetContainer || sourceContainer === targetContainer) return;

		// Update items based on the drop
		// check if the dragged item is already in savedColors
		if (colorContext.savedColors.includes(draggedItem)) return;
		colorContext.savedColors.push(draggedItem);
		// items = [...items, draggedItem];
	}
</script>

{#snippet color(colorString: string)}
	<div class="rounded-sm bg-transparent p-0.5">
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div
			class="aspect-square w-full cursor-pointer rounded-sm"
			style="background-color: {colorString};"
			title={colorString}
			onclick={() => setCurrentColor(colorString)}
			use:draggable={{ container: 'color', dragData: colorString }}
		></div>
	</div>
{/snippet}
{#snippet selectedColor(colorString: string)}
	<div class="rounded-sm bg-muted p-0.5">
		<div
			class="aspect-square w-full cursor-pointer rounded-sm"
			style="background-color: {colorString};"
			title={colorString}
			use:draggable={{ container: 'color', dragData: colorString }}
		></div>
	</div>
{/snippet}
{#snippet placeholder()}
	<div class="rounded-sm p-0.5">
		<div class="ph aspect-square w-full rounded-sm border border-dashed border-border"></div>
	</div>
{/snippet}

{#snippet placeholderActive()}
	<div class="rounded-sm p-0.5">
		<div class="aspect-square w-full rounded-sm border border-dashed border-sky-300"></div>
	</div>
{/snippet}

<div class="space-y-1">
	<p class="font-medium">Active:</p>
	<div class="w-6">{@render selectedColor(colorContext.currentColor)}</div>
</div>
<div class="space-y-1">
	<p class="font-medium">Saved colors (drop here to save):</p>
	<div
		class="grid grid-cols-10 gap-0.5"
		use:droppable={{
			container: 'savedColor',
			callbacks: {
				onDrop: handleDrop,
				// onDragOver: handleDropEnter,
				// onDragLeave: handleDropLeave
			},
			attributes: {
				draggingClass: '[&>div>.ph]:border-sky-500',
				// dragOverClass: 'bg-sky-100',
			},
		}}
	>
		{#each Array(GRID_SIZE) as _, i (i)}
			{#if colorContext.savedColors && colorContext.savedColors[i]}
				{#if colorContext.savedColors[i] === colorContext.currentColor}
					{@render selectedColor(colorContext.savedColors[i])}
				{:else}
					{@render color(colorContext.savedColors[i])}
				{/if}
			{:else if isInDropZone}
				{@render placeholderActive()}
			{:else}
				{@render placeholder()}
			{/if}
		{/each}
	</div>
</div>

<div class="space-y-1">
	<div class="flex items-center justify-between">
		<p class="font-medium">Random colors:</p>
		<button
			onclick={() => regenerateColors()}
			class="rounded px-1 py-0.5 text-muted-foreground transition hover:bg-amber-100 hover:text-foreground dark:hover:bg-amber-900"
		>
			<RefreshCw size={12} class="cursor-pointer" />
		</button>
	</div>
	<div class="grid grid-cols-10 gap-0.5">
		{#each randomColors as colorCand, _i (_i)}
			{#if colorCand === colorContext.currentColor}
				{@render selectedColor(colorCand)}
			{:else}
				{@render color(colorCand)}
			{/if}
		{/each}
	</div>
</div>

<!-- The picker is --picker-width + 54px wide; 176px leaves room for a scrollbar in the w-70 panel. -->
<div class="cp-wrapper px-0 pt-2">
	<ColorPicker
		bind:hex={colorContext.currentColor}
		isAlpha={false}
		isDialog={false}
		isTextInput={false}
		--input-size="0px"
		--picker-height="100px"
		--picker-width="176px"
	/>
</div>

<Separator.Root class="mt-3" />
<p class="pt-2 text-xs text-muted-foreground">
	{#if selectedOligoCount > 0}
		<span class="font-medium text-foreground"
			>{selectedOligoCount} oligo{selectedOligoCount === 1 ? '' : 's'} selected.</span
		>
		Click anywhere in the strand view to paint them all.
	{:else}
		Click an oligo to paint it. To paint several, select them first (<kbd>v</kbd>), then switch back
		here (<kbd>p</kbd>).
	{/if}
</p>

<style>
	.cp-wrapper {
		--cp-border-color: oklch(0.925 0.005 214.3);
	}
	:global(.dark) .cp-wrapper {
		--cp-border-color: oklch(1 0 0 / 10%);
	}
</style>
