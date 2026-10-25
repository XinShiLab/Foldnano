<script lang="ts">
	import { Circle, Group, Line, Rect, Text } from 'svelte-konva';
	import { getDimensionContext } from '../drawingContext';
	import { canvasTheme } from '$lib/canvasEditor/theme.svelte';
	import type { VisibleRegionHeaderRow } from '../strandRowLayout';
	import { getEditorViewContext } from '../../context/EditorViewContext.svelte';
	import { getPlaneColor, planeColorAsCss } from '$lib/model/Part/planeColors';
	import type { Part } from '$lib/model/Part';
	import { regionHeaderGeometry } from './regionHeaderGeometry';

	interface Props {
		row: VisibleRegionHeaderRow;
		maxBpIdx: number;
		part: Part;
	}

	const { row, maxBpIdx, part }: Props = $props();
	const d = getDimensionContext();
	const editorViewContext = getEditorViewContext();
	const { radius, strokeWidth } = d.dimensions;

	// Header spans this region's own maxBase (clamped to the global max passed in
	// for layout consistency), so a shorter region's header doesn't stretch across
	// the wider canvas.
	const region = $derived(part.regions.find((r) => r.id === row.regionId));
	const headerMaxBpIdx = $derived(Math.min(maxBpIdx, region ? region.maxBase : maxBpIdx));
	const x = 2 * radius;
	const geometry = $derived(regionHeaderGeometry(d, row.displayRow, headerMaxBpIdx));
	const y = $derived(geometry.top);
	const width = $derived(geometry.width);
	const height = $derived(geometry.height);
	const label = $derived(`${row.regionName} (${row.vhCount})`);
	const isActive = $derived(editorViewContext.activeRegionId === row.regionId);
	const activeAccentColor = '#7f1d1d';
	const activeAccentWidth = 4;

	const planeColor = $derived.by(() => {
		if (!region) return null;
		const planeIndex = part.planes.findIndex((p) => p.id === region.planeId);
		if (planeIndex < 0) return null;
		return planeColorAsCss(getPlaneColor(planeIndex));
	});
	const planeFill = $derived(planeColor ? `${planeColor}22` : canvasTheme.colors.vhFill);
	const headerStroke = $derived(planeColor ?? canvasTheme.colors.vhStroke);

	const iconSize = $derived(geometry.iconSize);
	const planeX = $derived(geometry.iconLeft);
	const iconY = $derived(geometry.iconTop);
	const planeGlyphInset = 1;
	const planeGlyphSize = $derived(iconSize - planeGlyphInset * 2);
	const planeGlyphDotRadius = 1.5;
	const chevronX = x + 2;
	const chevronY = $derived(y + height / 2);
	const chevronHalfWidth = 2.5;
	const chevronHalfHeight = 4;
	const labelX = chevronX + chevronHalfHeight + 6;
	const chevronPoints = $derived(
		row.isCollapsed
			? [
					-chevronHalfWidth,
					-chevronHalfHeight,
					chevronHalfWidth,
					0,
					-chevronHalfWidth,
					chevronHalfHeight,
				]
			: [
					-chevronHalfHeight,
					-chevronHalfWidth,
					0,
					chevronHalfWidth,
					chevronHalfHeight,
					-chevronHalfWidth,
				]
	);
</script>

<Group
	id={`REGION_HEADER#${row.regionId}`}
	kind="REGION_HEADER"
	category="CONTROL"
	class="pickable"
>
	<Rect
		id={`REGION_HEADER#${row.regionId}`}
		x={x - radius}
		{y}
		{width}
		{height}
		fill={planeFill}
		stroke={headerStroke}
		{strokeWidth}
		cornerRadius={2}
	/>
	{#if isActive}
		<Rect
			id={`REGION_HEADER#${row.regionId}`}
			x={x - radius + 0.5}
			y={y + 0.5}
			width={activeAccentWidth}
			height={height - 1}
			fill={activeAccentColor}
			cornerRadius={[1.5, 0, 0, 1.5]}
		/>
	{/if}
	<Line
		id={`REGION_HEADER#${row.regionId}`}
		x={chevronX}
		y={chevronY}
		points={chevronPoints}
		stroke={canvasTheme.colors.vhText}
		strokeWidth={2}
		lineCap="round"
		lineJoin="round"
	/>
	<Text
		id={`REGION_HEADER#${row.regionId}`}
		x={labelX}
		{y}
		{height}
		text={label}
		fontSize={12}
		fontStyle="bold"
		verticalAlign="middle"
		fill={canvasTheme.colors.vhText}
	/>

	<!--
	  Plane icon: clicking it activates this region, shows the plane gizmo in 3D,
	  and frames the camera on the plane. Lights up (colored fill/border) when the
	  region is active so the user sees at-a-glance which region is currently the
	  target of single-region operations (cadnano export, autoStaple, plugins).
	-->
	<Group
		id={`REGION_HEADER#plane#${row.regionId}`}
		kind="REGION_HEADER"
		category="CONTROL"
		class="pickable"
	>
		<Rect
			id={`REGION_HEADER#plane#${row.regionId}`}
			x={planeX}
			y={iconY}
			width={iconSize}
			height={iconSize}
			fill="rgba(0,0,0,0)"
			strokeEnabled={false}
			cornerRadius={2}
		/>
		<Rect
			id={`REGION_HEADER#plane#${row.regionId}`}
			x={planeX + planeGlyphInset}
			y={iconY + planeGlyphInset}
			width={planeGlyphSize}
			height={planeGlyphSize}
			stroke={headerStroke}
			strokeWidth={1.5}
			cornerRadius={2}
		/>
		<Circle
			id={`REGION_HEADER#plane#${row.regionId}`}
			x={planeX + iconSize / 2}
			y={iconY + iconSize / 2}
			radius={planeGlyphDotRadius}
			fill={headerStroke}
		/>
	</Group>
</Group>
