<script lang="ts">
	import { Group, Line, Rect, Text } from 'svelte-konva';
	import type { Part } from '$lib/model/Part';
	import {
		sidePositions,
		type StickyBase,
		type StickySide,
	} from '$lib/model/stickyEnds/stickyEnds';
	import { getDimensionContext } from './drawingContext';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';

	interface Props {
		part: Part;
		/** `under`: the colour bands, below the strands. `over`: partner badges and the hover line. */
		layer: 'under' | 'over';
	}

	let { part, layer }: Props = $props();

	const ctx = getEditorViewContext();
	const d = getDimensionContext();
	const { dimensions, getBpCoordsByRowAndBpIdx } = d;
	const { sideLength } = dimensions;

	const shown = $derived(ctx.strandViewContext.highlightContext.sticky_end_matches);
	const matcher = ctx.stickyEnds;

	/** Top-left of a base's grid box, or null when its helix isn't on screen (or collapsed). */
	function boxOf(base: StickyBase): [number, number] | null {
		const row = d.getEffectiveDisplayRowForVh(base.vhId);
		if (row === null || row.isCollapsed) return null;
		return getBpCoordsByRowAndBpIdx(row.displayRow, base.bpIndex)[base.strandIdx] as [
			number,
			number,
		];
	}

	// One band per bp: the bases of an insertion share a grid box.
	const bands = $derived.by(() => {
		if (!shown || layer !== 'under') return [];
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local to this derived
		const byBox = new Map<string, { box: [number, number]; colors: string[] }>();
		for (const mark of matcher.marksFor(part.id)) {
			const key = `${mark.vhId}:${mark.strandIdx}:${mark.bpIndex}`;
			const entry = byBox.get(key);
			if (entry) {
				for (const color of mark.colors)
					if (!entry.colors.includes(color)) entry.colors.push(color);
				continue;
			}
			const box = boxOf(mark);
			if (box) byBox.set(key, { box, colors: [...mark.colors] });
		}
		return [...byBox.entries()];
	});

	const center = (side: StickySide): [number, number] | null => {
		const positions = sidePositions(side);
		const box = boxOf(positions[Math.floor(positions.length / 2)]);
		return box ? [box[0] + sideLength / 2, box[1] + sideLength / 2] : null;
	};

	// A badge at the 3' end of each side here whose partner is in another Part, outside the helix
	// like the end-modification labels: above strand 0, below strand 1.
	const badges = $derived.by(() => {
		if (!shown || layer !== 'over') return [];
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local to this derived
		const byEnd = new Map<
			string,
			{ box: [number, number]; strandIdx: 0 | 1; names: string[]; color: string }
		>();
		for (const match of matcher.shown) {
			for (const [here, there] of [
				[match.a, match.b],
				[match.b, match.a],
			]) {
				if (here.run.partId !== part.id || there.run.partId === part.id) continue;
				const positions = sidePositions(here);
				const end = positions[positions.length - 1];
				const box = boxOf(end);
				if (!box) continue;
				const name = ctx.currentDoc.parts.find((p) => p.id === there.run.partId)?.name ?? 'Part';
				const key = `${end.vhId}:${end.strandIdx}:${end.bpIndex}`;
				const entry = byEnd.get(key);
				if (entry) {
					if (!entry.names.includes(name)) entry.names.push(name);
				} else byEnd.set(key, { box, strandIdx: end.strandIdx, names: [name], color: match.color });
			}
		}
		return [...byEnd.entries()];
	});

	// The hovered match's two sides joined by a dashed line, when both are in this Part.
	const hoverLine = $derived.by(() => {
		if (!shown || layer !== 'over' || !matcher.hoveredKey) return null;
		const match = matcher.shown.find((m) => m.key === matcher.hoveredKey);
		if (!match || match.self) return null;
		if (match.a.run.partId !== part.id || match.b.run.partId !== part.id) return null;
		const a = center(match.a);
		const b = center(match.b);
		return a && b ? { points: [...a, ...b], color: match.color } : null;
	});
</script>

<!-- @component
  StickyEndMarkers
  Sticky-end matches of the active Part (docs/sticky-ends.md): a band in each match's colour under
  its bases, a badge naming the other Part where the partner is elsewhere, and a dashed line to
  the partner while a match is hovered in the Sticky Ends panel. View-only.
-->

{#if shown}
	<Group listening={false}>
		{#if layer === 'under'}
			{#each bands as [key, band] (key)}
				{#each band.colors as color, i (color)}
					<Rect
						x={band.box[0]}
						y={band.box[1] + (i * sideLength) / band.colors.length}
						width={sideLength}
						height={sideLength / band.colors.length}
						fill={color}
						opacity={0.55}
						perfectDrawEnabled={false}
					/>
				{/each}
			{/each}
		{:else}
			{#each badges as [key, badge] (key)}
				<Text
					x={badge.box[0]}
					y={badge.strandIdx === 0
						? badge.box[1] + sideLength / 2 - 14
						: badge.box[1] + sideLength / 2 + 6}
					text={`⇄ ${badge.names[0]}${badge.names.length > 1 ? ` +${badge.names.length - 1}` : ''}`}
					fontSize={7}
					fontStyle="bold"
					fill={badge.color}
				/>
			{/each}
			{#if hoverLine}
				<Line
					points={hoverLine.points}
					stroke={hoverLine.color}
					strokeWidth={sideLength / 6}
					dash={[sideLength / 2, sideLength / 3]}
					lineCap="round"
				/>
			{/if}
		{/if}
	</Group>
{/if}
