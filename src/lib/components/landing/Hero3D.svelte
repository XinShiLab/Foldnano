<script lang="ts">
	import { onMount } from 'svelte';
	import type { Hero3dHandle } from './hero3dViewer';

	interface Props {
		/** Static illustration shown before the 3D loads and kept permanently on
		 *  reduced-motion / small touch devices (which never load the 3D viewer). */
		illustration: string;
		designUrl: string;
		alt: string;
		/** Fill the parent (hero stage) instead of a fixed 16:9 block; also shifts
		 *  the structure right so a text panel can overlap on the left. */
		fill?: boolean;
		/** Pause rendering/spin and disable dragging (e.g. while content scrolls
		 *  over the hero). Turning it off resumes the auto-rotate. */
		suspended?: boolean;
	}
	let { illustration, designUrl, alt, fill = false, suspended = false }: Props = $props();

	let canvas: HTMLCanvasElement;
	let ready = $state(false);
	let interactive = $state(false);
	let handle = $state<Hero3dHandle>();

	$effect(() => {
		handle?.setActive(!suspended);
	});

	onMount(() => {
		const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		const smallTouch = window.matchMedia('(max-width: 767px) and (pointer: coarse)').matches;
		if (reduced || smallTouch) return; // keep the static poster only

		// Dev-only same-origin preview override (?design=/path.json); used to render
		// stills and to try alternate designs without a rebuild. Not exposed in prod.
		const override = import.meta.env.DEV
			? new URLSearchParams(window.location.search).get('design')
			: null;
		const url = override?.startsWith('/') ? override : designUrl;

		interactive = true;
		let cancelled = false;

		const start = () => {
			import('./hero3dViewer')
				.then(async ({ initHero3d }) => {
					if (cancelled) return;
					handle = await initHero3d(canvas, url, {
						autoRotate: true,
						shiftRight: fill,
						onReady: () => (ready = true),
					});
				})
				.catch((e) => console.error('hero3d init failed', e));
		};

		const ric = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 200));
		const idleId = ric(start);

		return () => {
			cancelled = true;
			if (window.cancelIdleCallback && typeof idleId === 'number')
				window.cancelIdleCallback(idleId);
			handle?.dispose();
		};
	});
</script>

<div class="relative mx-auto w-full {fill ? 'h-full min-h-[16rem]' : 'aspect-[16/9]'}">
	<img
		src={illustration}
		{alt}
		fetchpriority="high"
		class="absolute inset-0 h-full w-full rounded-2xl transition-opacity duration-700 {fill
			? 'object-contain'
			: 'object-cover'} {ready ? 'opacity-0' : 'opacity-100'}"
	/>
	{#if interactive && !ready}
		<div class="absolute inset-0 flex items-center justify-center" aria-hidden="true">
			<div
				class="size-8 animate-spin rounded-full border-2 border-[var(--landing-border)] border-t-[var(--landing-blue)]"
			></div>
		</div>
	{/if}
	<canvas
		bind:this={canvas}
		aria-hidden="true"
		class="absolute inset-0 h-full w-full rounded-2xl transition-opacity duration-700 {ready
			? 'cursor-grab opacity-100 active:cursor-grabbing'
			: 'pointer-events-none opacity-0'}"
	></canvas>
	{#if interactive}
		<p
			class="absolute font-heading text-xs text-[var(--landing-muted)] transition-opacity duration-700 {fill
				? 'right-4 bottom-3 text-right'
				: 'inset-x-0 -bottom-7 text-center'} {ready && !suspended ? 'opacity-100' : 'opacity-0'}"
		>
			drag to rotate
		</p>
	{/if}
</div>
