<script lang="ts">
	import { Group } from 'svelte-konva';

	import SelectedEndBox from './SelectedEndBox.svelte';
	import MoveEndBox from './MoveEndBox.svelte';
	import Marquee from './Marquee.svelte';
	import ConnectionInProgress from './ConnectionInProgress.svelte';
	import OligoSegment from '../OligoSegment.svelte';
	import VhDragPreview from './VhDragPreview.svelte';

	// import { setTemporalPartsContext, type TemporalPartInfo } from '../drawingContext';
	import Crossover from '../crossover/Crossover.svelte';
	import type { TemporalPartInfo } from '../../context/types';

	let { temporalParts }: { temporalParts: TemporalPartInfo[] } = $props();
	let tempGroupRef = $state<Group>();
</script>

<!-- @component 
  #### TemporalParts
  This is a group of shapes that are generated and destroyed by tools (Select, Draw, etc...)   
  The shapes here are temporary and only exist during certain interactions.  
  The information is stored in the temporalParts context, and passed to the ViewContext so the Tools can edit it.  
 -->
<Group bind:this={tempGroupRef}>
	{#each temporalParts as part, i (i)}
		{#if part.type === 'SelectedEndBox'}
			<SelectedEndBox {...part.props} />
		{:else if part.type === 'MoveEndBox'}
			<MoveEndBox {...part.props} />
		{:else if part.type === 'Marquee'}
			<Marquee {...part.props} />
		{:else if part.type === 'Connecting'}
			<ConnectionInProgress {...part.props} />
		{:else if part.type === 'OligoSegment'}
			<OligoSegment {...part.props} color="red" isSelected={true} />
		{:else if part.type === 'Crossover'}
			<Crossover {...part.props} isSelected={true} color="red" strokeWidth={2} />
		{:else if part.type === 'VhDragPreview'}
			<VhDragPreview {...part.props} />
		{/if}
	{/each}
</Group>
