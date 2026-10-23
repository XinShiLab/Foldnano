<script lang="ts">
	import { type Stage } from 'svelte-konva';
	import {
		Shrink,
		ArrowLeftFromLine,
		ArrowRightFromLine,
		TextAlignStart,
		TextAlignEnd,
		TextAlignJustify,
		Highlighter,
		Trash2,
		CopyPlus,
		Layers2,
		EyeOff,
		LayoutPanelTop,
		Diameter,
	} from '@lucide/svelte/icons';
	import * as Kbd from '$lib/components/ui/kbd/index.js';
	import * as ButtonGroup from '$lib/components/ui/button-group/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as Separator from '$lib/components/ui/separator/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';

	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';

	import { help } from '$lib/components/help/help';
	import { modKeySymbol } from '$lib/utils/platform';
	import { exportBaseName } from '$lib/model/io/designFileName';

	import { removeSelection, startDuplicate } from '../strandActions';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import type { CanHide, CanHighlight, CanWarn } from '../context/types';
	import type { Part } from '$lib/model/Part';
	import EditorModeToggleGroup from '../Toolbar/EditorModeToggleGroup.svelte';

	import Badge from '../../ui/badge/badge.svelte';
	import { exportStageAsPng } from '../utils';
	import { downloadStrandViewSvg } from './exportSvg';
	import { changeRegionLengthCmd } from '$lib/commands/regions';
	import {
		applyEndAlignment,
		planEndAlignment,
		type EndAlignmentAction,
	} from '$lib/canvasEditor/tools/select/handlers/endAlignmentOps';

	interface Props {
		part: Part;
		stage: Stage | undefined;
		updateViewportBounds: () => void;
		updateViewportScale: () => void;
	}

	let { part, stage, updateViewportBounds, updateViewportScale }: Props = $props();

	const ctx = getEditorViewContext();
	const strandCtx = $derived(ctx.strandViewContext);
	const isReadOnly = $derived(!ctx.isTabOwner);

	let history = $derived(ctx.historyStack);
	let hasScaffold = $derived(Array.from(part.oligos).some((o) => o.isScaffold));

	const HIGHLIGHT_LABELS: Partial<Record<CanHighlight, string>> = {
		modification_site: 'with modifications',
	};
	const highlightLabel = (type: CanHighlight) =>
		HIGHLIGHT_LABELS[type] ?? type.replaceAll('_', ' ');

	// let isColorPickerOpen = $derived(ctx.editorMode === 'PAINT');
	// let isEndModificationOpen = $derived(ctx.editorMode === 'MODIFICATION');

	let increaseLengthBy = $state(0);

	// Reset the input when the active region changes — its previous value may
	// not be a valid multiple of the new region's step (e.g. 32 for square,
	// 21 for honeycomb), and clicking extend would otherwise throw.
	$effect(() => {
		void ctx.activeRegionId;
		increaseLengthBy = 0;
	});

	function resetScale(viewer: Stage | undefined) {
		if (!viewer) return;
		const node = viewer.node;
		node.scale({ x: 1, y: 1 });
		node.position({ x: 0, y: 0 });
		updateViewportScale();
		updateViewportBounds();
	}

	const activeRegion = $derived(ctx.activeRegion);

	function reduceUnusedVhLength() {
		const region = activeRegion;
		if (!region) return;
		const regionVhs = part.virtualHelices.filter((vh) => vh.regionId === region.id);
		if (regionVhs.length === 0) return;
		const maxUsed = regionVhs.reduce((m, vh) => Math.max(m, vh.usedLength), 0);
		const step = region.step;
		const currentLength = region.maxBase;
		const newLength = Math.max(Math.ceil(maxUsed / step) * step, 2 * step);
		const delta = newLength - currentLength;
		if (delta !== 0) {
			changeRegionLengthCmd(history, region, delta, `Reduce ${region.name} length`);
		}
	}

	function increaseActiveRegionLengthBy(delta: number) {
		if (!activeRegion || delta <= 0) return;
		changeRegionLengthCmd(history, activeRegion, delta, `Extend ${activeRegion.name} length`);
	}

	function onRemove() {
		removeSelection(part, strandCtx.selected, strandCtx.selectionToggles, history);
	}

	const alignPlans = $derived.by(() => {
		const ends = strandCtx.selected.ends;
		return {
			left: planEndAlignment('left', ends),
			right: planEndAlignment('right', ends),
			justify: planEndAlignment('justify', ends),
		};
	});
	const alignDisabled = $derived(isReadOnly || ctx.editorMode !== 'SELECT');
	const deleteDisabled = $derived(isReadOnly || strandCtx.selected.ends.size === 0);
	const duplicateDisabled = $derived(
		isReadOnly || ctx.editorMode !== 'SELECT' || strandCtx.selected.ends.size === 0
	);

	function onAlign(action: EndAlignmentAction) {
		applyEndAlignment(history, action, strandCtx.selected.ends);
	}

	// let exportImagePixelScale = $state(2);
	let exportImagePixelScale = $derived(2 / ctx.strandViewContext.viewportScale);
	// const isAllScaffoldSequenceLocked = $derived.by(() => {
	//   if (!part || part.oligos.size === 0) return false;
	//   if (!part.hasScaffold) return false;
	//   return Array.from(part.oligos).every(oligo => {
	//     if (oligo.isScaffold) {
	//       return oligo.isSequenceLocked === false ? false : true;
	//     }
	//     return true; // Non-scaffold oligos are ignored
	//   });
	// });
</script>

<div
	class="flex h-8 min-w-0 flex-1 scrollbar-none items-center gap-2 overflow-x-auto overflow-y-hidden [&::-webkit-scrollbar]:hidden"
>
	<!-- Reset View -->
	<ButtonGroup.Root class="shrink-0">
		<Button
			variant="ghost"
			size="icon-sm"
			title="Reset view"
			onclick={() => resetScale(stage)}
			{@attach help({ text: 'Return the strand view to its default zoom and position.' })}
		>
			<Shrink />
		</Button>
	</ButtonGroup.Root>

	<Separator.Root orientation="vertical" class="h-5 shrink-0 self-center" />

	<div class="flex w-full min-w-max items-center gap-1">
		<div class="flex shrink-0 items-center gap-1">
			<span class="px-1 text-[9px] font-medium tracking-[0.14em] text-muted-foreground uppercase"
				>Mode</span
			>
			<EditorModeToggleGroup modes={['PAN', 'SELECT', 'DRAW']} />
			<EditorModeToggleGroup
				modes={['BREAK', 'SKIP', 'INSERT', 'PAINT', 'MODIFICATION', 'SEQUENCE', 'SPLIT_REGION']}
			/>
		</div>

		<Separator.Root orientation="vertical" class="h-5 shrink-0 self-center" />

		<div class="flex shrink-0 items-center gap-1">
			<span class="px-1 text-[9px] font-medium tracking-[0.14em] text-muted-foreground uppercase"
				>View</span
			>
			<Tooltip.Provider>
				<Tooltip.Root>
					<Tooltip.Trigger>
						<Badge
							class={`my-auto h-5 min-w-5 rounded-full px-1 font-mono tabular-nums
            ${part.isAllScaffoldSequenceLocked ? 'bg-lime-800 hover:bg-lime-500 dark:bg-lime-700 dark:hover:bg-lime-500' : 'bg-red-800 hover:bg-red-500 dark:bg-red-700 dark:hover:bg-red-500'}
            transition-all duration-200 hover:cursor-pointer hover:shadow-lg
            `}
							onclick={() => {
								strandCtx.highlightContext.scaffold = !strandCtx.highlightContext.scaffold;
							}}
							{@attach help({
								title: 'Scaffold sequence indicator',
								text: 'Green when every scaffold sequence is applied and current, red when it needs re-applying. Click to highlight the scaffold.',
								doc: 'editing-tools',
							})}>S</Badge
						>
					</Tooltip.Trigger>
					<Tooltip.Content>
						<p>Re-apply your scaffold sequence if this is red!</p>
					</Tooltip.Content>
				</Tooltip.Root>
			</Tooltip.Provider>

			<!-- Highlight / Hide / Remove Actions -->
			<ButtonGroup.Root class="flex-none overflow-hidden">
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								variant="outline"
								size="icon-sm"
								title="Highlight strands"
								{@attach help({
									text: 'Emphasize strands by category (scaffold, circular, modified, too long or too short) and turn sequence-mismatch warnings on or off.',
									doc: 'selection',
								})}
							>
								<Highlighter />
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content class="w-56">
						<DropdownMenu.Group>
							<DropdownMenu.Label>Highlight</DropdownMenu.Label>
							<DropdownMenu.Separator />
							{#each Object.keys(strandCtx.highlightContext) as type (type)}
								<DropdownMenu.CheckboxItem
									value={type}
									bind:checked={strandCtx.highlightContext[type as CanHighlight]}
									closeOnSelect={false}
								>
									{highlightLabel(type as CanHighlight)}
								</DropdownMenu.CheckboxItem>
							{/each}
						</DropdownMenu.Group>
						<DropdownMenu.Group>
							<DropdownMenu.Label>Warnings</DropdownMenu.Label>
							<DropdownMenu.Separator />
							{#each Object.keys(strandCtx.warningContext) as type (type)}
								<DropdownMenu.CheckboxItem
									value={type}
									bind:checked={strandCtx.warningContext[type as CanWarn]}
									closeOnSelect={false}
								>
									sequence {type.replaceAll('_', ' ')}
								</DropdownMenu.CheckboxItem>
							{/each}
						</DropdownMenu.Group>
					</DropdownMenu.Content>
				</DropdownMenu.Root>

				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								variant="outline"
								size="icon-sm"
								title="Hide strands"
								{@attach help({
									text: 'Hide crossovers, connections or sequence letters in the strand view.',
								})}
							>
								<EyeOff />
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content class="w-56">
						<DropdownMenu.Group>
							<DropdownMenu.Label>Hide</DropdownMenu.Label>
							<DropdownMenu.Separator />
							{#each Object.keys(strandCtx.hideContext) as type (type)}
								<DropdownMenu.CheckboxItem
									value={type}
									bind:checked={strandCtx.hideContext[type as CanHide]}
									closeOnSelect={false}
								>
									{type.replaceAll('_', ' ')}
								</DropdownMenu.CheckboxItem>
							{/each}
						</DropdownMenu.Group>
					</DropdownMenu.Content>
				</DropdownMenu.Root>

				<Button
					variant={ctx.showScaffoldMap ? 'default' : 'outline'}
					size="icon-sm"
					title="Circular Scaffold Map"
					disabled={!hasScaffold}
					onclick={() => (ctx.showScaffoldMap = !ctx.showScaffoldMap)}
					{@attach help({
						text: 'A QC view of how staples bind the scaffold, drawn as a circle. Needs an oligo marked as scaffold (right-click an oligo).',
						doc: 'selection',
					})}
				>
					<Diameter />
				</Button>
				<Button
					variant={strandCtx.showBlocks ? 'default' : 'outline'}
					size="icon-sm"
					title={strandCtx.showBlocks ? 'Hide RBS blocks' : 'Show RBS blocks'}
					onclick={() => (strandCtx.showBlocks = !strandCtx.showBlocks)}
					{@attach help({
						title: 'RBS blocks',
						text: 'Shade the rigid blocks that the 3D rigid-body simulation moves as single bodies.',
						doc: 'simulation-export',
					})}
				>
					<LayoutPanelTop />
				</Button>
				<!-- <Input bind:value={exportImagePixelScale} type='text' class='w-8  px-2' /> -->
				<Button
					variant="outline"
					size="icon-sm"
					title="Export as PNG"
					disabled={!stage}
					onclick={() =>
						stage &&
						exportStageAsPng(
							stage,
							exportBaseName(ctx.currentDoc.name, '_route'),
							exportImagePixelScale
						)}
					{@attach help({ text: 'Download the strand view as a PNG image.' })}
				>
					<span class="text-[10px] leading-none font-semibold">PNG</span>
				</Button>
				<Button
					variant="outline"
					size="icon-sm"
					title="Export as SVG (with sequences)"
					onclick={() =>
						downloadStrandViewSvg(part, exportBaseName(ctx.currentDoc.name, '_route.svg'))}
					{@attach help({ text: 'Download the strand view as an SVG, including sequences.' })}
				>
					<span class="text-[10px] leading-none font-semibold">SVG</span>
				</Button>
			</ButtonGroup.Root>
		</div>

		<Separator.Root orientation="vertical" class="h-5 shrink-0 self-center" />

		<div class="flex shrink-0 items-center gap-1">
			<span class="px-1 text-[9px] font-medium tracking-[0.14em] text-muted-foreground uppercase"
				>Edit</span
			>
			<ButtonGroup.Root class="overflow-hidden">
				<Button
					variant="outline"
					size="icon-sm"
					title="Align free ends left"
					disabled={alignDisabled || !alignPlans.left}
					onclick={() => onAlign('left')}
					{@attach help({
						text: 'Move the selected free ends to the leftmost selected position. Crossover ends never move.',
						doc: 'selection',
					})}
				>
					<TextAlignStart />
				</Button>
				<Button
					variant="outline"
					size="icon-sm"
					title="Justify selected segment ends"
					disabled={alignDisabled || !alignPlans.justify}
					onclick={() => onAlign('justify')}
					{@attach help({
						text: 'Align the left ends of the selected segments to the leftmost one, and their right ends to the rightmost one.',
						doc: 'selection',
					})}
				>
					<TextAlignJustify />
				</Button>
				<Button
					variant="outline"
					size="icon-sm"
					title="Align free ends right"
					disabled={alignDisabled || !alignPlans.right}
					onclick={() => onAlign('right')}
					{@attach help({
						text: 'Move the selected free ends to the rightmost selected position. Crossover ends never move.',
						doc: 'selection',
					})}
				>
					<TextAlignEnd />
				</Button>
				<Button
					variant="outline"
					size="icon-sm"
					title="Delete selection"
					disabled={deleteDisabled}
					onclick={onRemove}
					{@attach help({
						key: '⌫',
						text: 'Remove the selected ends, segments, crossovers or oligos.',
					})}
				>
					<Trash2 />
				</Button>
				<Button
					variant="outline"
					size="icon-sm"
					title="Duplicate selected oligos"
					disabled={duplicateDisabled}
					onclick={() => startDuplicate(part, ctx)}
					{@attach help({
						key: `${modKeySymbol()}D`,
						text: 'Place an independent copy of the selected oligos further along the same helices.',
						doc: 'duplicates-repeat-groups',
					})}
				>
					<CopyPlus />
				</Button>
				<Button
					variant="outline"
					size="icon-sm"
					title="Duplicate as linked mirror copies"
					disabled={duplicateDisabled}
					onclick={() => startDuplicate(part, ctx, { linked: true })}
					{@attach help({
						key: `⇧${modKeySymbol()}D`,
						text: 'Place mirror copies that stay linked: editing one edits every copy.',
						doc: 'duplicates-repeat-groups',
						newVsCadnano: true,
					})}
				>
					<Layers2 />
				</Button>
			</ButtonGroup.Root>
		</div>

		<Separator.Root orientation="vertical" class="h-5 shrink-0 self-center" />

		<!-- Virtual Helix Length Controls — operates on the ACTIVE region -->
		<div class="flex shrink-0 items-center gap-1">
			<span class="px-1 text-[9px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
				Length{activeRegion ? ` — ${activeRegion.name}` : ''}
			</span>
			<ButtonGroup.Root class="overflow-hidden">
				<Button
					variant="outline"
					size="xs"
					title="Trim unused length"
					disabled={isReadOnly || !activeRegion}
					onclick={reduceUnusedVhLength}
					{@attach help({
						text: 'Shorten every helix of the active region to the smallest length that still fits its strands, in lattice steps.',
					})}
				>
					<ArrowLeftFromLine size={12} />
				</Button>
				<Input
					class="h-6 w-12 px-1 text-xs"
					disabled={isReadOnly || !activeRegion}
					bind:value={increaseLengthBy}
					type="number"
					min={0}
					step={activeRegion?.step ?? 21}
					placeholder="# bps"
					{@attach help({
						title: 'Base pairs to add',
						text: 'Steps by the lattice step: 21 bp for honeycomb, 32 bp for square.',
					})}
				/>
				<Button
					variant="outline"
					size="xs"
					title="Extend region length"
					disabled={isReadOnly || !activeRegion}
					onclick={() => increaseActiveRegionLengthBy(increaseLengthBy)}
					{@attach help({ text: 'Add that many base pairs to every helix of the active region.' })}
				>
					<ArrowRightFromLine />
				</Button>
			</ButtonGroup.Root>
		</div>

		<!-- Shortcut Hint -->
		<div
			class="my-auto ml-auto min-w-36 shrink-0 overflow-clip text-sm text-nowrap text-muted-foreground"
		>
			press<Kbd.Root>?</Kbd.Root> for help
		</div>
	</div>
</div>
