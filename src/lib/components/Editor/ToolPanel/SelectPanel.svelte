<script lang="ts">
	import { FILTER_TOGGLE_CLASS, SCAF_TOGGLE_CLASS, STAP_TOGGLE_CLASS } from './filterToggleClasses';
	import { Paintbrush, Tag, TextAlignJustify, X } from '@lucide/svelte/icons';
	import { Button } from '$lib/components/ui/button/index.js';
	import { toggleOligoAsScaffoldCmd } from '$lib/commands/strands';
	import type { OligoSegment, SegmentEnd } from '$lib/model/Oligo';
	import {
		countModifications,
		formatSelectionCounts,
		selectionItemCount,
		summarizeEndSelection,
	} from '$lib/canvasEditor/tools/select/selectionSummary';
	import EndsIcon from '$lib/components/icons/EndsIcon.svelte';
	import CrossoverIcon from '$lib/components/icons/CrossoverIcon.svelte';
	import OligoIcon from '$lib/components/icons/OligoIcon.svelte';
	import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
	import * as Select from '$lib/components/ui/select/index.js';

	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import { help } from '$lib/components/help/help';
	import { type SelectAllMode, type SelectionToggle } from '../context/types';
	import { Label } from '../../ui/label';
	import type Oligo from '$lib/model/Oligo';
	import { getModificationColor } from '$lib/model/modifications';
	import RepeatGroupPanel from './RepeatGroupPanel.svelte';
	import FreeformVhPanel from './FreeformVhPanel.svelte';
	import OligoNameField from './OligoNameField.svelte';

	type ModificationEntry = { label: string; name: string; color: string };

	function oligoModifications(oligo: Oligo): ModificationEntry[] {
		return Array.from(oligo.allEnds)
			.filter((end) => end.modification !== null)
			.map((end) => {
				const name = end.modification as string;
				return {
					label: end.isThreePrime ? "3'" : "5'",
					name,
					color: getModificationColor(name, oligo.inPart.customModifications),
				};
			});
	}

	const ctx = getEditorViewContext();
	const strandCtx = $derived(ctx.strandViewContext);
	let selectionToggles = $derived(strandCtx.selectionToggles);

	export function onClickOligoToggle() {
		const toggles = selectionToggles;
		const hasAnyToggle = (['OLIGO', 'XOVER', 'END', 'SEGMENT'] as SelectionToggle[]).some((t) =>
			toggles.includes(t)
		);
		if (!hasAnyToggle) {
			strandCtx.selectionToggles = [...toggles, 'XOVER', 'END', 'SEGMENT'];
		}
	}

	type QuickSelectOption = {
		value: SelectAllMode;
		label: string;
		enabledFor?: SelectionToggle;
	};
	const quickSelect: QuickSelectOption[] = [
		{ value: 'NONE', label: 'Where I click ' },
		{ value: 'SAME_COLOR', label: 'Same Color', enabledFor: 'OLIGO' },
		{ value: 'SAME_LENGTH', label: 'Same Length', enabledFor: 'OLIGO' },
		{ value: 'SAME_MODI', label: 'Same Modification', enabledFor: 'END' },
	];

	// let quickSelectValue = $state("");

	const triggerContent = $derived(
		quickSelect.find((f) => f.value === strandCtx.selectAllMode)?.label ?? 'what you click'
	);

	const summary = $derived(summarizeEndSelection(strandCtx.selected.ends));
	const itemCount = $derived(selectionItemCount(summary));
	const touched = $derived(summary.touchedOligos);
	const touchedLength = $derived(touched.reduce((sum, oligo) => sum + oligo.length, 0));
	const touchedColors = $derived([...new Set(touched.map((oligo) => oligo.color))]);
	const scaffoldCount = $derived(touched.filter((oligo) => oligo.isScaffold).length);
	const freeSelectedEnds = $derived([...strandCtx.selected.ends].filter((end) => end.isFree));
	const selectedModifications = $derived(
		countModifications(strandCtx.selected.ends).map((m) => ({
			...m,
			color: getModificationColor(m.name, ctx.currentDoc?.parts[0]?.customModifications ?? []),
		}))
	);
	const isReadOnly = $derived(!ctx.isTabOwner);
	const MAX_SWATCHES = 12;

	const at = (end: SegmentEnd | null | undefined) =>
		end ? `${end.inVirtualHelix.index}[${end.index}]` : '?';
	const span = (from: SegmentEnd | null | undefined, to: SegmentEnd | null | undefined) =>
		`${at(from)} -> ${at(to)}`;

	/** Paint and Modification apply to the whole selection on the next canvas click; switching
	 * tools keeps the selection. */
	function handOffTo(mode: 'PAINT' | 'MODIFICATION') {
		ctx.editorMode = mode;
	}

	function setTouchedAsScaffold(isScaffold: boolean) {
		const oligos = touched.filter((oligo) => oligo.isScaffold !== isScaffold);
		if (oligos.length > 0) {
			toggleOligoAsScaffoldCmd(
				oligos.map((oligo) => ({ oligo })),
				ctx.historyStack
			);
		}
	}
</script>

<div class="flex flex-row gap-2">
	<!-- Scaffold/Staple Filter -->
	<ToggleGroup.Root
		type="multiple"
		variant="outline"
		disabled={ctx.editorMode !== 'SELECT'}
		bind:value={strandCtx.selectionToggles}
	>
		<ToggleGroup.Item
			value="SCAF"
			class={SCAF_TOGGLE_CLASS}
			{@attach help({
				key: 'c',
				title: 'Scaffold',
				text: 'Include scaffold strands in what a click selects.',
			})}
		>
			SCAF
		</ToggleGroup.Item>
		<ToggleGroup.Item
			value="STAP"
			class={STAP_TOGGLE_CLASS}
			{@attach help({
				key: 't',
				title: 'Staples',
				text: 'Include staple strands in what a click selects.',
			})}
		>
			STAP
		</ToggleGroup.Item>
	</ToggleGroup.Root>

	<!-- Selection Type Toggles -->
	<ToggleGroup.Root
		type="multiple"
		variant="outline"
		disabled={ctx.editorMode !== 'SELECT'}
		bind:value={strandCtx.selectionToggles}
	>
		<ToggleGroup.Item
			value="END"
			class="w-10 {FILTER_TOGGLE_CLASS}"
			{@attach help({
				key: 'e',
				title: 'Ends',
				text: "Click picks a single 5' or 3' end; drag selected ends to resize strands.",
			})}
		>
			<EndsIcon />
		</ToggleGroup.Item>
		<ToggleGroup.Item
			value="XOVER"
			class={FILTER_TOGGLE_CLASS}
			{@attach help({
				key: 'x',
				title: 'Crossovers',
				text: 'Click picks a crossover between two helices.',
			})}
		>
			<CrossoverIcon />
		</ToggleGroup.Item>
		<ToggleGroup.Item
			value="SEGMENT"
			class={FILTER_TOGGLE_CLASS}
			{@attach help({
				key: 'd',
				title: 'Segments',
				text: 'Click picks a whole segment, meaning both of its ends.',
			})}
		>
			<TextAlignJustify />
		</ToggleGroup.Item>
		<ToggleGroup.Item
			value="OLIGO"
			class={FILTER_TOGGLE_CLASS}
			onclick={onClickOligoToggle}
			{@attach help({
				key: 'o',
				title: 'Oligos',
				text: 'Click picks every end of the clicked oligo.',
			})}
		>
			<OligoIcon />
		</ToggleGroup.Item>
		<!-- <ToggleGroup.Item value="VH">
				<CircleSmall />
			</ToggleGroup.Item> -->
	</ToggleGroup.Root>
</div>
<div class="mt-2 flex flex-row">
	<Label for="quickSelection" class="mr-2 text-xs">Select:</Label>
	<Select.Root type="single" name="quickSelection" bind:value={strandCtx.selectAllMode}>
		<Select.Trigger
			class="w-[180px]"
			size="sm"
			{@attach help({
				title: 'Select all with',
				text: 'Grow a click to every oligo with the same color or length, or every end with the same modification.',
			})}
		>
			{triggerContent}
		</Select.Trigger>
		<Select.Content>
			<Select.Group>
				<Select.Label>Select all with</Select.Label>
				{#each quickSelect as q (q.value)}
					<Select.Item
						value={q.value}
						label={q.label}
						disabled={q.enabledFor && !strandCtx.selectionFilter.has(q.enabledFor)}
						class="text-xs"
					>
						{q.label}
					</Select.Item>
				{/each}
			</Select.Group>
		</Select.Content>
	</Select.Root>
</div>

{#snippet color(colorString: string)}
	<div
		class="inline-block h-3 w-3 rounded-sm bg-transparent p-0.5 align-middle"
		style="background-color: {colorString};"
	></div>
{/snippet}

{#snippet modifications(oligo: Oligo)}
	{@const entries = oligoModifications(oligo)}
	{#if entries.length === 0}
		none
	{:else}
		{#each entries as entry, i (entry.label + entry.name)}
			{#if i > 0}<span>, </span>{/if}<span
				class="inline-block h-2.5 w-2.5 rounded-full align-middle"
				style="background-color: {entry.color};"
			></span>
			{entry.label}
			{entry.name}
		{/each}
	{/if}
{/snippet}

{#snippet oligoDetail(oligo: Oligo, heading: string)}
	<div class="mt-2 border-t border-border pt-2">
		<p>{heading}</p>
		<div class="flex items-center gap-1">
			<span>Name:</span>
			<OligoNameField {oligo} />
		</div>
		{#if oligo.isCircular}
			<p>(circular)</p>
		{:else}
			<p>{span(oligo.fivePrime, oligo.threePrime)}</p>
		{/if}
		<p>Length: {oligo.length}</p>
		<p>Color: <span>{@render color(oligo.color)}</span></p>
		<p>isScaffold: {oligo.isScaffold}</p>
		<p>isLocked: {oligo.isSequenceLocked}</p>
		<p>Modifications: {@render modifications(oligo)}</p>
	</div>
{/snippet}

{#snippet segmentDetail(segment: OligoSegment)}
	<p>Segment: {span(segment.fivePrime, segment.threePrime)}</p>
	<p>Length: {segment.length}</p>
	{#if segment.oligo}{@render oligoDetail(segment.oligo, 'Belongs to oligo:')}{/if}
{/snippet}

{#snippet endDetail(end: SegmentEnd)}
	<p>{end.isThreePrime ? "3'" : "5'"} end: {at(end)}</p>
	<p>
		{#if end.isFree}
			Free end
		{:else}
			Connected to {at(end.connectedEnd)}
		{/if}
	</p>
	<p>Modification: {end.modification ?? 'none'}</p>
	{#if end.segment.oligo}{@render oligoDetail(end.segment.oligo, 'Belongs to oligo:')}{/if}
{/snippet}

<div
	class="mt-2 flex-grow rounded-md border border-border p-2 font-mono text-xs text-muted-foreground"
	{@attach help({
		title: 'Selection',
		text: 'What is selected, counted as whole oligos, segments, crossovers and loose ends. One item shows its details; several show what they have in common.',
		doc: 'selection',
	})}
>
	{#if itemCount === 0}
		<p>Nothing selected. Click or drag on the strands to select.</p>
	{:else}
		<div class="flex items-start justify-between gap-2">
			<p class="font-medium text-foreground">{formatSelectionCounts(summary)}</p>
			<Button
				variant="ghost"
				size="icon-xs"
				title="Clear selection (Esc)"
				onclick={() => strandCtx.selected.clear()}
			>
				<X />
			</Button>
		</div>

		{#if itemCount === 1}
			<div class="mt-1">
				{#if summary.oligos.length === 1}
					{@render oligoDetail(summary.oligos[0], 'Oligo:')}
				{:else if summary.segments.length === 1}
					{@render segmentDetail(summary.segments[0])}
				{:else if summary.crossovers.length === 1}
					{@const xover = summary.crossovers[0]}
					<p>Crossover: {span(xover.from, xover.to)}</p>
					{#if xover.from.segment.oligo}
						{@render oligoDetail(xover.from.segment.oligo, 'Belongs to oligo:')}
					{/if}
				{:else if summary.ends.length === 1}
					{@render endDetail(summary.ends[0])}
				{/if}
			</div>
		{:else}
			<div class="mt-2 border-t border-border pt-2">
				<p>
					Oligos touched: {touched.length}
					{#if scaffoldCount > 0}({scaffoldCount} scaffold){/if}
				</p>
				<p>Total length: {touchedLength} nt</p>
				<p class="flex flex-wrap items-center gap-1">
					Colors:
					{#each touchedColors.slice(0, MAX_SWATCHES) as c (c)}
						<span title={c}>{@render color(c)}</span>
					{/each}
					{#if touchedColors.length > MAX_SWATCHES}
						<span>+{touchedColors.length - MAX_SWATCHES}</span>
					{/if}
				</p>
				<p>
					Modifications:
					{#if selectedModifications.length === 0}
						none
					{:else}
						{#each selectedModifications as m, i (m.name)}
							{#if i > 0}<span>, </span>{/if}<span
								class="inline-block h-2.5 w-2.5 rounded-full align-middle"
								style="background-color: {m.color};"
							></span>
							{m.count}× {m.name}
						{/each}
					{/if}
				</p>
			</div>
		{/if}

		<div class="mt-2 flex flex-wrap gap-1 border-t border-border pt-2 font-sans">
			<Button
				variant="outline"
				size="xs"
				disabled={isReadOnly}
				onclick={() => handOffTo('PAINT')}
				{@attach help({
					title: 'Paint selection',
					text: 'Switch to the Paint tool with this selection kept; your next click on the canvas paints every touched oligo.',
					doc: 'editing-tools',
				})}
			>
				<Paintbrush /> Paint
			</Button>
			<Button
				variant="outline"
				size="xs"
				disabled={isReadOnly || freeSelectedEnds.length === 0}
				onclick={() => handOffTo('MODIFICATION')}
				{@attach help({
					title: 'Modify selected ends',
					text: "Switch to the Modification tool with this selection kept; your next click on the canvas applies the active modification to every selected free 5' or 3' end.",
					doc: 'editing-tools',
				})}
			>
				<Tag /> Modify ends
			</Button>
			<Button
				variant="outline"
				size="xs"
				disabled={isReadOnly || scaffoldCount === touched.length}
				onclick={() => setTouchedAsScaffold(true)}
				{@attach help({
					title: 'Set as scaffold',
					text: 'Mark every touched oligo as scaffold, in one undo step.',
					doc: 'selection',
				})}
			>
				Set scaffold
			</Button>
			<Button
				variant="outline"
				size="xs"
				disabled={isReadOnly || scaffoldCount === 0}
				onclick={() => setTouchedAsScaffold(false)}
				{@attach help({
					title: 'Set as staple',
					text: 'Mark every touched oligo as staple, in one undo step.',
					doc: 'selection',
				})}
			>
				Set staple
			</Button>
		</div>
	{/if}
</div>
<FreeformVhPanel />
<RepeatGroupPanel />
