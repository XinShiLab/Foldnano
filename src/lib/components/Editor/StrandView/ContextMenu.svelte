<script lang="ts">
	import type { ContextMenuInfo } from '../context/types';

	interface Props {
		contextMenu: ContextMenuInfo;
	}

	let { contextMenu = $bindable() }: Props = $props();

	// Close context menu when clicking outside
	function handleClickOutside(e: MouseEvent) {
		if (contextMenu.visible) {
			const target = e.target as HTMLElement;
			if (!target.closest('.context-menu')) {
				contextMenu.visible = false;
			}
		}
	}
</script>

<svelte:window onclick={handleClickOutside} />

{#if contextMenu.visible}
	<div
		class="absolute z-50 flex flex-col rounded-md border border-gray-300 bg-white shadow-lg"
		style="left: {contextMenu.x + 2}px; top: {contextMenu.y + 2}px;"
	>
		{#each contextMenu.items as item, i (i)}
			{#if item.separator}
				<div class="my-1 h-px bg-gray-200"></div>
			{:else}
				<button
					class=" px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-400"
					onclick={item.action}
					disabled={item.disabled}
				>
					{item.label}
				</button>
			{/if}
		{/each}
	</div>
{/if}
