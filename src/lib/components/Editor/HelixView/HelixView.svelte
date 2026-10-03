<script lang="ts">
	import type { Stage as StageType } from 'svelte-konva';
	import type OligoSegment from '$lib/model/Oligo/OligoSegment.svelte';
	import type { Part } from '../../../model/Part';
	import PlaneViewer from './PlaneViewer.svelte';

	interface Props {
		part: Part;
		focusedSegments?: Set<OligoSegment> | null;
		stageRef?: StageType;
	}

	let { part, focusedSegments = null, stageRef = $bindable() }: Props = $props();
</script>

<PlaneViewer {part} {focusedSegments} bind:stageRef />
