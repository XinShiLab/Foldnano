<script lang="ts" module>
	// Remembered for the session so an expanded list stays expanded the next time `?` is pressed.
	let rememberedExpanded = false;
</script>

<script lang="ts">
	import { ChevronRight, Keyboard } from '@lucide/svelte';

	import { resolve } from '$app/paths';
	import * as Kbd from '$lib/components/ui/kbd/index.js';
	import { getEditorViewContext } from '$lib/components/Editor/context/EditorViewContext.svelte';
	import { modKeySymbol, panKeySymbol } from '$lib/utils/platform';

	const ctx = getEditorViewContext();
	const activeViewer = $derived(ctx.activeViewer);

	let expanded = $state(rememberedExpanded);

	function toggle() {
		expanded = !expanded;
		rememberedExpanded = expanded;
	}

	const mod = modKeySymbol();
	const panMod = panKeySymbol();

	const globalShortcuts = [
		{ keys: [mod, 'Z'], label: 'Undo' },
		{ keys: [mod, '⇧', 'Z'], label: 'Redo' },
		{ keys: ['⌫'], label: 'Delete selection' },
		{ keys: [panMod, 'hold'], label: 'Temporary pan' },
		{ keys: ['?'], label: 'Toggle this help' },
		{ keys: ['Esc'], label: 'Close help' },
	];

	const modeShortcuts = [
		{ key: 'v', label: 'Select' },
		{ key: 'n', label: 'Draw strands' },
		{ key: 'b', label: 'Break strand' },
		{ key: 's', label: 'Skip bases' },
		{ key: 'i', label: 'Insert bases' },
		{ key: 'p', label: 'Paint oligo' },
		{ key: 'm', label: 'Modification' },
		{ key: 'a', label: 'Assign sequence' },
		{ key: 'r', label: 'Split region' },
	];

	const view3DShortcuts = [
		{ key: 'g', label: 'Toggle helix grid' },
		{ key: 'e', label: 'Toggle NT model' },
		{ key: 'c', label: 'Toggle cursor' },
		{ key: 'f', label: 'Toggle base planes' },
	];

	const filterShortcuts = [
		{ key: 'c', label: 'Scaffold' },
		{ key: 't', label: 'Staple' },
		{ key: 'e', label: 'Ends' },
		{ key: 'x', label: 'Crossovers' },
		{ key: 'd', label: 'Segments' },
		{ key: 'o', label: 'Oligos' },
	];
</script>

{#snippet section(title: string, rows: { key: string; label: string }[])}
	<section class="mt-3">
		<h3 class="mb-1.5 text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
			{title}
		</h3>
		{#each rows as s (s.key)}
			<div class="flex items-center justify-between py-0.5">
				<span class="text-xs text-foreground">{s.label}</span>
				<Kbd.Root>{s.key}</Kbd.Root>
			</div>
		{/each}
	</section>
{/snippet}

<div
	class="w-68 overflow-y-auto rounded-xl border border-border bg-background/97 p-3 shadow-2xl"
	style="max-height: calc(100vh - 5rem);"
>
	<div class="flex items-center justify-between gap-2">
		<button
			class="-ml-1 flex items-center gap-1.5 rounded px-1 py-0.5 text-sm font-bold tracking-wide hover:bg-muted"
			onclick={toggle}
			aria-expanded={expanded}
		>
			<ChevronRight size={14} class="transition-transform {expanded ? 'rotate-90' : ''}" />
			<Keyboard size={14} class="text-muted-foreground" />
			Keyboard Shortcuts
		</button>
	</div>

	<p class="mt-1 text-[10px] text-muted-foreground">
		Hover over a control for details. <Kbd.Root>?</Kbd.Root> or <Kbd.Root>Esc</Kbd.Root> closes.
		<a
			href={resolve('/docs/[...slug]', { slug: 'guide/getting-started' })}
			target="_blank"
			rel="noopener"
			class="text-primary underline-offset-2 hover:underline">User guide →</a
		>
	</p>

	{#if expanded}
		<section class="mt-3">
			<h3 class="mb-1.5 text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
				Global
			</h3>
			{#each globalShortcuts as s (s.label)}
				<div class="flex items-center justify-between py-0.5">
					<span class="text-xs text-foreground">{s.label}</span>
					<span class="flex gap-0.5">
						{#each s.keys as k (k)}
							<Kbd.Root>{k}</Kbd.Root>
						{/each}
					</span>
				</div>
			{/each}
		</section>

		{@render section('Editor Modes', modeShortcuts)}
		{#if activeViewer === 'STRAND'}
			{@render section('Selection Filters', filterShortcuts)}
		{/if}
		{#if activeViewer === 'VIEW3D'}
			{@render section('3D View', view3DShortcuts)}
		{/if}
	{/if}
</div>
