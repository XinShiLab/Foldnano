<script lang="ts">
	import type { Part } from '$lib/model/Part/Part.svelte';
	import type { DesignRegion } from '$lib/model/Part/DesignRegion';
	import * as Kbd from '$lib/components/ui/kbd/index.js';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import { isPerpendicularFrame as isPerpendicular } from './rollDial';

	interface Props {
		part: Part;
		region: DesignRegion;
		/** The user just clicked empty space in Select mode with nothing to deselect. */
		nudge: boolean;
	}

	const { part, region, nudge }: Props = $props();

	const editorViewContext = getEditorViewContext();
	const editorMode = $derived(editorViewContext.editorMode);

	const regionVhs = $derived(part.virtualHelices.filter((vh) => vh.regionId === region.id));
	const isEmpty = $derived(regionVhs.length === 0);
	const isFreeform = $derived(region.kind === 'FREEFORM');
	// The hint keeps naming the unused gesture: a user who finds drag may never try double-click.
	const hasPerpendicularVh = $derived(regionVhs.some((vh) => isPerpendicular(vh.localFrame)));
	const hasInPlaneVh = $derived(regionVhs.some((vh) => !isPerpendicular(vh.localFrame)));

	const showModeSwitch = $derived(
		editorMode !== 'DRAW' && (isEmpty || (nudge && editorMode === 'SELECT'))
	);
	const showMissingGesture = $derived(
		editorMode === 'DRAW' && isFreeform && !isEmpty && (!hasPerpendicularVh || !hasInPlaneVh)
	);
	const showEmptyGestures = $derived(editorMode === 'DRAW' && isEmpty);
</script>

{#if showModeSwitch || showMissingGesture || showEmptyGestures}
	<div
		class="pointer-events-none absolute inset-x-4 text-center text-xs leading-relaxed text-muted-foreground select-none {isEmpty
			? 'top-1/4'
			: 'bottom-2'}"
	>
		<div class="inline-block rounded bg-background/85 px-2 py-1">
			{#if showModeSwitch}
				<button
					type="button"
					class="pointer-events-auto text-primary underline-offset-2 hover:underline"
					onclick={() => (editorViewContext.editorMode = 'DRAW')}
				>
					Switch to Draw mode
				</button>
				<Kbd.Root>N</Kbd.Root> to add helices.
			{:else if showEmptyGestures && isFreeform}
				<p><strong>Drag</strong> to draw an in-plane helix.</p>
				<p><strong>Double-click</strong> to add a perpendicular helix.</p>
			{:else if showEmptyGestures}
				<strong>Click</strong> an empty cell to add a helix.
			{:else if !hasPerpendicularVh}
				<strong>Double-click</strong> to add a perpendicular helix.
			{:else}
				<strong>Drag</strong> to draw an in-plane helix.
			{/if}
		</div>
	</div>
{/if}
