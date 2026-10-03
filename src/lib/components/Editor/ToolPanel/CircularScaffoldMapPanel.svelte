<script lang="ts">
	import { Download, RefreshCw, ZoomIn, ZoomOut, RotateCcw, Copy } from '@lucide/svelte/icons';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { SvelteSet } from 'svelte/reactivity';
	import { toast } from 'svelte-sonner';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import type { Part } from '$lib/model/Part';
	import type Oligo from '$lib/model/Oligo';
	import type { SegmentEnd } from '$lib/model/Oligo';
	import ScaffoldMapViz from './scaffoldMap/ScaffoldMapViz.svelte';
	import { classifyScaffold } from './scaffoldMap/scaffoldMapUtils';

	type Props = { part: Part };
	let { part }: Props = $props();

	const ctx = getEditorViewContext();
	const PANEL_INNER_WIDTH = 420;
	const ZOOM_MIN = 0.5;
	const ZOOM_MAX = 3;
	const ZOOM_STEP = 1.25;

	let svgEl: SVGSVGElement | undefined = $state();
	let hasScaffold = $derived(Array.from(part.oligos).some((o) => o.isScaffold));

	// Zoom just scales the width fed into ScaffoldMapViz — its own layout math is
	// already width-driven, so no separate CSS transform is needed. The viewport
	// div below stays fixed-size and scrolls to pan around the enlarged SVG.
	let zoomLevel = $state(1);
	let scaledWidth = $derived(PANEL_INNER_WIDTH * zoomLevel);

	function zoomIn() {
		zoomLevel = Math.min(ZOOM_MAX, zoomLevel * ZOOM_STEP);
	}

	function zoomOut() {
		zoomLevel = Math.max(ZOOM_MIN, zoomLevel / ZOOM_STEP);
	}

	function resetZoom() {
		zoomLevel = 1;
	}

	// Only zoom on ctrl/cmd+wheel (trackpad pinch reports as wheel with ctrlKey
	// true) so plain scrolling still pans/scrolls the viewport as usual.
	function handleWheel(e: WheelEvent) {
		if (!e.ctrlKey) return;
		e.preventDefault();
		if (e.deltaY < 0) zoomIn();
		else zoomOut();
	}

	// Histogram y-axis caps: null auto-scales each histogram to its own max count
	// (default). Setting a cap lets the user "zoom in" on the low-count bars that
	// a few dominant values would otherwise dwarf. Segment-length and
	// crossover-span counts have unrelated scales, so each gets its own cap.
	let segmentHistogramMaxCount = $state<number | null>(null);
	let overallSegmentMaxCount = $state(1);

	function setSegmentHistogramMaxCount(value: number) {
		if (Number.isNaN(value)) return;
		segmentHistogramMaxCount = Math.min(overallSegmentMaxCount, Math.max(1, Math.round(value)));
	}

	function resetSegmentHistogramMaxCount() {
		segmentHistogramMaxCount = null;
	}

	let spanHistogramMaxCount = $state<number | null>(null);
	let overallSpanMaxCount = $state(1);

	function setSpanHistogramMaxCount(value: number) {
		if (Number.isNaN(value)) return;
		spanHistogramMaxCount = Math.min(overallSpanMaxCount, Math.max(1, Math.round(value)));
	}

	function resetSpanHistogramMaxCount() {
		spanHistogramMaxCount = null;
	}

	// Histogram bin width (nt). Widening it groups nearby values together, which is
	// also how the user "zooms out" when the observed range is too large to show
	// one bar per exact nt value without bars vanishing to sub-pixel width.
	// Segment lengths default to exact integer binning; crossover spans default to
	// a coarser 100nt bin since their range is typically much wider (up to half the
	// scaffold length for circular designs).
	let segmentBinSize = $state(1);
	let spanBinSize = $state(100);

	function setSegmentBinSize(value: number) {
		if (!Number.isFinite(value)) return;
		segmentBinSize = Math.max(1, Math.round(value));
	}

	function setSpanBinSize(value: number) {
		if (!Number.isFinite(value)) return;
		spanBinSize = Math.max(1, Math.round(value));
	}

	// Raw per-scaffold histogram data, reported up from ScaffoldMapViz, kept
	// around solely so "Copy histogram data" can build a paste-into-spreadsheet
	// TSV without re-deriving segment lengths/crossover spans itself.
	let histogramData = $state<
		{
			scaffoldName: string;
			segmentHistogram: { length: number; count: number }[];
			spanHistogram: { length: number; count: number }[];
		}[]
	>([]);

	async function copyHistogramData() {
		const lines = ['Scaffold\tMetric\tLength (nt)\tCount'];
		for (const { scaffoldName, segmentHistogram, spanHistogram } of histogramData) {
			for (const { length, count } of segmentHistogram) {
				lines.push(`${scaffoldName}\tSegment length\t${length}\t${count}`);
			}
			for (const { length, count } of spanHistogram) {
				lines.push(`${scaffoldName}\tCrossover span\t${length}\t${count}`);
			}
		}
		await navigator.clipboard.writeText(lines.join('\n'));
		toast.success('Histogram data copied to clipboard');
	}

	// Per-scaffold circular overrides: linear scaffolds the user wants to treat as circular.
	let circularOverrides = new SvelteSet<string>();

	function toggleOverride(id: string) {
		if (circularOverrides.has(id)) circularOverrides.delete(id);
		else circularOverrides.add(id);
	}

	// Scaffolds that can be overridden to a full circle: both linear (open arc)
	// and broken-circular (full circle with gap + marker).
	let overridableScaffolds = $derived(
		part.realOligos.filter((o) => {
			if (!o.isScaffold) return false;
			const k = classifyScaffold(o);
			return k === 'linear' || k === 'broken-circular';
		})
	);

	function onClickOligo(oligo: Oligo) {
		const ends: SegmentEnd[] = [];
		for (const seg of oligo.segments) {
			ends.push(seg.fivePrime, seg.threePrime);
		}
		ctx.strandViewContext.selected.set(ends);
	}

	function onHoverOligo(oligo: Oligo | null) {
		ctx.strandViewContext.hoverOligo = oligo;
	}

	function downloadAsSvg() {
		if (!svgEl) return;
		const str = new XMLSerializer().serializeToString(svgEl);
		const blob = new Blob([str], { type: 'image/svg+xml;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.download = `scaffold-map-${part.name ?? 'design'}.svg`;
		link.href = url;
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);
	}
</script>

{#if !hasScaffold}
	<p class="text-xs text-muted-foreground">No scaffold oligo in this design.</p>
{:else}
	<div class="mb-1.5 flex items-center gap-1">
		<Button
			size="icon-xs"
			variant="outline"
			onclick={zoomOut}
			disabled={zoomLevel <= ZOOM_MIN}
			title="Zoom out"
		>
			<ZoomOut size={12} />
		</Button>
		<span class="w-9 text-center text-xs text-muted-foreground">{Math.round(zoomLevel * 100)}%</span
		>
		<Button
			size="icon-xs"
			variant="outline"
			onclick={zoomIn}
			disabled={zoomLevel >= ZOOM_MAX}
			title="Zoom in"
		>
			<ZoomIn size={12} />
		</Button>
		<Button
			size="icon-xs"
			variant="outline"
			onclick={resetZoom}
			disabled={zoomLevel === 1}
			title="Reset zoom"
		>
			<RotateCcw size={12} />
		</Button>
	</div>
	<div
		class="overflow-auto"
		style="max-height: 70vh; width: {PANEL_INNER_WIDTH}px;"
		onwheel={handleWheel}
	>
		<ScaffoldMapViz
			{part}
			width={scaledWidth}
			{onClickOligo}
			{onHoverOligo}
			{circularOverrides}
			{segmentHistogramMaxCount}
			{spanHistogramMaxCount}
			{segmentBinSize}
			{spanBinSize}
			onSegmentHistogramMaxCountChange={(max) => (overallSegmentMaxCount = max)}
			onSpanHistogramMaxCountChange={(max) => (overallSpanMaxCount = max)}
			onHistogramDataChange={(rows) => (histogramData = rows)}
			bind:svgEl
		/>
	</div>
	{#if overallSegmentMaxCount > 1}
		{@render histControlRow(
			'Segment',
			segmentBinSize,
			setSegmentBinSize,
			overallSegmentMaxCount,
			segmentHistogramMaxCount ?? overallSegmentMaxCount,
			setSegmentHistogramMaxCount,
			resetSegmentHistogramMaxCount,
			segmentHistogramMaxCount === null
		)}
	{/if}
	{#if overallSpanMaxCount > 1}
		{@render histControlRow(
			'Span',
			spanBinSize,
			setSpanBinSize,
			overallSpanMaxCount,
			spanHistogramMaxCount ?? overallSpanMaxCount,
			setSpanHistogramMaxCount,
			resetSpanHistogramMaxCount,
			spanHistogramMaxCount === null
		)}
	{/if}
	<div class="mt-1.5 flex flex-wrap gap-1.5">
		<Button size="xs" variant="outline" onclick={downloadAsSvg}>
			<Download size={12} />
			Download SVG
		</Button>
		{#if overallSegmentMaxCount > 1 || overallSpanMaxCount > 1}
			<Button size="xs" variant="outline" onclick={copyHistogramData}>
				<Copy size={12} />
				Copy histogram data
			</Button>
		{/if}
		{#each overridableScaffolds as scaffold (scaffold.id)}
			{@const isOverridden = circularOverrides.has(scaffold.id)}
			<Button
				size="xs"
				variant={isOverridden ? 'default' : 'outline'}
				onclick={() => toggleOverride(scaffold.id)}
				title={isOverridden ? 'Revert to original rendering' : 'Render as a full circle'}
			>
				<RefreshCw size={12} />
				{overridableScaffolds.length > 1
					? isOverridden
						? `Revert "${scaffold.name || 'scaffold'}"`
						: `Circular "${scaffold.name || 'scaffold'}"`
					: isOverridden
						? 'Revert'
						: 'Make circular'}
			</Button>
		{/each}
	</div>
{/if}

<!-- Combines bin-size + max-count cap into one row per histogram, since both are
     just fine-tuning controls for reading the chart, not the data itself. -->
{#snippet histControlRow(
	label: string,
	binValue: number,
	onBinInput: (v: number) => void,
	countMax: number,
	countValue: number,
	onCountInput: (v: number) => void,
	onCountReset: () => void,
	countResetDisabled: boolean
)}
	<div class="mt-1 flex items-center gap-1">
		<span class="w-11 shrink-0 text-[10px] whitespace-nowrap text-muted-foreground">{label}</span>
		<Input
			type="number"
			min={1}
			step={1}
			value={binValue}
			oninput={(e) => onBinInput(Number(e.currentTarget.value))}
			class="h-5 w-16 px-1 text-[10px]"
			title="Bin size (nt)"
		/>
		<input
			type="range"
			min="1"
			max={countMax}
			value={countValue}
			oninput={(e) => onCountInput(Number(e.currentTarget.value))}
			class="h-1 flex-1 accent-foreground"
			title="Max count shown"
		/>
		<Input
			type="number"
			min={1}
			max={countMax}
			value={countValue}
			oninput={(e) => onCountInput(Number(e.currentTarget.value))}
			class="h-5 w-20 px-1 text-[10px]"
			title="Max count shown"
		/>
		<Button
			size="icon-xs"
			variant="outline"
			onclick={onCountReset}
			disabled={countResetDisabled}
			title="Reset max count to auto-scale"
		>
			<RotateCcw size={10} />
		</Button>
	</div>
{/snippet}
