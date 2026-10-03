<script lang="ts">
	import type { Stage } from 'svelte-konva';
	import { Shrink, ImageDown, Trash2 } from '@lucide/svelte/icons';
	import * as ButtonGroup from '$lib/components/ui/button-group/index.js';
	import * as Separator from '$lib/components/ui/separator/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import { getEditorDocumentSession } from '../context/EditorDocumentSession.svelte';
	import { help } from '$lib/components/help/help';
	import { exportStageAsPng } from '../utils';
	import EditorModeToggleGroup from '../Toolbar/EditorModeToggleGroup.svelte';
	import {
		deleteLatticeVirtualHelicesCmd,
		deleteFreeformVirtualHelicesCmd,
	} from '$lib/commands/virtualHelix';

	interface Props {
		stage: Stage | undefined;
	}

	let { stage }: Props = $props();

	const ctx = getEditorViewContext();
	const session = getEditorDocumentSession();

	const hasVhSelection = $derived(
		ctx.selectedLatticeVhIndices.size > 0 || ctx.selectedFreeformVhIndices.size > 0
	);

	function resetScale(viewer: Stage | undefined) {
		if (!viewer) return;
		const s = viewer.node;
		s.scale({ x: 1, y: 1 });
		s.position({ x: 0, y: 0 });
	}

	function deleteSelectedVhs() {
		const part = session.currentDoc.parts[0];
		if (!part) return;
		if (ctx.selectedLatticeVhIndices.size > 0) {
			deleteLatticeVirtualHelicesCmd(
				{ part, vhIndices: ctx.selectedLatticeVhIndices },
				session.historyStack
			);
			ctx.clearSelectedLatticeVhs();
		} else if (ctx.selectedFreeformVhIndices.size > 0) {
			const activeRegion = ctx.activeRegion;
			const selectedInActiveRegion =
				activeRegion?.kind === 'FREEFORM'
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

	<Separator.Root orientation="vertical" class="h-5 shrink-0 self-center" />

	<div class="flex shrink-0 items-center gap-1">
		<span class="px-1 text-[9px] font-medium tracking-[0.14em] text-muted-foreground uppercase"
			>Mode</span
		>
		<EditorModeToggleGroup modes={['PAN', 'SELECT', 'DRAW']} />
	</div>

	<Separator.Root orientation="vertical" class="h-5 shrink-0 self-center" />

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
		</ButtonGroup.Root>
	</div>

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
				onclick={() => stage && exportStageAsPng(stage, `${session.currentDoc.name}_lattice`)}
				{@attach help({ text: 'Download the plane view as a PNG image.' })}
			>
				<ImageDown />
			</Button>
		</ButtonGroup.Root>
	</div>
</div>
