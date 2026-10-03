<script lang="ts">
	import type Oligo from '$lib/model/Oligo';
	import type { Part } from '$lib/model/Part';
	import { getEditorViewContext } from '../../context/EditorViewContext.svelte';
	import {
		classifyScaffold,
		buildScaffoldPositionMap,
		scaffoldPosToAngle,
		getStapleVisualization,
		type ScaffoldKind,
	} from './scaffoldMapUtils';

	interface Props {
		part: Part;
		width: number;
		onHoverOligo: (oligo: Oligo | null) => void;
		onClickOligo: (oligo: Oligo) => void;
		circularOverrides?: Set<string>;
		svgEl?: SVGSVGElement;
		/** Caps the segment-length histogram's count axis. `null` auto-scales to each row's own max (default). */
		segmentHistogramMaxCount?: number | null;
		/** Caps the crossover-span histogram's count axis. `null` auto-scales to each row's own max (default). */
		spanHistogramMaxCount?: number | null;
		/** nt width of each segment-length histogram bin. `1` (default) bins by exact integer length. */
		segmentBinSize?: number;
		/** nt width of each crossover-span histogram bin. `100` (default) — spans typically range much wider than segment lengths. */
		spanBinSize?: number;
		/** Reports the real (uncapped) segment-length max count whenever the data changes, so the panel can size its cap control. */
		onSegmentHistogramMaxCountChange?: (max: number) => void;
		/** Reports the real (uncapped) crossover-span max count whenever the data changes, so the panel can size its cap control. */
		onSpanHistogramMaxCountChange?: (max: number) => void;
		/** Reports each scaffold's raw histogram data whenever it changes, so the panel can offer "copy to clipboard". */
		onHistogramDataChange?: (
			rows: {
				scaffoldName: string;
				segmentHistogram: { length: number; count: number }[];
				spanHistogram: { length: number; count: number }[];
			}[]
		) => void;
	}

	let {
		part,
		width,
		onHoverOligo,
		onClickOligo,
		circularOverrides = new Set(),
		svgEl = $bindable(),
		segmentHistogramMaxCount = null,
		spanHistogramMaxCount = null,
		segmentBinSize = 1,
		spanBinSize = 100,
		onSegmentHistogramMaxCountChange,
		onSpanHistogramMaxCountChange,
		onHistogramDataChange,
	}: Props = $props();

	const ctx = getEditorViewContext();

	let hoveredOligo = $state<Oligo | null>(null);

	// Cheaply tracks which staple oligos have selected ends — reruns only on
	// selection change, not on hover or design edits.
	let selectedOligos = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const set = new Set<Oligo>();
		for (const end of ctx.strandViewContext.selected.ends) {
			const oligo = end.segment.oligo;
			if (oligo && !oligo.isScaffold) set.add(oligo);
		}
		return set;
	});

	const PADDING = 16;
	const ARC_INSET = 6;
	const SCAFFOLD_STROKE = 2.5;
	const ARC_STROKE = 3;
	const CHORD_STROKE = 1.5;
	const CHORD_STROKE_HOVER = 2.5;
	const SQUARE_SIZE = 5; // 5' end square marker
	const TRI_HALF = 4; // 3' end triangle half-size
	const BAR_GAP = 6; // gap between scaffold circle (r) and bar inner radius
	const BAR_MAX_HEIGHT = 32; // px — longest segment in a row reaches this
	const BAR_MIN_HEIGHT = 2; // px floor so near-zero-length segments stay visible
	const BAR_HALO = 3; // px the selection halo outline extends
	const ANGLE_MIN = 0.01; // rad floor so degenerate-length arcs still render a visible sliver
	const HIST_HEIGHT = 50; // px, max bar height for the highest count
	const HIST_MIN_BAR_HEIGHT = 2; // px floor so count=1 bars stay visible
	const HIST_BAR_GAP = 2; // px gap between adjacent histogram bars
	const ROW_LABEL_SPACE = 20; // px reserved for the "scaffold · N nt" label line before any histogram content
	const HIST_TITLE_SPACE = 12; // px for a histogram's own sub-header text (e.g. "Segment length (nt)")
	const HIST_HEIGHT_SPACE = HIST_TITLE_SPACE + HIST_HEIGHT; // px from a histogram's title to its baseline
	const HIST_AXIS_SPACE = 14; // px reserved below baseline for the axis tick marks + labels
	const HIST_TICK_LENGTH = 3; // px length of each axis tick mark
	const HIST_CLIP_MARK = 3; // px half-width of the "clipped" triangle marker

	// All path computation lives here — only reruns when part.oligos changes,
	// not when hoveredOligo changes, so hover is cheap.
	let vizData = $derived.by(() => {
		const scaffoldOligos = part.realOligos.filter((o) => o.isScaffold);
		const stapleOligos = part.realOligos.filter((o) => !o.isScaffold);
		if (scaffoldOligos.length === 0)
			return { rows: [], svgHeight: 0, overallSegmentMaxCount: 1, overallSpanMaxCount: 1 };

		const allLengths = scaffoldOligos.map((s) => buildScaffoldPositionMap(s).totalLength);
		const maxLen = Math.max(...allLengths);
		const maxR = Math.max(0, (width - PADDING * 2) / 2 - BAR_GAP - BAR_MAX_HEIGHT);

		let yOffset = PADDING;
		const rows = scaffoldOligos.map((scaffold, _idx) => {
			const posMapData = buildScaffoldPositionMap(scaffold);
			const { totalLength } = posMapData;
			const kind = circularOverrides.has(scaffold.id) ? 'circular' : classifyScaffold(scaffold);
			const r = maxLen > 0 ? Math.max(20, (totalLength / maxLen) * maxR) : maxR;
			const rowExtent = r + BAR_GAP + BAR_MAX_HEIGHT;
			const cx = width / 2;
			const cy = yOffset + rowExtent + PADDING;
			yOffset = cy + rowExtent + PADDING;

			// Scaffold arc path
			const scaffoldD = scaffoldPath(cx, cy, r, kind);

			// 5' / 3' end markers
			const θ5p = scaffoldPosToAngle(0, totalLength, kind);
			const θ3p = scaffoldPosToAngle(totalLength - 1, totalLength, kind);
			const fivePrimeMarker = circlePoint(cx, cy, r, θ5p);
			const threePrimeMarker = {
				...circlePoint(cx, cy, r, θ3p),
				rotDeg: tangentAngleDeg(θ3p),
			};

			// Precompute arcs and chords for every staple in one pass.
			// getStapleVisualization now handles both real staple crossovers AND
			// scaffold-crossover spans (segments that bridge distant scaffold regions).
			const allViz = stapleOligos.map((staple) => ({
				staple,
				viz: getStapleVisualization(staple, posMapData),
			}));

			const stapleArcs = allViz.map(({ staple, viz }) => ({
				staple,
				paths: viz.arcs.map(({ startPos, endPos }) => {
					const θ1 = scaffoldPosToAngle(startPos, totalLength, kind);
					const θ2 = scaffoldPosToAngle(endPos, totalLength, kind);
					return arcPath(cx, cy, r - ARC_INSET, θ1, θ2);
				}),
			}));

			const chords = allViz.flatMap(({ staple, viz }) =>
				viz.chords.map(({ pos1, pos2 }) => {
					const θ1 = scaffoldPosToAngle(pos1, totalLength, kind);
					const θ2 = scaffoldPosToAngle(pos2, totalLength, kind);
					return { staple, d: chordPath(cx, cy, r - ARC_INSET, θ1, θ2) };
				})
			);

			// Radial bar per dsDNA segment: height encodes segment length (nt),
			// angular span mirrors the corresponding inner arc exactly.
			const rowMaxLen = Math.max(
				1,
				...allViz.flatMap(({ viz }) => viz.arcs.map((a) => a.endPos - a.startPos))
			);
			const stapleBars = allViz.map(({ staple, viz }) => ({
				staple,
				wedges: viz.arcs.map(({ startPos, endPos }) => {
					let θ1 = scaffoldPosToAngle(startPos, totalLength, kind);
					let θ2 = scaffoldPosToAngle(endPos, totalLength, kind);
					const span = (θ2 - θ1 + 2 * Math.PI) % (2 * Math.PI);
					if (span < ANGLE_MIN) {
						const mid = θ1 + span / 2;
						θ1 = mid - ANGLE_MIN / 2;
						θ2 = mid + ANGLE_MIN / 2;
					}
					const len = endPos - startPos;
					const h = BAR_MIN_HEIGHT + (len / rowMaxLen) * (BAR_MAX_HEIGHT - BAR_MIN_HEIGHT);
					const rInner = r + BAR_GAP;
					const rOuter = rInner + h;
					return { d: annularSectorPath(cx, cy, rInner, rOuter, θ1, θ2), len };
				}),
			}));

			const chartWidth = width - PADDING * 2;

			// Histogram of dsDNA segment lengths (nt), binned every `segmentBinSize` nt
			// (default 1 = exact integer length), tallied across every staple bound to
			// this scaffold. Empty bins within the observed range are kept (not skipped)
			// so bar spacing stays uniform and the axis ticks stay meaningful.
			const segmentValues = allViz.flatMap(({ viz }) => viz.arcs.map((a) => a.endPos - a.startPos));
			const segmentHistogram = buildHistogram(segmentValues, segmentBinSize);
			const segmentHistBlockHeight =
				segmentHistogram.length > 0 ? ROW_LABEL_SPACE + HIST_HEIGHT_SPACE + HIST_AXIS_SPACE : 0;
			const segmentTitleY = cy + rowExtent + ROW_LABEL_SPACE + HIST_TITLE_SPACE - 4;
			const segmentBaselineY = cy + rowExtent + ROW_LABEL_SPACE + HIST_HEIGHT_SPACE;
			const { bars: segmentHistBars, truncated: segmentTruncated } = layoutHistogramBars(
				segmentHistogram,
				chartWidth,
				segmentBaselineY,
				segmentHistogramMaxCount
			);
			const segmentHistTicks = pickAxisTicks(segmentHistBars, segmentBinSize);

			// Crossover span: sequence distance between a chord's two scaffold positions,
			// binned every `spanBinSize` nt. Circular/broken-circular scaffolds use the
			// shorter arc around the circle, since a crossover near the wrap point is
			// physically close, not far apart.
			const spanValues = allViz.flatMap(({ viz }) =>
				viz.chords.map(({ pos1, pos2 }) => {
					const diff = Math.abs(pos2 - pos1);
					return kind === 'linear' ? diff : Math.min(diff, totalLength - diff);
				})
			);
			const spanHistogram = buildHistogram(spanValues, spanBinSize);
			// No ROW_LABEL_SPACE here — that gap only needs to clear the scaffold name
			// label once, above the first (segment) histogram.
			const spanHistBlockHeight =
				spanHistogram.length > 0 ? HIST_HEIGHT_SPACE + HIST_AXIS_SPACE : 0;
			const spanTitleY = cy + rowExtent + segmentHistBlockHeight + HIST_TITLE_SPACE - 4;
			const spanBaselineY = cy + rowExtent + segmentHistBlockHeight + HIST_HEIGHT_SPACE;
			const { bars: spanHistBars, truncated: spanTruncated } = layoutHistogramBars(
				spanHistogram,
				chartWidth,
				spanBaselineY,
				spanHistogramMaxCount
			);
			const spanHistTicks = pickAxisTicks(spanHistBars, spanBinSize);

			yOffset += segmentHistBlockHeight + spanHistBlockHeight;

			return {
				scaffold,
				kind,
				totalLength,
				cx,
				cy,
				r,
				rowExtent,
				scaffoldD,
				fivePrimeMarker,
				threePrimeMarker,
				stapleArcs,
				chords,
				stapleBars,
				segmentHistogram,
				segmentHistBars,
				segmentHistBlockHeight,
				segmentTitleY,
				segmentBaselineY,
				segmentHistTicks,
				segmentTruncated,
				spanHistogram,
				spanHistBars,
				spanHistBlockHeight,
				spanTitleY,
				spanBaselineY,
				spanHistTicks,
				spanTruncated,
			};
		});

		const overallSegmentMaxCount = Math.max(
			1,
			...rows.flatMap((row) => row.segmentHistogram.map((b) => b.count))
		);
		const overallSpanMaxCount = Math.max(
			1,
			...rows.flatMap((row) => row.spanHistogram.map((b) => b.count))
		);

		return { rows, svgHeight: yOffset, overallSegmentMaxCount, overallSpanMaxCount };
	});

	// Report the real (uncapped) max counts up so the panel can size its cap controls.
	$effect(() => {
		onSegmentHistogramMaxCountChange?.(vizData.overallSegmentMaxCount);
	});
	$effect(() => {
		onSpanHistogramMaxCountChange?.(vizData.overallSpanMaxCount);
	});

	// Report raw histogram data up so the panel can offer "copy to clipboard".
	$effect(() => {
		onHistogramDataChange?.(
			vizData.rows.map((row) => ({
				scaffoldName: row.scaffold.name || 'scaffold',
				segmentHistogram: row.segmentHistogram,
				spanHistogram: row.spanHistogram,
			}))
		);
	});

	// ── Path helpers ──────────────────────────────────────────────────────────

	function circlePoint(cx: number, cy: number, r: number, θ: number) {
		return { x: cx + r * Math.cos(θ), y: cy + r * Math.sin(θ) };
	}

	/** Clockwise tangent angle at θ in SVG degrees (rotates a rightward shape to point along arc). */
	function tangentAngleDeg(θ: number): number {
		return Math.atan2(Math.cos(θ), -Math.sin(θ)) * (180 / Math.PI);
	}

	function arcPath(cx: number, cy: number, r: number, θ1: number, θ2: number): string {
		const x1 = cx + r * Math.cos(θ1);
		const y1 = cy + r * Math.sin(θ1);
		const x2 = cx + r * Math.cos(θ2);
		const y2 = cy + r * Math.sin(θ2);
		const span = (θ2 - θ1 + 2 * Math.PI) % (2 * Math.PI);
		const large = span > Math.PI ? 1 : 0;
		return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
	}

	function scaffoldPath(cx: number, cy: number, r: number, kind: ScaffoldKind): string {
		if (kind === 'circular') {
			return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.001} ${cy - r} Z`;
		} else if (kind === 'broken-circular') {
			const GAP = 0.08;
			return arcPath(cx, cy, r, -Math.PI / 2 + GAP, -Math.PI / 2 + 2 * Math.PI - GAP);
		} else {
			const PAD = Math.PI / 3;
			return arcPath(cx, cy, r, -Math.PI / 2 + PAD, -Math.PI / 2 + 2 * Math.PI - PAD);
		}
	}

	/** Filled annular sector (donut-slice wedge) spanning θ1..θ2 between rInner and rOuter. */
	function annularSectorPath(
		cx: number,
		cy: number,
		rInner: number,
		rOuter: number,
		θ1: number,
		θ2: number
	): string {
		const large = (θ2 - θ1 + 2 * Math.PI) % (2 * Math.PI) > Math.PI ? 1 : 0;
		const p = (r: number, θ: number) => ({ x: cx + r * Math.cos(θ), y: cy + r * Math.sin(θ) });
		const a = p(rInner, θ1);
		const b = p(rOuter, θ1);
		const c = p(rOuter, θ2);
		const d = p(rInner, θ2);
		return `M ${a.x} ${a.y} L ${b.x} ${b.y} A ${rOuter} ${rOuter} 0 ${large} 1 ${c.x} ${c.y} L ${d.x} ${d.y} A ${rInner} ${rInner} 0 ${large} 0 ${a.x} ${a.y} Z`;
	}

	/**
	 * Bins `values` into a dense histogram covering every multiple of `binSize` from
	 * the observed min to max — including zero-count bins — so bar spacing reflects
	 * real nt distance and the axis ticks land on evenly-spaced, meaningful values.
	 * `binSize` of 1 (default) bins by exact integer value.
	 */
	function buildHistogram(values: number[], binSize: number): { length: number; count: number }[] {
		if (values.length === 0) return [];
		const size = Math.max(1, Math.round(binSize));
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const counts = new Map<number, number>();
		let minBin = Infinity;
		let maxBin = -Infinity;
		for (const v of values) {
			const bin = Math.floor(v / size) * size;
			counts.set(bin, (counts.get(bin) ?? 0) + 1);
			if (bin < minBin) minBin = bin;
			if (bin > maxBin) maxBin = bin;
		}
		const histogram: { length: number; count: number }[] = [];
		for (let bin = minBin; bin <= maxBin; bin += size) {
			histogram.push({ length: bin, count: counts.get(bin) ?? 0 });
		}
		return histogram;
	}

	/**
	 * Bar geometry for a histogram; `maxCountOverride` clips bars past a user-set cap
	 * (flagged `clipped`). `truncated` is true when there are too many bins to fit
	 * even at the 1px-per-bar floor — the rightmost bins then render past the SVG's
	 * own width and get silently clipped by it, which the caller should surface.
	 */
	function layoutHistogramBars(
		histogram: { length: number; count: number }[],
		chartWidth: number,
		baselineY: number,
		maxCountOverride: number | null
	) {
		const naturalBarWidth = histogram.length > 0 ? chartWidth / histogram.length - HIST_BAR_GAP : 0;
		const barWidth = Math.max(1, naturalBarWidth);
		const truncated = histogram.length > 0 && naturalBarWidth < 1;
		const rowMaxCount = Math.max(1, ...histogram.map((b) => b.count));
		const effectiveMaxCount = maxCountOverride ?? rowMaxCount;
		const bars = histogram.map((bin, i) => {
			const barHeight = Math.max(
				HIST_MIN_BAR_HEIGHT,
				Math.min(1, bin.count / effectiveMaxCount) * HIST_HEIGHT
			);
			const x = PADDING + i * (barWidth + HIST_BAR_GAP);
			const clipped = bin.count > effectiveMaxCount;
			return { ...bin, x, y: baselineY - barHeight, width: barWidth, height: barHeight, clipped };
		});
		return { bars, truncated };
	}

	/**
	 * Picks a readable subset of axis ticks, spaced by a minimum *pixel* gap
	 * (estimated from the longest label's digit count) rather than a fixed nt
	 * step — a fixed nt step breaks down once the bin size itself grows larger
	 * than the step, which put a label on every single (now widely-spaced in
	 * value, but not in pixels) bar and made them overlap.
	 *
	 * At `binSize` 1, each bar is one exact value, so its label is centered under
	 * the bar — unambiguous, since the bin's start, end, and only value are the
	 * same number. Once `binSize > 1` a centered label would be ambiguous (start,
	 * end, or midpoint of the range?), so ticks are placed at bin *edges* instead:
	 * the label sits exactly on the boundary line where that value's bin begins
	 * (which is also, implicitly, where the previous bin's range ends), plus one
	 * final edge label closing off the last bin's upper end.
	 */
	function pickAxisTicks(
		bars: { length: number; x: number; width: number }[],
		binSize: number
	): { x: number; label: number }[] {
		if (bars.length === 0) return [];

		const points: { x: number; label: number }[] =
			binSize === 1
				? bars.map((bar) => ({ x: bar.x + bar.width / 2, label: bar.length }))
				: [
						...bars.map((bar) => ({ x: bar.x, label: bar.length })),
						{
							x: bars[bars.length - 1].x + bars[bars.length - 1].width,
							label: bars[bars.length - 1].length + binSize,
						},
					];

		if (points.length <= 1) return points;
		const maxDigits = Math.max(...points.map((p) => String(p.label).length));
		const minPixelGap = maxDigits * 5 + 10;
		const pitch = points[1].x - points[0].x;
		const pointsPerTick = Math.max(1, Math.ceil(minPixelGap / pitch));
		const ticks: { x: number; label: number }[] = [];
		for (let i = 0; i < points.length; i += pointsPerTick) {
			ticks.push(points[i]);
		}
		// Always show the final boundary (it's the only label for the whole range's
		// upper end), but if the regular spacing already left a tick too close to
		// it, swap that one out instead of adding a second label right on top of it.
		const lastPoint = points[points.length - 1];
		const lastTick = ticks[ticks.length - 1];
		if (!lastTick || lastTick.label !== lastPoint.label) {
			if (lastTick && lastPoint.x - lastTick.x < minPixelGap) {
				ticks[ticks.length - 1] = lastPoint;
			} else {
				ticks.push(lastPoint);
			}
		}
		return ticks;
	}

	function chordPath(cx: number, cy: number, r: number, θ1: number, θ2: number): string {
		const x1 = cx + r * Math.cos(θ1);
		const y1 = cy + r * Math.sin(θ1);
		const x2 = cx + r * Math.cos(θ2);
		const y2 = cy + r * Math.sin(θ2);
		const midX = (x1 + x2) / 2;
		const midY = (y1 + y2) / 2;
		const ctrlX = midX + (cx - midX) * 0.6;
		const ctrlY = midY + (cy - midY) * 0.6;
		return `M ${x1} ${y1} Q ${ctrlX} ${ctrlY} ${x2} ${y2}`;
	}

	// ── Interaction ───────────────────────────────────────────────────────────

	function handleMouseEnter(oligo: Oligo) {
		hoveredOligo = oligo;
		onHoverOligo(oligo);
	}

	function handleMouseLeave() {
		hoveredOligo = null;
		onHoverOligo(null);
	}
</script>

<svg
	bind:this={svgEl}
	{width}
	height={vizData.svgHeight}
	xmlns="http://www.w3.org/2000/svg"
	style="display:block; background: transparent;"
>
	{#each vizData.rows as row (row.scaffold.id)}
		<g>
			<!-- Scaffold arc -->
			<path
				d={row.scaffoldD}
				stroke={row.scaffold.color}
				stroke-width={SCAFFOLD_STROKE}
				fill="none"
				stroke-linecap="round"
			/>

			<!-- 5' end: square marker -->
			{#if row.kind !== 'circular'}
				<rect
					x={row.fivePrimeMarker.x - SQUARE_SIZE / 2}
					y={row.fivePrimeMarker.y - SQUARE_SIZE / 2}
					width={SQUARE_SIZE}
					height={SQUARE_SIZE}
					fill={row.scaffold.color}
				/>

				<!-- 3' end: triangle marker (same convention as Terminus.svelte) -->
				<polygon
					points="{TRI_HALF},0 {-TRI_HALF},{-TRI_HALF} {-TRI_HALF},{TRI_HALF}"
					fill={row.scaffold.color}
					transform="translate({row.threePrimeMarker.x},{row.threePrimeMarker.y}) rotate({row
						.threePrimeMarker.rotDeg})"
				/>
			{/if}

			<!-- Staple arcs -->
			{#each row.stapleArcs as { staple, paths } (staple.id)}
				{#if paths.length > 0}
					{@const active = hoveredOligo === staple || selectedOligos.has(staple)}
					{@const isSelected = selectedOligos.has(staple)}
					<g
						role="button"
						tabindex="0"
						aria-label="Staple segment"
						style="cursor: pointer; outline: none;"
						onmouseenter={() => handleMouseEnter(staple)}
						onmouseleave={handleMouseLeave}
						onclick={() => onClickOligo(staple)}
						onkeydown={(e) => e.key === 'Enter' && onClickOligo(staple)}
					>
						{#each paths as d, i (i)}
							<!-- Selection ring drawn behind the arc -->
							{#if isSelected}
								<path
									{d}
									stroke="white"
									stroke-width={ARC_STROKE + 3}
									fill="none"
									opacity="0.6"
									stroke-linecap="round"
								/>
							{/if}
							<path
								{d}
								stroke={staple.color}
								stroke-width={ARC_STROKE}
								fill="none"
								opacity={active ? 1 : 0.7}
								stroke-linecap="round"
							/>
							<path {d} stroke="transparent" stroke-width={8} fill="none" />
						{/each}
					</g>
				{/if}
			{/each}

			<!-- dsDNA segment length bars: bar height = segment length (nt), radiating outward -->
			{#each row.stapleBars as { staple, wedges } (staple.id)}
				{#if wedges.length > 0}
					{@const active = hoveredOligo === staple || selectedOligos.has(staple)}
					{@const isSelected = selectedOligos.has(staple)}
					<g
						role="button"
						tabindex="0"
						aria-label="Staple dsDNA segment length"
						style="cursor: pointer; outline: none;"
						onmouseenter={() => handleMouseEnter(staple)}
						onmouseleave={handleMouseLeave}
						onclick={() => onClickOligo(staple)}
						onkeydown={(e) => e.key === 'Enter' && onClickOligo(staple)}
					>
						{#each wedges as { d, len }, i (i)}
							<!-- Selection halo drawn behind the wedge -->
							{#if isSelected}
								<path {d} fill="none" stroke="white" stroke-width={BAR_HALO} opacity="0.6" />
							{/if}
							<path {d} fill={staple.color} opacity={active ? 1 : 0.65}>
								<title>{len} nt</title>
							</path>
						{/each}
					</g>
				{/if}
			{/each}

			<!-- Crossover chords -->
			{#each row.chords as chord, _idx (_idx)}
				{@const active = hoveredOligo === chord.staple || selectedOligos.has(chord.staple)}
				{@const isSelected = selectedOligos.has(chord.staple)}
				<g
					role="button"
					tabindex="0"
					aria-label="Staple crossover"
					style="cursor: pointer; outline: none;"
					onmouseenter={() => handleMouseEnter(chord.staple)}
					onmouseleave={handleMouseLeave}
					onclick={() => onClickOligo(chord.staple)}
					onkeydown={(e) => e.key === 'Enter' && onClickOligo(chord.staple)}
				>
					<!-- Selection ring drawn behind the chord -->
					{#if isSelected}
						<path
							d={chord.d}
							stroke="white"
							stroke-width={CHORD_STROKE_HOVER + 3}
							fill="none"
							opacity="0.5"
						/>
					{/if}
					<path
						d={chord.d}
						stroke={chord.staple.color}
						stroke-width={active ? CHORD_STROKE_HOVER : CHORD_STROKE}
						fill="none"
						opacity={active ? 1 : 0.5}
					/>
					<path d={chord.d} stroke="transparent" stroke-width={8} fill="none" />
				</g>
			{/each}

			<!-- Label -->
			<text
				x={row.cx}
				y={row.cy + row.rowExtent + 14}
				text-anchor="middle"
				font-size="10"
				fill="currentColor"
				opacity="0.6"
			>
				{row.scaffold.name || 'scaffold'} · {row.totalLength} nt
			</text>

			<!-- Segment-length histogram: one bar per binned dsDNA segment length (nt) -->
			{#if row.segmentHistogram.length > 0}
				<text
					x={row.cx}
					y={row.segmentTitleY}
					text-anchor="middle"
					font-size="7"
					fill={row.segmentTruncated ? '#d97706' : 'currentColor'}
					opacity={row.segmentTruncated ? 0.9 : 0.45}
				>
					Segment length (nt){row.segmentTruncated ? ' — truncated, increase bin size' : ''}
					{#if row.segmentTruncated}
						<title
							>Too many bins to fit at once — increase the bin size to see the full range.</title
						>
					{/if}
				</text>
				{@render histogramBlock(
					row.segmentHistBars,
					row.segmentBaselineY,
					row.segmentHistTicks,
					'segment',
					segmentBinSize
				)}
			{/if}

			<!-- Crossover-span histogram: one bar per binned scaffold-sequence distance (nt) bridged by a crossover -->
			{#if row.spanHistogram.length > 0}
				<text
					x={row.cx}
					y={row.spanTitleY}
					text-anchor="middle"
					font-size="7"
					fill={row.spanTruncated ? '#d97706' : 'currentColor'}
					opacity={row.spanTruncated ? 0.9 : 0.45}
				>
					Crossover span (nt){row.spanTruncated ? ' — truncated, increase bin size' : ''}
					{#if row.spanTruncated}
						<title
							>Too many bins to fit at once — increase the bin size to see the full range.</title
						>
					{/if}
				</text>
				{@render histogramBlock(
					row.spanHistBars,
					row.spanBaselineY,
					row.spanHistTicks,
					'crossover',
					spanBinSize
				)}
			{/if}
		</g>
	{/each}
</svg>

{#snippet histogramBlock(
	bars: {
		length: number;
		count: number;
		x: number;
		y: number;
		width: number;
		height: number;
		clipped: boolean;
	}[],
	baselineY: number,
	ticks: { x: number; label: number }[],
	itemLabel: string,
	binSize: number
)}
	<g>
		{#each bars as bar (bar.length)}
			<rect
				x={bar.x}
				y={bar.y}
				width={bar.width}
				height={bar.height}
				fill="currentColor"
				opacity="0.6"
			>
				<title
					>{binSize > 1 ? `${bar.length}–${bar.length + binSize - 1}` : bar.length} nt: {bar.count}
					{itemLabel}{bar.count === 1 ? '' : 's'}</title
				>
			</rect>
			{#if bar.clipped}
				<!-- Clipped indicator: this bar's real count exceeds the current cap -->
				<polygon
					points="{bar.x + bar.width / 2 - HIST_CLIP_MARK},{bar.y} {bar.x +
						bar.width / 2 +
						HIST_CLIP_MARK},{bar.y} {bar.x + bar.width / 2},{bar.y - HIST_CLIP_MARK}"
					fill="currentColor"
					opacity="0.9"
				/>
			{/if}
		{/each}
		<!-- Axis ticks: labeled regardless of bar width, spaced ~every 10-100nt (adaptive) -->
		{#each ticks as tick (tick.label)}
			<line
				x1={tick.x}
				x2={tick.x}
				y1={baselineY}
				y2={baselineY + HIST_TICK_LENGTH}
				stroke="currentColor"
				stroke-width="1"
				opacity="0.4"
			/>
			<text
				x={tick.x}
				y={baselineY + HIST_TICK_LENGTH + 8}
				text-anchor="middle"
				font-size="7"
				fill="currentColor"
				opacity="0.5"
			>
				{tick.label}
			</text>
		{/each}
	</g>
{/snippet}
