<script lang="ts">
	import { FILTER_TOGGLE_CLASS, SCAF_TOGGLE_CLASS, STAP_TOGGLE_CLASS } from './filterToggleClasses';
	import { TextAlignJustify } from '@lucide/svelte/icons';
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

{#snippet oligoInfo(oligo: Oligo, heading: string)}
	<div class="mt-2 border-t border-border pt-2">
		<p>{heading}</p>
		<div class="flex items-center gap-1">
			<span>Name:</span>
			<OligoNameField {oligo} />
		</div>
		{#if oligo.isCircular}
			<p>(circular)</p>
		{:else}
			<p>
				{oligo.fivePrime?.inVirtualHelix.index}[{oligo.fivePrime?.index}] -> {oligo.threePrime
					?.inVirtualHelix.index}[{oligo.threePrime?.index}]
			</p>
		{/if}
		<p>Length: {oligo.length}</p>
		<p>Color: <span>{@render color(oligo.color)}</span></p>
		<p>isScaffold: {oligo.isScaffold}</p>
		<p>isLocked: {oligo.isSequenceLocked}</p>
		<p>Modifications: {@render modifications(oligo)}</p>
	</div>
{/snippet}

<div
	class="mt-2 flex-grow rounded-md border border-border p-2 font-mono text-xs text-muted-foreground"
>
	{#if strandCtx.hoverOligo}
		{@render oligoInfo(strandCtx.hoverOligo, 'Selected Oligo:')}
	{/if}
	{#if strandCtx.hoverSegment}
		<p>Selected Segment:</p>
		<p>
			{strandCtx.hoverSegment.fivePrime?.inVirtualHelix.index}[{strandCtx.hoverSegment.fivePrime
				?.index}] -> {strandCtx.hoverSegment.threePrime?.inVirtualHelix.index}[{strandCtx
				.hoverSegment.threePrime?.index}]
		</p>
		<p>Length: {strandCtx.hoverSegment.length}</p>

		{#if strandCtx.hoverSegment.oligo}
			{@render oligoInfo(strandCtx.hoverSegment.oligo, 'Belongs to Oligo:')}
		{/if}
	{/if}
	<!-- <p>Segment: 2[23] -> 2[33]</p>
  <p>End: 2[23]</p>
  <p>Modification: none</p>
  <p>Sequence: AATTCCAATTGGGAATT... </p>
  <p>Color: {@render color("#FF2233")}</p> -->
</div>
<FreeformVhPanel />
<RepeatGroupPanel />
