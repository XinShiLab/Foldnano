<script lang="ts">
	import { Group, Line, Text } from 'svelte-konva';
	import type { Part } from '$lib/model/Part';
	import { buildBlocksAndConstraints } from '$lib/model/rbs/buildBlocks';
	import { getBlockColor } from '$lib/model/rbs/blockColors';
	import { getDimensionContext } from './drawingContext';

	interface Props {
		part: Part;
	}

	let { part }: Props = $props();

	const d = getDimensionContext();
	const { sideLength } = d.dimensions;
	const { getBpCoordsByRowAndBpIdx, withOffset } = d;
	const offset: [number, number] = [sideLength / 2, sideLength / 2];

	const blockData = $derived.by(() => {
		void part.oligos.size;
		void part.virtualHelices.length;
		return buildBlocksAndConstraints(part);
	});

	const segmentBands = $derived.by(() => {
		const bands: Array<{
			id: string;
			blockId: string;
			color: string;
			points: number[];
			strokeWidth: number;
			label?: { text: string; x: number; y: number };
		}> = [];
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const labelByBlock = new Set<string>();

		for (const oligo of part.oligos) {
			for (const seg of oligo.segments) {
				const displayRow = d.getDisplayRowForVh(seg.inVirtualHelix.id);
				if (displayRow === null) continue;
				const blockId = blockData.segmentToBlockId.get(seg.id);
				if (!blockId) continue;

				const strandIdx = seg.inStrandIndex;
				const start = seg.fivePrime.index;
				const end = seg.threePrime.index;
				const startBp = withOffset(getBpCoordsByRowAndBpIdx(displayRow, start), offset);
				const endBp = withOffset(getBpCoordsByRowAndBpIdx(displayRow, end), offset);
				const points = [startBp[strandIdx], endBp[strandIdx]].flat();
				const band = {
					id: `${blockId}-${seg.id}`,
					blockId,
					color: getBlockColor(blockId),
					points,
					strokeWidth: sideLength + 4,
				};
				if (!labelByBlock.has(blockId)) {
					labelByBlock.add(blockId);
					bands.push({
						...band,
						label: {
							text: blockId,
							x: Math.min(points[0], points[2]) - sideLength * 1.4,
							y: Math.min(points[1], points[3]) - sideLength,
						},
					});
				} else {
					bands.push(band);
				}
			}
		}
		return bands;
	});
</script>

<Group listening={false} perfectDrawEnabled={false}>
	{#each segmentBands as band (band.id)}
		<Line
			points={band.points}
			stroke={band.color}
			opacity={0.22}
			strokeWidth={band.strokeWidth}
			lineCap="round"
			lineJoin="round"
			listening={false}
			perfectDrawEnabled={false}
		/>
		{#if band.label}
			<Text
				text={band.label.text}
				x={band.label.x}
				y={band.label.y}
				fill={band.color}
				fontSize={9}
				fontStyle="bold"
				opacity={0.9}
				listening={false}
				perfectDrawEnabled={false}
			/>
		{/if}
	{/each}
</Group>
