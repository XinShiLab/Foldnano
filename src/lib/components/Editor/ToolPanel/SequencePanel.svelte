<script lang="ts">
	import { FILTER_TOGGLE_CLASS, SCAF_TOGGLE_CLASS, STAP_TOGGLE_CLASS } from './filterToggleClasses';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as RadioGroup from '$lib/components/ui/radio-group/index.js';
	import Button from '../../ui/button/button.svelte';
	import { Check, X } from '@lucide/svelte';
	import { draw } from 'svelte/transition';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import { TextAlignJustify } from '@lucide/svelte/icons';
	import OligoIcon from '$lib/components/icons/OligoIcon.svelte';
	import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
	import { help } from '$lib/components/help/help';
	import type { Part } from '$lib/model/Part';
	import { clearPartSequenceCmd } from '../../../commands/strands';

	type Props = {
		part: Part;
	};
	let { part }: Props = $props();

	const ctx = getEditorViewContext();

	let selectedSeqType = $state<'random' | 'preset' | 'custom' | 'remove'>('random');

	const setSelectedSeqType = (type: 'random' | 'preset' | 'custom' | 'remove') => {
		ctx.strandViewContext.sequenceContext.fillResults = [];
		selectedSeqType = type;
		if (type === 'preset' || type === 'custom') {
			ctx.strandViewContext.sequenceContext.mode = 'SEQ';
		} else if (type === 'random') {
			ctx.strandViewContext.sequenceContext.mode = 'RANDOM';
		} else if (type === 'remove') {
			ctx.strandViewContext.sequenceContext.mode = 'REMOVE';
		}
	};

	const isAllScaffoldSequenceLocked = $derived.by(() => {
		if (!part || part.oligos.size === 0) return false;
		if (!part.hasScaffold) return false;
		console.log('Checking scaffold sequence lock status...');
		return part.realOligos.every((oligo) => {
			if (oligo.isScaffold) {
				return oligo.isSequenceLocked === false ? false : true;
			}
			return true; // Non-scaffold oligos are ignored
		});
	});

	const presetSequences = [
		{ value: '4844', label: 'scaffold 4844bp', url: '/scaffolds/scaf4844.txt' },
		{ value: '7249', label: 'scaffold 7249bp', url: '/scaffolds/scaf7249.txt' },
		{ value: '7560', label: 'scaffold 7560bp', url: '/scaffolds/scaf7560.txt' },
		{ value: '8064', label: 'scaffold 8064bp', url: '/scaffolds/scaf8064.txt' },
		{ value: '8634', label: 'scaffold 8634bp', url: '/scaffolds/scaf8634.txt' },
	] as const;

	let selectedPreset = $state<'4844' | '7249' | '7560' | '8064' | '8634' | ''>('');

	const setSelectedPReset = async (preset: '4844' | '7249' | '7560' | '8064' | '8634' | '') => {
		ctx.strandViewContext.sequenceContext.fillResults = [];
		selectedPreset = preset;
		const url = presetSequences.find((f) => f.value === preset)?.url;
		if (url) {
			let testSeq = await fetch(url);
			const text = await testSeq.text();
			ctx.strandViewContext.sequenceContext.sequence = text;
			customSequence = text;
		}
	};

	const triggerContent = $derived(
		presetSequences.find((f) => f.value === selectedPreset)?.label ?? 'Select a preset'
	);

	let customSequence = $state<string>('');

	const setCustomSequence = (seq: string) => {
		customSequence = seq.replace(/[^ATCG]/gi, '').toUpperCase();
		ctx.strandViewContext.sequenceContext.sequence = customSequence;
	};

	let clearAllSeqWaitForConfirmation = $state<boolean>(false);
	let clearSuccessful = $state<boolean>(false);

	const clearAllBtnFirstClick = () => {
		clearAllSeqWaitForConfirmation = true;
		setTimeout(() => {
			clearAllSeqWaitForConfirmation = false;
		}, 3000);
	};
	const clearAllBtnSecondClick = () => {
		// Clear all sequences logic here
		clearPartSequenceCmd(
			{
				part: part,
			},
			ctx.historyStack
		);
		clearSuccessful = true;
		setTimeout(() => {
			clearSuccessful = false;
		}, 2000);
		clearAllSeqWaitForConfirmation = false;
	};

	// let testSeq = await fetch('./scaf7249.txt')
	// console.log('testSeq:', await testSeq.text());

	const strandCtx = $derived(ctx.strandViewContext);
</script>

<!-- Scaffold/Staple Filter -->
<div class="flex flex-row gap-2">
	<ToggleGroup.Root type="multiple" variant="outline" bind:value={strandCtx.selectionToggles}>
		<ToggleGroup.Item
			value="SCAF"
			class={SCAF_TOGGLE_CLASS}
			{@attach help({
				key: 'c',
				title: 'Scaffold',
				text: 'Apply sequence actions to scaffold strands.',
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
				text: 'Apply sequence actions to staple strands.',
			})}
		>
			STAP
		</ToggleGroup.Item>
	</ToggleGroup.Root>

	<!-- Selection Type Toggles -->
	<ToggleGroup.Root type="multiple" variant="outline" bind:value={strandCtx.selectionToggles}>
		<ToggleGroup.Item
			value="SEGMENT"
			class={FILTER_TOGGLE_CLASS}
			{@attach help({
				key: 'd',
				title: 'Segments',
				text: 'Apply the sequence to the clicked segment only.',
			})}
		>
			<TextAlignJustify />
		</ToggleGroup.Item>
		<ToggleGroup.Item
			value="OLIGO"
			class={FILTER_TOGGLE_CLASS}
			{@attach help({
				key: 'o',
				title: 'Oligos',
				text: 'Apply the sequence to the whole clicked oligo.',
			})}
		>
			<OligoIcon />
		</ToggleGroup.Item>
		<!-- <ToggleGroup.Item value="VH">
    <CircleSmall />
  </ToggleGroup.Item> -->
	</ToggleGroup.Root>
</div>
<!-- scaffold sequence lock -->
<div class="my-auto flex-shrink overflow-clip text-sm text-nowrap text-muted-foreground">
	{#if !part?.hasScaffold}
		<span title="No scaffold is set. Right-click an oligo and choose Set as Scaffold."
			>No scaffold set</span
		>
	{:else if isAllScaffoldSequenceLocked}
		<span class="text-green-600"
			><Check size={16} strokeWidth={3} class="inline" /> Scaffold Sequence</span
		>
	{:else}
		<span class="text-red-600"><X size={16} strokeWidth={3} class="inline" />Scaffold Sequence</span
		>
	{/if}
</div>

<RadioGroup.Root
	bind:value={
		() => (ctx.strandViewContext.sequenceContext.fillType === 'ONLY_EMPTY' ? 'empty' : 'all'),
		(v) => {
			ctx.strandViewContext.sequenceContext.fillType = v === 'empty' ? 'ONLY_EMPTY' : 'WHOLE';
		}
	}
	class="my-2 flex flex-col rounded-md border p-2"
>
	<div class="flex items-center space-x-2">
		<RadioGroup.Item value="all" id="r1" />
		<Label for="r1" class="text-xs">Update the entire sequence</Label>
	</div>
	<div class="flex items-center space-x-2">
		<RadioGroup.Item value="empty" id="r2" />
		<Label for="r2" class="text-xs">Fill only the empty parts</Label>
	</div>
	<!-- <div class="flex items-center space-x-2">
    <RadioGroup.Item value="compact" id="r3" />
    <Label for="r3">Compact</Label>
  </div> -->
</RadioGroup.Root>

<ToggleGroup.Root
	size="sm"
	variant="outline"
	type="single"
	class="w-full "
	bind:value={
		() => selectedSeqType, (v) => setSelectedSeqType(v as 'random' | 'preset' | 'custom' | 'remove')
	}
>
	<ToggleGroup.Item value="random" aria-label="Toggle bold" class="text-xs">
		Random
	</ToggleGroup.Item>
	<ToggleGroup.Item value="preset" aria-label="Toggle italic" class="text-xs">
		Preset
	</ToggleGroup.Item>
	<ToggleGroup.Item value="custom" aria-label="Toggle strikethrough" class="text-xs">
		Custom
	</ToggleGroup.Item>
	<ToggleGroup.Item value="remove" aria-label="Toggle strikethrough" class="text-xs">
		Remove
	</ToggleGroup.Item>
</ToggleGroup.Root>

<div class="mt-2">
	{#if selectedSeqType === 'random'}
		<div class="flex max-w-sm flex-col gap-1">
			<Label for="gc-content" class="text-xs">GC Content</Label>
			<Input
				type="number"
				id="gc-content"
				placeholder="0.5"
				bind:value={
					() => ctx.strandViewContext.sequenceContext.gcContent,
					(v) => (ctx.strandViewContext.sequenceContext.gcContent = Math.min(1, Math.max(0, v)))
				}
			/>
		</div>
		<div class="mt-4 text-xs text-muted-foreground">
			<p>
				Click to fill. <br />
				The complementary strand will be updated
			</p>
		</div>
	{:else if selectedSeqType === 'preset'}
		<Select.Root
			type="single"
			name="preset-sequence"
			bind:value={
				() => selectedPreset,
				(v) => setSelectedPReset(v as '4844' | '7249' | '7560' | '8064' | '8634' | '')
			}
		>
			<Label for="gc-content" class=" text-xs">Preset Scaffold Sequence</Label>
			<Select.Trigger class="mt-1 w-full">
				{triggerContent}
			</Select.Trigger>
			<Select.Content>
				<Select.Group>
					<Select.Label>Presets</Select.Label>
					{#each presetSequences as preset (preset.value)}
						<Select.Item value={preset.value} label={preset.label}>
							{preset.label}
						</Select.Item>
					{/each}
				</Select.Group>
			</Select.Content>
		</Select.Root>
		<div class="mt-4 text-xs text-muted-foreground">
			<p>
				Click to fill. <br />
				The complementary strand will be updated
			</p>
		</div>
	{:else if selectedSeqType === 'custom'}
		<div class="flex w-full max-w-sm flex-col gap-1.5">
			<Label for="custom-sequence" class="text-xs">Custom Sequence</Label>
			<Textarea
				class="max-h-60 overflow-y-auto text-xs!"
				placeholder="Enter your custom sequence here"
				bind:value={() => customSequence, (v) => setCustomSequence(v)}
			/>
		</div>
		<div class="mt-4 text-xs text-muted-foreground">
			<p>
				Click to fill. <br />
				The complementary strand will be updated
			</p>
		</div>
	{:else if selectedSeqType === 'remove'}
		<p class="text-xs text-muted-foreground">Click oligos to clear their sequences.</p>
		<div class="mt-4 flex flex-row justify-end">
			{#if clearAllSeqWaitForConfirmation}
				<Button size="sm" variant="destructive" onclick={() => clearAllBtnSecondClick()}
					>Click Again to Confirm</Button
				>
			{:else if clearSuccessful && !clearAllSeqWaitForConfirmation}
				<Button size="sm" variant="secondary" disabled>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="24"
						height="24"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						class="lucide lucide-check-icon lucide-check"
						><path d="M4 12 l 5 5 l 11 -11" in:draw|global /></svg
					>
					<!-- d="M20 6 9 17l-5-5"  -->
					Sequences Cleared
				</Button>
			{:else if !clearSuccessful && !clearAllSeqWaitForConfirmation}
				<Button size="sm" variant="outline" onclick={() => clearAllBtnFirstClick()}>
					Clear All Sequences
				</Button>
			{/if}
		</div>
	{/if}
</div>
{#if ctx.strandViewContext.sequenceContext.fillResults.length > 0}
	<div class="mt-4 border-t border-border">
		{#each ctx.strandViewContext.sequenceContext.fillResults as result, index (index)}
			<div class="mt-2 text-xs">
				<p>
					left: {result.leftover.length} nt; missing: {result.missing} nt.
				</p>
			</div>
		{/each}
	</div>
{/if}
