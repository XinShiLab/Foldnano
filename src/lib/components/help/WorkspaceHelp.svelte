<script lang="ts">
	import { untrack } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import { SvelteMap } from 'svelte/reactivity';

	import { resolve } from '$app/paths';
	import * as Kbd from '$lib/components/ui/kbd/index.js';

	import {
		canvasHelpRegistry,
		helpRegistry,
		MAX_CANVAS_HELP_NOTES,
		resolveHelpTitle,
		type CanvasHelpAnchor,
		type HelpSpec,
	} from './help';
	import { leaderLine, placeNotes, type NoteRequest, type Rect } from './helpLayout';
	import ShortcutCard from './ShortcutCard.svelte';

	interface Props {
		/** Only help targets inside this element are shown. */
		root: HTMLElement | undefined;
		/** First visit: adds a prominent "how to close" hint. */
		firstVisit?: boolean;
		onClose: () => void;
	}

	let { root, firstVisit = false, onClose }: Props = $props();

	type HelpTarget = HTMLElement | CanvasHelpAnchor;

	interface PlacedHelp {
		target: HelpTarget;
		spec: HelpSpec;
		title: string | undefined;
		box: Rect;
		/** Pinned caption (areas and canvas anchors) rather than a hover card. */
		pinned: boolean;
		canvas: boolean;
	}

	type NoteKey = HelpTarget | 'hover';

	const CAPTION_MAX_WIDTH = 256;
	const CARD_WIDTH = 288;
	const FIXED_INSET = 24;
	const PILL_TOP = 12;

	// Raw: a deep proxy would wrap canvas anchors and specs, so identity checks (sameLayout, keyed
	// each) would fail every frame and rebuild the notes under the pointer.
	let placed = $state.raw<PlacedHelp[]>([]);
	let hovered = $state.raw<PlacedHelp | null>(null);
	let layer: HTMLDivElement | undefined;
	let hoverCard = $state<HTMLElement | null>(null);
	let viewportWidth = $state(0);
	let viewportHeight = $state(0);

	// Rendered note sizes, measured before layout; keys are the target element, 'hover', or a
	// fixed card id.
	const sizes = new SvelteMap<NoteKey | 'shortcuts' | 'pill', { width: number; height: number }>();

	function trackSize(key: NoteKey | 'shortcuts' | 'pill'): Attachment<HTMLElement> {
		return (element) => {
			const observer = new ResizeObserver(() =>
				sizes.set(key, { width: element.offsetWidth, height: element.offsetHeight })
			);
			observer.observe(element);
			return () => {
				observer.disconnect();
				sizes.delete(key);
			};
		};
	}

	// Hover tooltips come and go with the pointer; letting them hide controls moves the captions.
	function isTooltip(el: Element): boolean {
		if (el.closest('[data-slot="tooltip-content"]')) return true;
		const wrapper = el.closest('[data-bits-floating-content-wrapper]');
		return wrapper?.querySelector(':scope > [data-slot="tooltip-content"]') != null;
	}

	function isOnScreen(box: Rect): boolean {
		if (box.width <= 0 || box.height <= 0) return false;
		if (box.left + box.width <= 0 || box.top + box.height <= 0) return false;
		return box.left < window.innerWidth && box.top < window.innerHeight;
	}

	// Controls clipped by a scrolling toolbar or covered by a floating panel fail this hit test.
	// Skip the overlay's own notes: a caption or hover card over a control must not hide it, or
	// placement and hover feed back into visibility and the notes flicker.
	function hitAtCentre(box: Rect): Element | undefined {
		return document
			.elementsFromPoint(box.left + box.width / 2, box.top + box.height / 2)
			.find((el) => !layer?.contains(el) && !isTooltip(el));
	}

	function isShown(element: HTMLElement, spec: HelpSpec, box: Rect): boolean {
		if (!isOnScreen(box)) return false;
		if (spec.area) return true;
		const hit = hitAtCentre(box);
		if (hit === undefined) return false;
		if (element.contains(hit)) return true;
		// Disabled buttons are pointer-events: none, so the hit lands on their parent instead.
		return element.matches(':disabled') && hit === element.parentElement;
	}

	function canvasBox(anchor: CanvasHelpAnchor): Rect | null {
		// Help is optional: an anchor that throws is dropped instead of breaking the frame loop.
		let box: Rect | null;
		try {
			box = anchor.getRect();
		} catch (error) {
			console.warn('Workspace help: dropping a canvas anchor that failed to measure', error);
			canvasHelpRegistry.delete(anchor);
			return null;
		}
		if (!box || !isOnScreen(box)) return null;
		const host = anchor.host.getBoundingClientRect();
		const inHost =
			box.left >= host.left &&
			box.top >= host.top &&
			box.left + box.width <= host.right &&
			box.top + box.height <= host.bottom;
		if (!inHost) return null;
		const hit = hitAtCentre(box);
		return hit !== undefined && anchor.host.contains(hit) ? box : null;
	}

	function measure(): PlacedHelp[] {
		if (!root) return [];
		const next: PlacedHelp[] = [];
		for (const [element, spec] of helpRegistry) {
			if (!root.contains(element)) continue;
			const r = element.getBoundingClientRect();
			const box = { left: r.left, top: r.top, width: r.width, height: r.height };
			if (!isShown(element, spec, box)) continue;
			next.push({
				target: element,
				spec,
				title: resolveHelpTitle(element, spec),
				box,
				pinned: !!spec.area,
				canvas: false,
			});
		}
		let canvasNotes = 0;
		for (const [anchor, spec] of canvasHelpRegistry) {
			if (canvasNotes >= MAX_CANVAS_HELP_NOTES) break;
			if (!root.contains(anchor.host)) continue;
			const box = canvasBox(anchor);
			if (!box) continue;
			next.push({ target: anchor, spec, title: spec.title, box, pinned: true, canvas: true });
			canvasNotes++;
		}
		return next;
	}

	function sameLayout(a: PlacedHelp[], b: PlacedHelp[]): boolean {
		if (a.length !== b.length) return false;
		return a.every((p, i) => {
			const q = b[i];
			return (
				p.target === q.target &&
				p.spec === q.spec &&
				p.title === q.title &&
				Math.abs(p.box.left - q.box.left) < 0.5 &&
				Math.abs(p.box.top - q.box.top) < 0.5 &&
				Math.abs(p.box.width - q.box.width) < 0.5 &&
				Math.abs(p.box.height - q.box.height) < 0.5
			);
		});
	}

	// Re-measure every frame while open: panes resize, panels fly in, and toolbars scroll without
	// any single event covering all of them. Assignments are skipped when nothing moved.
	$effect(() => {
		let frame = 0;
		const tick = () => {
			const next = untrack(measure);
			if (
				!sameLayout(
					next,
					untrack(() => placed)
				)
			)
				placed = next;
			frame = requestAnimationFrame(tick);
		};
		tick();
		return () => cancelAnimationFrame(frame);
	});

	function contains(box: Rect, x: number, y: number): boolean {
		return x >= box.left && x <= box.left + box.width && y >= box.top && y <= box.top + box.height;
	}

	function onPointerMove(e: PointerEvent) {
		if (hoverCard?.contains(e.target as Node)) return;
		let best: PlacedHelp | null = null;
		for (const p of placed) {
			if (p.pinned || !contains(p.box, e.clientX, e.clientY)) continue;
			if (!best || p.box.width * p.box.height < best.box.width * best.box.height) best = p;
		}
		hovered = best && (best.title || best.spec.text) ? best : null;
	}

	const captions = $derived(
		placed
			.filter((p) => p.pinned && (p.title || p.spec.text))
			.sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left)
	);

	// The shortcut card and the first-visit pill are pinned; notes flow around them.
	const fixedObstacles = $derived.by(() => {
		const obstacles: Rect[] = [];
		const card = sizes.get('shortcuts');
		if (card) {
			obstacles.push({
				left: FIXED_INSET,
				top: viewportHeight - FIXED_INSET - card.height,
				...card,
			});
		}
		const pill = sizes.get('pill');
		if (pill) {
			const top = firstVisit ? PILL_TOP : viewportHeight - FIXED_INSET - pill.height;
			obstacles.push({ left: (viewportWidth - pill.width) / 2, top, ...pill });
		}
		return obstacles;
	});

	const viewport = $derived({ width: viewportWidth, height: viewportHeight });

	// Captions also keep off hoverable controls and canvas anchors, or a caption could hide the
	// thing another note points at.
	const controlObstacles = $derived(placed.filter((p) => !p.pinned || p.canvas).map((p) => p.box));

	const captionLayout = $derived(
		placeNotes<NoteKey>(
			captions.map((p): NoteRequest<NoteKey> => ({
				key: p.target,
				target: p.box,
				...(sizes.get(p.target) ?? { width: 0, height: 0 }),
				// Inside would cover the canvas object, which is also an obstacle.
				placement: p.spec.placement ?? (p.canvas ? 'below' : 'inside'),
			})),
			[...fixedObstacles, ...controlObstacles],
			viewport
		)
	);

	// Laid out after the captions so hovering never makes pinned captions jump.
	const hoverRect = $derived.by(() => {
		if (!hovered) return null;
		const size = sizes.get('hover') ?? { width: CARD_WIDTH, height: 0 };
		return (
			placeNotes<NoteKey>(
				[
					{
						key: 'hover',
						target: hovered.box,
						...size,
						placement: 'below',
						alternatives: ['above', 'right', 'left'],
					},
				],
				[...fixedObstacles, ...captionLayout.values()],
				viewport
			).get('hover') ?? null
		);
	});

	function position(rect: Rect | null | undefined): string {
		return rect ? `left:${rect.left}px;top:${rect.top}px` : 'visibility:hidden';
	}
</script>

<svelte:window
	bind:innerWidth={viewportWidth}
	bind:innerHeight={viewportHeight}
	onpointermove={onPointerMove}
	onkeydown={(e) => {
		if (e.key === 'Escape') onClose();
	}}
/>

<div
	bind:this={layer}
	class="pointer-events-none fixed inset-0 z-[998]"
	role="dialog"
	aria-modal="false"
	aria-label="Workspace help"
>
	<!-- Light frosting: marks help mode while the workspace underneath stays readable. -->
	<div
		class="absolute inset-0 bg-background/25 backdrop-blur-[1.5px] backdrop-saturate-[0.6]"
	></div>

	<svg class="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
		{#each captions as p (p.target)}
			{@const rect = captionLayout.get(p.target)}
			<rect
				x={p.box.left + 1}
				y={p.box.top + 1}
				width={Math.max(0, p.box.width - 2)}
				height={Math.max(0, p.box.height - 2)}
				rx="6"
				class="fill-none stroke-primary/45"
				stroke-width="1.5"
				stroke-dasharray="6 4"
			/>
			{#if rect && sizes.has(p.target)}
				{@const line = leaderLine(rect, p.box)}
				{#if line}
					<line {...line} class="stroke-primary/70" stroke-width="1.5" stroke-dasharray="4 3" />
					<circle cx={line.x2} cy={line.y2} r="3" class="fill-primary/80" />
				{/if}
			{/if}
		{/each}
		{#if hovered}
			<rect
				x={hovered.box.left - 2}
				y={hovered.box.top - 2}
				width={hovered.box.width + 4}
				height={hovered.box.height + 4}
				rx="5"
				class="fill-none stroke-primary"
				stroke-width="1.5"
				stroke-dasharray="4 3"
			/>
			{#if hoverRect && sizes.has('hover')}
				{@const line = leaderLine(hoverRect, hovered.box)}
				{#if line}
					<line {...line} class="stroke-primary" stroke-width="1.5" stroke-dasharray="4 3" />
				{/if}
			{/if}
		{/if}
	</svg>

	{#each captions as p (p.target)}
		<div
			class="pointer-events-auto absolute w-max rounded-md border border-primary/40 bg-background/95 px-2.5 py-1.5 text-xs shadow-md"
			style="{position(
				sizes.has(p.target) ? captionLayout.get(p.target) : null
			)};max-width:{CAPTION_MAX_WIDTH}px"
			{@attach trackSize(p.target)}
		>
			<div class="flex items-center gap-1.5">
				{#if p.title}<span class="font-semibold">{p.title}</span>{/if}
				{#if p.spec.newVsCadnano}<span
						class="rounded bg-primary/15 px-1 text-[9px] font-semibold tracking-wide text-primary uppercase"
						>New vs cadnano</span
					>{/if}
			</div>
			{#if p.spec.text}<p class="mt-0.5 text-muted-foreground">{p.spec.text}</p>{/if}
			{#if p.spec.doc}
				<a
					href={resolve('/docs/[...slug]', { slug: `guide/${p.spec.doc}` })}
					target="_blank"
					rel="noopener"
					class="mt-0.5 inline-block text-primary underline-offset-2 hover:underline"
					>Learn more →</a
				>
			{/if}
		</div>
	{/each}

	{#each placed as p (p.target)}
		{#if p.spec.key}
			<div class="absolute" style="left:{p.box.left + 5}px;top:{p.box.top - 16}px">
				<Kbd.Root class="shadow-sm">{p.spec.key}</Kbd.Root>
			</div>
		{/if}
	{/each}

	{#if hovered}
		<div
			bind:this={hoverCard}
			class="pointer-events-auto absolute rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg"
			style="{position(sizes.has('hover') ? hoverRect : null)};width:{CARD_WIDTH}px"
			{@attach trackSize('hover')}
		>
			<div class="flex items-center justify-between gap-2">
				<span class="font-semibold">{hovered.title}</span>
				{#if hovered.spec.key}<Kbd.Root>{hovered.spec.key}</Kbd.Root>{/if}
			</div>
			{#if hovered.spec.newVsCadnano}<span
					class="mt-1 inline-block rounded bg-primary/15 px-1 text-[9px] font-semibold tracking-wide text-primary uppercase"
					>New vs cadnano</span
				>{/if}
			{#if hovered.spec.text}<p class="mt-1 text-muted-foreground">{hovered.spec.text}</p>{/if}
			{#if hovered.spec.doc}
				<a
					href={resolve('/docs/[...slug]', { slug: `guide/${hovered.spec.doc}` })}
					target="_blank"
					rel="noopener"
					class="mt-1 inline-block text-primary underline-offset-2 hover:underline">Learn more →</a
				>
			{/if}
		</div>
	{/if}

	<!-- Clicks pass through to the editor, so the way out must always be on screen. The welcome
	     sits at the top once; later opens use a compact pill clear of the toolbar. -->
	<div
		class="pointer-events-auto absolute left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full border border-primary/40 bg-background px-4 py-2 text-sm shadow-lg"
		style={firstVisit ? `top:${PILL_TOP}px` : `bottom:${FIXED_INSET}px`}
		{@attach trackSize('pill')}
	>
		<span>
			{#if firstVisit}
				<span class="font-semibold">Welcome to Foldnano.</span>
				Hover over anything for a short explanation. Press <Kbd.Root>?</Kbd.Root> any time to see this
				again.
			{:else}
				<span class="font-semibold">Workspace help is on.</span>
				Hover over any control for details.
			{/if}
		</span>
		<button
			class="flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
			onclick={onClose}
		>
			Close <Kbd.Root class="h-4 bg-primary-foreground/20 text-primary-foreground">Esc</Kbd.Root>
		</button>
	</div>

	<div
		class="pointer-events-auto absolute"
		style="left:{FIXED_INSET}px;bottom:{FIXED_INSET}px"
		{@attach trackSize('shortcuts')}
	>
		<ShortcutCard />
	</div>
</div>
