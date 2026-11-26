<script lang="ts">
	import type { Stage } from 'svelte-konva';
	import {
		Shrink,
		Scan,
		ImageDown,
		Trash2,
		CircleDashed,
		CircleDotDashed,
	} from '@lucide/svelte/icons';
	import * as ButtonGroup from '$lib/components/ui/button-group/index.js';
	import * as Separator from '$lib/components/ui/separator/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import { getEditorDocumentSession } from '../context/EditorDocumentSession.svelte';
	import { help } from '$lib/components/help/help';
	import { exportStageAsPng } from '../utils';
	import EditorModeToggleGroup from '../Toolbar/EditorModeToggleGroup.svelte';
	import { exportBaseName } from '$lib/model/io/designFileName';
	import {
		deleteLatticeVirtualHelicesCmd,
		deleteFreeformVirtualHelicesCmd,
		moveFreeformVirtualHelicesCmd,
	} from '$lib/commands/virtualHelix';
	import { planRadialDistribute } from './radialDistribute';
	import { VIEW_ONLY_PLANE_HELP } from './utils';
	import { scrollStrip } from '$lib/components/scroll-strip/scroll-strip';
	import type VirtualHelix from '$lib/model/VirtualHelix/VirtualHelix.svelte';

	interface Props {
		stage: Stage | undefined;
		fitView?: () => void;
	}

	let { stage, fitView }: Props = $props();

	const ctx = getEditorViewContext();
	const session = getEditorDocumentSession();

	const planeEditable = $derived(ctx.activeRegion?.supportsPlaneViewEditing ?? true);
	const hasVhSelection = $derived(
		planeEditable &&
			(ctx.selectedLatticeVhIndices.size > 0 || ctx.selectedFreeformVhIndices.size > 0)
	);

	const selectedFreeformVhsInActiveRegion = $derived.by(() => {
		const part = ctx.activePart;
		const activeRegion = ctx.activeRegion;
		if (!part || !activeRegion?.supportsFreeformPlacement) return [];
		return Array.from(ctx.selectedFreeformVhIndices)
			.map((vhIndex) => part.getVhByIndex(vhIndex))
			.filter((vh): vh is VirtualHelix => vh?.regionId === activeRegion.id);
	});
	const canDistributeRadially = $derived(
		ctx.canEditActivePart &&
			planeEditable &&
			planRadialDistribute(selectedFreeformVhsInActiveRegion) !== null
	);

	function distributeRadially(faceCenter: boolean) {
		const moves = planRadialDistribute(selectedFreeformVhsInActiveRegion, { faceCenter });
		if (moves) moveFreeformVirtualHelicesCmd({ moves }, session.historyStack);
	}

	function resetScale(viewer: Stage | undefined) {
		if (!viewer) return;
		const s = viewer.node;
		s.scale({ x: 1, y: 1 });
		s.position({ x: 0, y: 0 });
	}

	function deleteSelectedVhs() {
		const part = ctx.activePart;
		if (!part) return;
		if (ctx.selectedLatticeVhIndices.size > 0) {
			deleteLatticeVirtualHelicesCmd(
				{ part, vhIndices: ctx.selectedLatticeVhIndices },
				session.historyStack
			);
			ctx.clearSelectedLatticeVhs();
		} else if (ctx.selectedFreeformVhIndices.size > 0) {
			const activeRegion = ctx.activeRegion;
			const selectedInActiveRegion = activeRegion?.supportsFreeformPlacement
				? Array.from(ctx.selectedFreeformVhIndices).filter(
						(vhIndex) => part.getVhByIndex(vhIndex)?.regionId === activeRegion.id
					)
				: [];
			if (selectedInActiveRegion.length > 0) {
				deleteFreeformVirtualHelicesCmd(
					{ part, vhIndices: selectedInActiveRegion },
					session.historyStack
				);
			}
			ctx.clearSelectedFreeformVhs();
		}
	}
</script>

<div
	class="flex h-8 min-w-0 flex-1 scrollbar-none items-center gap-2 overflow-x-auto overflow-y-hidden px-2 [&::-webkit-scrollbar]:hidden"
	{@attach scrollStrip}
>
	<Button
		variant="ghost"
		size="icon-sm"
		title="Reset view"
		onclick={() => resetScale(stage)}
		{@attach help({ text: 'Reset zoom and pan of the plane view.' })}
	>
		<Shrink />
	</Button>
	{#if fitView}
		<Button
			variant="ghost"
			size="icon-sm"
			title="Fit to helices"
			onclick={fitView}
			{@attach help({ text: 'Zoom and pan so every helix of this region is in view.' })}
		>
			<Scan />
		</Button>
	{/if}

	<Separator.Root orientation="vertical" class="h-5 shrink-0 self-center" />

	<div class="flex shrink-0 items-center gap-1">
		<span class="px-1 text-[9px] font-medium tracking-[0.14em] text-muted-foreground uppercase"
			>Mode</span
		>
		<EditorModeToggleGroup
			modes={['PAN', 'SELECT', 'DRAW']}
			disabledModes={planeEditable ? [] : ['DRAW']}
		/>
	</div>

	<Separator.Root orientation="vertical" class="h-5 shrink-0 self-center" />

	{#if !planeEditable}
		<span
			class="shrink-0 px-1 text-xs whitespace-nowrap text-muted-foreground"
			{@attach help({ text: VIEW_ONLY_PLANE_HELP })}
		>
			Wireframe: select only. Edit helices in the Select panel.
		</span>
	{:else}
		<div class="flex shrink-0 items-center gap-1">
			<span class="px-1 text-[9px] font-medium tracking-[0.14em] text-muted-foreground uppercase"
				>Edit</span
			>
			<ButtonGroup.Root class="shrink-0">
				<Button
					variant="outline"
					size="icon-sm"
					title="Delete selected helices"
					disabled={!hasVhSelection}
					onclick={deleteSelectedVhs}
					{@attach help({
						key: '⌫',
						text: 'Delete the selected helices. In lattice regions only empty helices are removed.',
					})}
				>
					<Trash2 />
				</Button>
				<Button
					variant="outline"
					size="icon-sm"
					title="Distribute in a circle"
					disabled={!canDistributeRadially}
					onclick={() => distributeRadially(false)}
					{@attach help({
						text: 'Space three or more selected perpendicular helices evenly on a circle around their centre, keeping their order and roll.',
					})}
				>
					<CircleDashed />
				</Button>
				<Button
					variant="outline"
					size="icon-sm"
					title="Distribute in a circle, facing the centre"
					disabled={!canDistributeRadially}
					onclick={() => distributeRadially(true)}
					{@attach help({
						text: 'Like Distribute in a circle, and also rolls each helix so roll 0 points at the centre.',
					})}
				>
					<CircleDotDashed />
				</Button>
			</ButtonGroup.Root>
		</div>
	{/if}

	<Separator.Root orientation="vertical" class="h-5 shrink-0 self-center" />

	<div class="flex shrink-0 items-center gap-1">
		<span class="px-1 text-[9px] font-medium tracking-[0.14em] text-muted-foreground uppercase"
			>Export</span
		>
		<ButtonGroup.Root class="shrink-0">
			<Button
				variant="outline"
				size="icon-sm"
				title="Export as image"
				disabled={!stage}
				onclick={() =>
					stage && exportStageAsPng(stage, exportBaseName(session.currentDoc.name, '_lattice'))}
				{@attach help({ text: 'Download the plane view as a PNG image.' })}
			>
				<ImageDown />
			</Button>
		</ButtonGroup.Root>
	</div>
</div>
