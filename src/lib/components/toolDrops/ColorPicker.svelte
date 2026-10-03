<script lang="ts">
	import { generateOKLCHPalette } from '$lib/model/colorGenerator';
	import { RefreshCw } from '@lucide/svelte';
	import ColorPicker from 'svelte-awesome-color-picker';
	import { getEditorViewContext } from '../Editor/context/EditorViewContext.svelte';

	// let { colorContext } = $props();
	let editorViewContext = getEditorViewContext();
	// let colorContext = getColorsContext();
	let colorContext = $derived(editorViewContext.strandViewContext.colorContext);
	let randomColors = $state(generateOKLCHPalette(5));
	let isOpen = $state(false);

	const regenerateColors = () => {
		console.log('regenerating colors');
		randomColors = generateOKLCHPalette(5);
	};

	const setCurrentColor = (color: string) => {
		colorContext.currentColor = color;
	};
</script>

{#snippet color(colorString: string)}
	<div class="rounded-sm bg-white p-0.5">
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div
			class="flex h-5 w-5 flex-none cursor-pointer rounded-sm"
			style="background-color: {colorString};"
			onclick={() => setCurrentColor(colorString)}
		></div>
	</div>
{/snippet}
{#snippet selectedColor(colorString: string)}
	<div class="rounded-sm bg-gray-300 p-0.5">
		<div
			class="flex h-5 w-5 flex-none cursor-pointer rounded-sm"
			style="background-color: {colorString};"
		></div>
	</div>
{/snippet}

<div
	class="relative -z-1 flex min-w-20 flex-row items-center gap-1 overflow-hidden rounded-sm border bg-white px-2 py-0.5 shadow"
>
	<p class="font-mono text-sm text-gray-400">Saved:</p>
	{#if colorContext.savedColors}
		{#each colorContext.savedColors as savedColor, i (i)}
			{#if savedColor !== colorContext.currentColor}
				{@render color(savedColor)}
			{:else}
				{@render selectedColor(savedColor)}
			{/if}
		{/each}
	{/if}
	<!-- <div class="w-5 h-5 rounded-sm flex flex-none cursor-pointer" style="background-color: {color};"></div>
  <div class="w-5 h-5 rounded-sm flex flex-none" style="background-color: {generateRandomOKLCHColor()};"></div>
  <div class="w-5 h-5 rounded-sm flex flex-none" style="background-color: {generateRandomOKLCHColor()};"></div> -->

	<div class="flex h-5 w-1 flex-none border-l-2"></div>
	<button onclick={() => regenerateColors()} class="hover:bg-amber-100"
		><RefreshCw size={12} class="cursor-pointer" />
	</button>

	{#each randomColors as colorCand, i (i)}
		{#if colorCand === colorContext.currentColor}
			{@render selectedColor(colorCand)}
		{:else}
			{@render color(colorCand)}
		{/if}
	{/each}

	<div class="flex h-5 w-1 flex-none border-l-2"></div>
	<p class="font-mono text-sm text-gray-400">Active:</p>
	{@render selectedColor(colorContext.currentColor)}

	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="flex h-5 w-5 flex-none rounded-sm bg-conic/decreasing from-violet-700 via-lime-300 to-violet-700"
		onclick={() => (isOpen = !isOpen)}
	></div>
</div>
{#if isOpen}
	<div class="left-0 my-2 flex flex-col items-end p-0">
		<ColorPicker
			bind:hex={colorContext.currentColor}
			position="responsive"
			bind:isOpen
			isAlpha={false}
			isDialog={false}
			isTextInput={false}
			--input-size="0px"
			--picker-height="100px"
			--cp-border-color="#e5e7eb"
		/>
	</div>
{/if}
