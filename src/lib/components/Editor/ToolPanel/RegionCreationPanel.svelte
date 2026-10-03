<script lang="ts">
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import { Hexagon, Square, LineSquiggle } from '@lucide/svelte';
	import type { Part } from '$lib/model/Part';
	import { help } from '$lib/components/help/help';

	// Accepts part prop for compatibility with ToolPanel's <PanelToRender {part} /> call
	interface Props {
		part?: Part;
	}
	// eslint-disable-next-line svelte/no-unused-props
	let _: Props = $props();

	const editorViewContext = getEditorViewContext();

	const basePlanes: { value: 'XY' | 'XZ' | 'YZ'; label: string; description: string }[] = [
		{ value: 'XY', label: 'Top (XY)', description: 'Horizontal plane — normal points up (Z)' },
		{ value: 'XZ', label: 'Front (XZ)', description: 'Frontal plane — normal points forward (Y)' },
		{ value: 'YZ', label: 'Side (YZ)', description: 'Sagittal plane — normal points right (X)' },
	];

	const kindMeta: Record<string, { label: string; icon: typeof Hexagon; color: string }> = {
		HONEYCOMB: { label: 'Honeycomb', icon: Hexagon, color: 'text-blue-500' },
		SQUARE: { label: 'Square', icon: Square, color: 'text-green-500' },
		FREEFORM: { label: 'Freeform', icon: LineSquiggle, color: 'text-purple-500' },
	};

	let meta = $derived(
		editorViewContext.pendingRegionKind
			? kindMeta[editorViewContext.pendingRegionKind]
			: kindMeta['HONEYCOMB']
	);
	let selectedPlane = $derived(editorViewContext.pendingBasePlane);
</script>

<div class="flex flex-col gap-3">
	<!-- Kind badge -->
	<div class="flex items-center gap-2 rounded-md bg-muted/60 px-2 py-1.5">
		{#if meta}
			<meta.icon size={14} class={meta.color} />
			<span class="font-medium">{meta.label} Region</span>
		{/if}
	</div>

	<hr class="border-border" />

	<!-- Base plane selector -->
	<div class="flex flex-col gap-1.5">
		<span class="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase"
			>Base Plane</span
		>
		<div class="grid grid-cols-3 gap-1">
			{#each basePlanes as plane (plane.value)}
				<button
					class="rounded-md border px-1.5 py-1.5 text-center text-[10px] transition-colors
						{selectedPlane === plane.value
						? 'border-primary bg-primary/10 font-semibold text-primary'
						: 'border-border hover:bg-accent hover:text-accent-foreground'}"
					onclick={() => editorViewContext.selectPendingBasePlane(plane.value)}
					{@attach help({
						title: plane.label,
						text: `${plane.description}. You can move or rotate the plane later in the 3D view.`,
						newVsCadnano: true,
					})}
				>
					{plane.label}
				</button>
			{/each}
		</div>
		<p class="text-[10px] text-muted-foreground">
			{basePlanes.find((p) => p.value === selectedPlane)?.description ?? ''}
		</p>
	</div>

	<hr class="border-border" />

	<!-- Action buttons -->
	<div class="flex flex-col gap-1.5">
		<button
			class="w-full rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground
				transition-colors hover:bg-primary/90"
			onclick={() => editorViewContext.confirmRegionCreation()}
			{@attach help({
				text: 'Create the region on the chosen plane. Then add helices in the plane view and route strands in the strand viewer.',
				doc: 'creating-a-design',
			})}
		>
			Create {meta?.label ?? ''} Region Here
		</button>
		<button
			class="w-full rounded-md border border-border px-3 py-1.5 text-xs transition-colors hover:bg-accent"
			onclick={() => editorViewContext.cancelRegionCreation()}
		>
			Cancel
		</button>
	</div>
</div>
