<script lang="ts">
	import XoverSite, { type MarkerVariant } from './XoverSite.svelte';
	import type VirtualHelix from '$lib/model/VirtualHelix';
	import type { Part } from '$lib/model/Part';
	// import { dimensions, getBpCoordsByRowAndBpIdx, getRowYByRowIndex, getXbyBpIndex } from '../utils';
	import type { CrossoverSite } from '$lib/model/Part/Part.svelte';
	import { getDimensionContext } from '../drawingContext';
	import { makeCrossoverCmd } from '$lib/commands/strands';
	import { getEditorViewContext } from '../../context/EditorViewContext.svelte';
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';

	interface Props {
		part: Part;
		// history: HistoryStack;
		activeAround: { rowIdx: number; bpIdx: number };
	}

	let { part, activeAround }: Props = $props();
	const d = getDimensionContext();
	const { getRowYByRowIdx, getXByBpIdx } = d;
	const { sideLength, strokeWidth } = d.dimensions;

	let editorViewContext = getEditorViewContext();
	let history = $derived(editorViewContext.historyStack);

	let fgColor = $state(
		getComputedStyle(document.documentElement).getPropertyValue('--foreground').trim()
	);
	onMount(() => {
		const update = () => {
			fgColor = getComputedStyle(document.documentElement).getPropertyValue('--foreground').trim();
		};
		const observer = new MutationObserver(update);
		observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
		return () => observer.disconnect();
	});

	let activeVh = $derived(d.getVisibleVhByDisplayRow(activeAround.rowIdx));
	let activeRow = $derived(activeVh ? d.getDisplayRowForVh(activeVh.id) : null);
	let windowStart = $derived(activeAround.bpIdx - 21);
	let windowEnd = $derived(activeAround.bpIdx + 21);
	const positions = [
		['TOP_LEFT', 'TOP_RIGHT'],
		['BOTTOM_LEFT', 'BOTTOM_RIGHT'],
	] as MarkerVariant[][];

	const rightToIndex = (isRight: boolean) => (isRight ? 1 : 0);

	const getXoversInfoInRange = (
		potentialXoverSites: CrossoverSite[][],
		startIdx: number,
		endIdx: number,
		strandSet: 0 | 1
	): CrossoverSite[] => {
		const sites = potentialXoverSites[strandSet];
		if (!sites?.length) return [];
		const xovers = sites.filter((site) => site.bpIdx >= startIdx && site.bpIdx <= endIdx);
		return xovers;
	};

	const isAlreadyConnected = (
		vh: VirtualHelix,
		fromStrandSet: 0 | 1,
		xoverInfo: CrossoverSite
	): boolean => {
		const { toVhIdx, bpIdx } = xoverInfo;
		const toVh = part.getVhByIndex(toVhIdx);
		if (!toVh) return false;
		const seg = vh.strandSets[fromStrandSet].isIndexOccupiedBy(bpIdx);
		if (!seg) return false;
		if (seg.threePrime.index === bpIdx && !seg.threePrime.isFree) {
			return seg.threePrime.connectedSegment?.inVirtualHelix === toVh;
		}
		if (seg.fivePrime.index === bpIdx && !seg.fivePrime.isFree) {
			return seg.fivePrime.connectedSegment?.inVirtualHelix === toVh;
		}
		return false;
	};

	const isXoverActive = (vh: VirtualHelix, fromStrandSet: 0 | 1, xoverInfo: CrossoverSite) => {
		const { toVhIdx, bpIdx } = xoverInfo;
		const toVh = part.getVhByIndex(toVhIdx);
		if (!toVh) return false;
		return (
			vh.strandSets[fromStrandSet].isIndexOccupied(bpIdx) &&
			toVh.strandSets[(1 - fromStrandSet) as 0 | 1].isIndexOccupied(bpIdx)
		);
	};

	interface HighlightXover {
		vhIdx: number;
		bpIdx: number;
		strandIndex: 0 | 1;
	}
	let highlightXovers = $state<HighlightXover[]>([]);

	const isXoverHighlighted = (vhIdx: number, bpIdx: number) => {
		return highlightXovers.some((xover) => xover.vhIdx === vhIdx && xover.bpIdx === bpIdx);
	};

	export const isStartOfXover = (xoverInfo: CrossoverSite, strandSet: 0 | 1): boolean => {
		return (strandSet === 0) !== xoverInfo.right;
	};

	const makeCrossOver = (vhIdx: number, xoverInfo: CrossoverSite, strandIdx: 0 | 1) => {
		editorViewContext.strandViewContext.selected.clear();
		const result = makeCrossoverCmd(
			{
				part,
				fromVhIdx: vhIdx,
				strandIdx,
				bpIdx: xoverInfo.bpIdx,
				toVhIdx: xoverInfo.toVhIdx,
				right: xoverInfo.right,
			},
			history
		);
		if (result.droppedModifications.length > 0) {
			toast.warning(
				`Crossover dropped modification${result.droppedModifications.length === 1 ? '' : 's'}: ${result.droppedModifications.join(', ')}`
			);
		}
	};

	const xoverHoverHandler = (
		vhIdx: number,
		thisXoverInfo: CrossoverSite,
		thisStrandIndex: 0 | 1
	) => {
		// Keep a fixed, deduplicated pair for highlighting
		highlightXovers = [
			{ vhIdx, bpIdx: thisXoverInfo.bpIdx, strandIndex: thisStrandIndex },
			{
				vhIdx: thisXoverInfo.toVhIdx,
				bpIdx: thisXoverInfo.bpIdx,
				strandIndex: (1 - thisStrandIndex) as 0 | 1,
			},
		];
	};

	const xoverUnhoverHandler = () => {
		highlightXovers.length = 0;
	};

	interface MirrorEntry {
		toVh: VirtualHelix;
		mirrorRow: number;
		mirrorStrandSet: 0 | 1;
		mirrorSite: CrossoverSite;
		originalXoverInfo: CrossoverSite;
		originalStrandSet: 0 | 1;
	}

	let mirrorEntries = $derived.by((): MirrorEntry[] => {
		if (!activeVh) return [];
		const result: MirrorEntry[] = [];
		for (const strandSet of [0, 1] as const) {
			const sites = getXoversInfoInRange(
				part.potentialXoverSites(activeVh.index),
				windowStart,
				windowEnd,
				strandSet
			);
			for (const xoverInfo of sites) {
				const toVh = part.getVhByIndex(xoverInfo.toVhIdx);
				if (!toVh) continue;
				const mirrorRow = d.getDisplayRowForVh(toVh.id);
				if (mirrorRow === null || mirrorRow === undefined) continue;
				const mirrorStrandSet = (1 - strandSet) as 0 | 1;
				const mirrorSite = part
					.potentialXoverSites(toVh.index)
					[mirrorStrandSet]?.find(
						(s) => s.toVhIdx === activeVh.index && s.bpIdx === xoverInfo.bpIdx
					);
				if (!mirrorSite) continue;
				result.push({
					toVh,
					mirrorRow,
					mirrorStrandSet,
					mirrorSite,
					originalXoverInfo: xoverInfo,
					originalStrandSet: strandSet,
				});
			}
		}
		return result;
	});
</script>

{#if activeVh && activeRow !== null && activeAround.bpIdx !== -1}
	{@const y = getRowYByRowIdx(activeRow) - sideLength / 2}
	{#each [0, 1] as strandSet (strandSet)}
		{@const crossovers = getXoversInfoInRange(
			part.potentialXoverSites(activeVh.index),
			windowStart,
			windowEnd,
			strandSet as 0 | 1
		)}
		{#if crossovers}
			{#each crossovers as xoverInfo (`${xoverInfo.bpIdx}-${xoverInfo.toVhIdx}-${xoverInfo.right}`)}
				<XoverSite
					id={`XOVERSITE#${activeVh.index}#${xoverInfo.toVhIdx}#${xoverInfo.bpIdx}#${xoverInfo.right ? 'RIGHT' : 'LEFT_'}#${strandSet}`}
					vh={activeVh}
					strandSet={strandSet as 0 | 1}
					variant={positions[strandSet][rightToIndex(xoverInfo.right)]}
					x={getXByBpIdx(xoverInfo.bpIdx)}
					y={y - sideLength / 2}
					to={xoverInfo.toVhIdx}
					{xoverInfo}
					{strokeWidth}
					isHighlighted={isXoverHighlighted(activeVh.index, xoverInfo.bpIdx)}
					xoverHoverHandler={(thisXoverInfo: CrossoverSite, thisStrandIndex: 0 | 1) => {
						xoverHoverHandler(activeVh.index, thisXoverInfo, thisStrandIndex);
					}}
					{isXoverActive}
					{isAlreadyConnected}
					{xoverUnhoverHandler}
					{fgColor}
					clickHandler={() => makeCrossOver(activeVh.index, xoverInfo, strandSet as 0 | 1)}
				/>
			{/each}
		{/if}
	{/each}

	{#each mirrorEntries as m (`mirror-${m.toVh.index}-${m.mirrorSite.bpIdx}-${m.mirrorSite.right}-${m.mirrorStrandSet}`)}
		{@const mirrorY = getRowYByRowIdx(m.mirrorRow) - sideLength / 2}
		<XoverSite
			id={`XOVERSITE#MIRROR#${m.toVh.index}#${activeVh.index}#${m.mirrorSite.bpIdx}#${m.mirrorSite.right ? 'RIGHT' : 'LEFT_'}#${m.mirrorStrandSet}`}
			vh={m.toVh}
			strandSet={m.mirrorStrandSet}
			variant={positions[m.mirrorStrandSet][rightToIndex(m.mirrorSite.right)]}
			x={getXByBpIdx(m.mirrorSite.bpIdx)}
			y={mirrorY - sideLength / 2}
			to={activeVh.index}
			xoverInfo={m.mirrorSite}
			{strokeWidth}
			isHighlighted={isXoverHighlighted(m.toVh.index, m.mirrorSite.bpIdx)}
			xoverHoverHandler={(thisXoverInfo: CrossoverSite, thisStrandIndex: 0 | 1) => {
				xoverHoverHandler(m.toVh.index, thisXoverInfo, thisStrandIndex);
			}}
			{isXoverActive}
			{isAlreadyConnected}
			{xoverUnhoverHandler}
			{fgColor}
			clickHandler={() => makeCrossOver(activeVh.index, m.originalXoverInfo, m.originalStrandSet)}
		/>
	{/each}
{/if}
