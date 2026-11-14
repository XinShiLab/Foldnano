<script lang="ts">
	import editorExample from '$lib/assets/landing/showcase/editor-example.webp';
	import oxdnaReplay from '$lib/assets/landing/showcase/oxdna-replay.webp';
	import scriptLabWindow from '$lib/assets/landing/showcase/script-lab-window.webp';

	interface ShowcaseShot {
		id: string;
		label: string;
		caption: string;
		alt: string;
		src: string;
		// Intrinsic pixel size; shots differ in shape and are fitted into one fixed frame.
		width: number;
		height: number;
	}

	// Webp files under src/lib/assets/landing/showcase/, any aspect ratio.
	const SHOTS: ShowcaseShot[] = [
		{
			id: 'editor',
			label: 'Editor',
			caption:
				'Plane, 3D and strand views side by side. Here a honeycomb bundle and a wireframe region share one design, with the plugins panel open.',
			alt: 'Foldnano editor with the plugins panel, a 3D view of a honeycomb bundle and a wireframe region, and the strand view with both regions',
			src: editorExample,
			width: 2692,
			height: 1493,
		},
		{
			id: 'script',
			label: 'Script Lab',
			caption:
				'Write Python against the open design, in a panel or in its own window. The result arrives as one change you apply, and undo if you want.',
			alt: 'Script Lab in its own window, with a Python script and the proposed change in its Apply tab',
			src: scriptLabWindow,
			width: 1440,
			height: 1944,
		},
		{
			id: 'oxdna',
			label: 'oxDNA replay',
			caption:
				'Play an oxDNA trajectory back over your design. Hover a nucleotide to see its strand, and click it to select that strand in the strand view.',
			alt: 'An oxDNA trajectory replayed in the 3D view of a wireframe design, with the oxDNA Replay panel and the strand view',
			src: oxdnaReplay,
			width: 1962,
			height: 1264,
		},
	];

	let active = $state(0);
	const shot = $derived(SHOTS[active]);
	const tabEls: HTMLButtonElement[] = [];

	function onTabKeydown(e: KeyboardEvent): void {
		const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
		if (!step) return;
		e.preventDefault();
		active = (active + step + SHOTS.length) % SHOTS.length;
		tabEls[active]?.focus();
	}

	// Accumulated horizontal travel (px) that flips to the next shot.
	const SWIPE_THRESHOLD = 60;
	// Quiet time (ms) after which the next sideways input always counts as a new gesture.
	const SWIPE_IDLE_MS = 150;
	// Consecutive growing deltas, after the last swipe peaked, that mark a new swipe.
	const SWIPE_RISE_EVENTS = 2;

	let frameEl = $state<HTMLElement>();

	// Sideways wheel input (trackpad swipe, tilt wheel, Shift+wheel) steps through the shots,
	// one step per gesture; vertical wheel input is left alone so the page still scrolls.
	// Trackpad momentum keeps sending decaying deltas after a swipe, so a new swipe that
	// starts before they end is told apart by its deltas growing again (or reversing).
	$effect(() => {
		const el = frameEl;
		if (!el) return;
		let travel = 0;
		let fired = false;
		let firedDir = 0;
		let lastAbs = 0;
		let peaked = false;
		let rising = 0;
		let idle: ReturnType<typeof setTimeout> | undefined;
		const rearm = () => {
			travel = 0;
			fired = false;
			peaked = false;
			rising = 0;
		};
		const onWheel = (e: WheelEvent) => {
			const shiftOnly = e.shiftKey && e.deltaX === 0;
			const dx = shiftOnly ? e.deltaY : e.deltaX;
			const dy = shiftOnly ? 0 : e.deltaY;
			if (Math.abs(dx) <= Math.abs(dy)) return;
			e.preventDefault();
			clearTimeout(idle);
			idle = setTimeout(rearm, SWIPE_IDLE_MS);
			const abs = Math.abs(dx);
			if (fired) {
				if (abs < lastAbs) peaked = true;
				rising = peaked && abs > lastAbs ? rising + 1 : 0;
				lastAbs = abs;
				if (Math.sign(dx) === firedDir && rising < SWIPE_RISE_EVENTS) return;
				rearm();
			}
			lastAbs = abs;
			travel += dx;
			if (Math.abs(travel) < SWIPE_THRESHOLD) return;
			firedDir = Math.sign(travel);
			active = Math.min(SHOTS.length - 1, Math.max(0, active + firedDir));
			fired = true;
		};
		el.addEventListener('wheel', onWheel, { passive: false });
		return () => {
			el.removeEventListener('wheel', onWheel);
			clearTimeout(idle);
		};
	});
</script>

<div
	role="tablist"
	aria-label="Editor views"
	class="flex flex-wrap gap-x-6 gap-y-1 border-b border-[var(--landing-border)]"
>
	{#each SHOTS as s, i (s.id)}
		<button
			bind:this={tabEls[i]}
			type="button"
			role="tab"
			id="showcase-tab-{s.id}"
			aria-selected={i === active}
			aria-controls="showcase-panel"
			tabindex={i === active ? 0 : -1}
			onclick={() => (active = i)}
			onkeydown={onTabKeydown}
			class="-mb-px border-b-2 px-1 pb-2 text-sm transition-colors {i === active
				? 'border-[var(--landing-blue)] font-semibold text-[var(--landing-ink)]'
				: 'border-transparent text-[var(--landing-muted)] hover:text-[var(--landing-ink)]'}"
		>
			{s.label}
		</button>
	{/each}
</div>

<div role="tabpanel" id="showcase-panel" aria-labelledby="showcase-tab-{shot.id}" class="mt-4">
	<p class="max-w-2xl text-sm text-[var(--landing-muted)] sm:text-base">{shot.caption}</p>
	<!-- Fixed-shape frame: shots of any aspect ratio are fitted inside, stacked and
	     cross-faded, so the page never jumps and switching never waits on a lazy load. -->
	<div
		bind:this={frameEl}
		class="relative mt-4 aspect-[16/10] overflow-hidden overscroll-x-contain rounded-xl border border-[var(--landing-border)] bg-[var(--landing-bg)]"
	>
		{#each SHOTS as s, i (s.id)}
			<img
				src={s.src}
				alt={s.alt}
				width={s.width}
				height={s.height}
				loading="lazy"
				decoding="async"
				aria-hidden={i !== active}
				class="absolute inset-0 h-full w-full object-contain p-3 transition-opacity duration-200 sm:p-5 {i ===
				active
					? 'opacity-100'
					: 'pointer-events-none opacity-0'}"
			/>
		{/each}
	</div>
</div>
