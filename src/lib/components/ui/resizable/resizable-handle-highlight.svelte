<script lang="ts">
	import { onDestroy } from 'svelte';
	import * as ResizablePrimitive from 'paneforge';
	import { cn, type WithoutChildrenOrChild } from '$lib/utils/utils.js';

	const DEFAULT_HOVER_INTENT_DELAY = 300;

	let {
		ref = $bindable(null),
		class: className,
		withHandle = false,
		hoverIntentDelay = DEFAULT_HOVER_INTENT_DELAY,
		...restProps
	}: WithoutChildrenOrChild<ResizablePrimitive.PaneResizerProps> & {
		withHandle?: boolean;
		hoverIntentDelay?: number;
	} = $props();

	let showHoverIntent = $state(false);
	let hoverTimer: ReturnType<typeof setTimeout> | null = null;

	function clearHoverTimer() {
		if (hoverTimer !== null) {
			clearTimeout(hoverTimer);
			hoverTimer = null;
		}
	}

	function startHoverIntent() {
		clearHoverTimer();
		hoverTimer = setTimeout(() => {
			showHoverIntent = true;
			hoverTimer = null;
		}, hoverIntentDelay);
	}

	function stopHoverIntent() {
		clearHoverTimer();
		showHoverIntent = false;
	}

	onDestroy(clearHoverTimer);
</script>

<ResizablePrimitive.PaneResizer
	bind:ref
	data-slot="resizable-handle-highlight"
	data-hover-intent={showHoverIntent ? '' : undefined}
	class={cn(
		'cn-resizable-handle-highlight relative flex w-px items-center justify-center focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:outline-hidden data-[direction=vertical]:h-px data-[direction=vertical]:w-full [&[data-direction=vertical]>div]:rotate-90',
		className
	)}
	onpointerenter={startHoverIntent}
	onpointerleave={stopHoverIntent}
	onblur={stopHoverIntent}
	{...restProps}
>
	{#if withHandle}
		<div class="cn-resizable-handle-highlight__grip z-10 flex h-6 w-1 shrink-0 rounded-none"></div>
	{/if}
</ResizablePrimitive.PaneResizer>

<style>
	:global(.cn-resizable-handle-highlight) {
		color: var(--border);
		transition: color 160ms ease;
	}

	:global(.cn-resizable-handle-highlight::before) {
		content: '';
		position: absolute;
		inset-block: 0;
		left: 50%;
		width: 1px;
		transform: translateX(-50%);
		background-color: currentColor;
		transition:
			width 160ms ease,
			height 160ms ease,
			background-color 160ms ease;
	}

	:global(.cn-resizable-handle-highlight::after) {
		content: '';
		position: absolute;
		inset-block: 0;
		left: 50%;
		width: 0.25rem;
		transform: translateX(-50%);
	}

	:global(.cn-resizable-handle-highlight[data-direction='vertical']::before) {
		inset-inline: 0;
		top: 50%;
		left: 0;
		width: auto;
		height: 1px;
		transform: translateY(-50%);
	}

	:global(.cn-resizable-handle-highlight[data-direction='vertical']::after) {
		inset-inline: 0;
		top: 50%;
		left: 0;
		width: auto;
		height: 0.25rem;
		transform: translateY(-50%);
	}

	.cn-resizable-handle-highlight__grip {
		background-color: currentColor;
		transition: background-color 160ms ease;
	}

	:global(.cn-resizable-handle-highlight[data-hover-intent]),
	:global(.cn-resizable-handle-highlight[data-active]),
	:global(.cn-resizable-handle-highlight:focus-visible) {
		color: var(--primary);
	}

	:global(.cn-resizable-handle-highlight[data-hover-intent]::before),
	:global(.cn-resizable-handle-highlight[data-active]::before),
	:global(.cn-resizable-handle-highlight:focus-visible::before) {
		width: 2px;
	}

	:global(.cn-resizable-handle-highlight[data-direction='vertical'][data-hover-intent]::before),
	:global(.cn-resizable-handle-highlight[data-direction='vertical'][data-active]::before),
	:global(.cn-resizable-handle-highlight[data-direction='vertical']:focus-visible::before) {
		width: auto;
		height: 2px;
	}
</style>
