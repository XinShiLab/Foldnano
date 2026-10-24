<script lang="ts">
	import { Group, Rect } from 'svelte-konva';
	import type { DesignIssue } from '$lib/model/checks/designIssue';
	import { getDimensionContext } from './drawingContext';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';

	const editorViewContext = getEditorViewContext();
	const d = getDimensionContext();
	const { dimensions, getBpCoordsByRowAndBpIdx } = d;
	const { sideLength } = dimensions;

	const COLOR = { error: '#dc2626', warning: '#d97706' } as const;
	// Fills the gap a marker frame leaves around the two strand boxes.
	const PAD = 3;

	interface Marker {
		key: string;
		x: number;
		y: number;
		width: number;
		height: number;
		color: string;
	}

	/** One frame per issue that names a helix: around its base, or around the helix start. */
	function toMarker(issue: DesignIssue, index: number): Marker | null {
		if (issue.severity === 'info') return null;
		const vhId = issue.anchor?.vhId;
		if (!vhId) return null;
		const row = d.getEffectiveDisplayRowForVh(vhId);
		if (row === null || row.isCollapsed) return null;
		const bp = issue.anchor?.bp;
		const [top, bottom] = getBpCoordsByRowAndBpIdx(row.displayRow, bp ?? 0);
		const x = bp === undefined ? top[0] - 2 * sideLength : top[0];
		return {
			key: `${issue.rule}#${index}`,
			x: x - PAD,
			y: top[1] - PAD,
			width: (bp === undefined ? 2 * sideLength : sideLength) + 2 * PAD,
			height: bottom[1] - top[1] + sideLength + 2 * PAD,
			color: COLOR[issue.severity],
		};
	}

	const markers = $derived(
		editorViewContext.designIssues.map(toMarker).filter((m): m is Marker => m !== null)
	);
</script>

<!-- @component
  DesignIssueMarkers
  Frames every helix base named by a design-check issue (editorViewContext.designIssues) in red
  (error) or amber (warning). Issues about a whole helix are framed just left of its first base;
  region-wide issues have no spot and only show in the issue list. Non-interactive, so it sits in
  the world layer above StrandRoutes.
-->

{#if markers.length > 0}
	<Group listening={false}>
		{#each markers as marker (marker.key)}
			<Rect
				x={marker.x}
				y={marker.y}
				width={marker.width}
				height={marker.height}
				stroke={marker.color}
				strokeWidth={2}
				cornerRadius={3}
				dash={[4, 2]}
			/>
		{/each}
	</Group>
{/if}
