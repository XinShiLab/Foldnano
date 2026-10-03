<script lang="ts">
	import {
		Group,
		Line,
		Rect,
		Text,
		type KonvaMouseEvent,
		type KonvaPointerEvent,
	} from 'svelte-konva';
	// import { dimensions } from '../utils';
	import type { CrossoverSite } from '$lib/model/Part/Part.svelte';
	import { getDimensionContext } from '../drawingContext';
	import type VirtualHelix from '../../../../model/VirtualHelix';

	export type MarkerVariant = 'TOP_LEFT' | 'TOP_RIGHT' | 'BOTTOM_LEFT' | 'BOTTOM_RIGHT';
	interface Props {
		id?: string;
		vh: VirtualHelix;
		strandSet: 0 | 1;
		variant: MarkerVariant;
		x: number;
		y: number;
		to: number;
		xoverInfo: CrossoverSite;
		xoverHoverHandler: (thisXoverInfo: CrossoverSite, thisStrandIndex: 0 | 1) => void;
		xoverUnhoverHandler: () => void;
		isXoverActive: (vh: VirtualHelix, fromStrandSet: 0 | 1, xoverInfo: CrossoverSite) => boolean;
		isAlreadyConnected: (
			vh: VirtualHelix,
			fromStrandSet: 0 | 1,
			xoverInfo: CrossoverSite
		) => boolean;
		clickHandler?: (e: KonvaMouseEvent) => void;
		isHighlighted?: boolean;
		strokeWidth: number;
		fgColor: string;
	}
	let {
		id,
		vh,
		strandSet,
		variant,
		x,
		y,
		to,
		xoverInfo,
		xoverHoverHandler,
		xoverUnhoverHandler,
		isXoverActive,
		isAlreadyConnected,
		clickHandler = () => {},
		isHighlighted = false,
		strokeWidth,
		fgColor,
	}: Props = $props();

	const defaultColor = 'oklch(92.9% 0.013 255.508)';
	const activeColor = '#4da1d9';

	const d = getDimensionContext();
	const { sideLength } = d.dimensions;
	const markerLength = sideLength / 2 - 1.5;
	const yMargin = 2;
	const topY = y - (markerLength + yMargin);
	const bottomY = y + sideLength + (markerLength + yMargin);
	const leftX = x + sideLength / 2 - markerLength;
	const rightX = x + sideLength / 2 + markerLength;
	const middleX = x + sideLength / 2;
	const bottomOffset = sideLength;

	const points = new Map<MarkerVariant, [number, number, number, number, number, number]>([
		['TOP_LEFT', [middleX, topY, middleX, y - yMargin, leftX, y - yMargin]],
		['TOP_RIGHT', [middleX, topY, middleX, y - yMargin, rightX, y - yMargin]],
		[
			'BOTTOM_RIGHT',
			[
				middleX,
				bottomY + bottomOffset,
				middleX,
				y + sideLength + yMargin + bottomOffset,
				rightX,
				y + sideLength + yMargin + bottomOffset,
			],
		],
		[
			'BOTTOM_LEFT',
			[
				middleX,
				bottomY + bottomOffset,
				middleX,
				y + sideLength + yMargin + bottomOffset,
				leftX,
				y + sideLength + yMargin + bottomOffset,
			],
		],
	]);

	const numberPos = new Map<MarkerVariant, [number, number]>([
		['TOP_LEFT', [middleX - 1.5, topY - sideLength / 2]],

		['TOP_RIGHT', [middleX - 1.5, topY - sideLength / 2]],

		['BOTTOM_LEFT', [middleX - 1.5, bottomY + bottomOffset]],

		['BOTTOM_RIGHT', [middleX - 1.5, bottomY + bottomOffset]],
	]);

	const onHoverIn = (_e: KonvaPointerEvent) => {
		xoverHoverHandler(xoverInfo!, variant === 'TOP_LEFT' || variant === 'BOTTOM_LEFT' ? 0 : 1);
	};
	const onHoverOut = (_e: KonvaPointerEvent) => {
		xoverUnhoverHandler();
	};

	const getClickBoxY = (variant: MarkerVariant) => {
		return variant === 'TOP_LEFT' || variant === 'TOP_RIGHT' ? y - sideLength : y + 2 * sideLength;
	};

	let connected = $derived(isAlreadyConnected(vh, strandSet, xoverInfo));
	let active = $derived(isXoverActive(vh, strandSet, xoverInfo));
</script>

{#if connected}
	{@const [x_num, y_num] = numberPos.get(variant) || [0, 0]}
	<Text x={x_num} y={y_num} text={`${to}`} fontSize={5} fill={fgColor} perfectDrawEnabled={false} />
{:else}
	<Group onpointerover={onHoverIn} onpointerout={onHoverOut} onclick={clickHandler}>
		<Rect {x} y={getClickBoxY(variant)} width={sideLength} height={sideLength} fill="transparent" />
		<Line
			{id}
			points={points.get(variant)}
			stroke={active ? activeColor : defaultColor}
			strokeWidth={isHighlighted ? strokeWidth * 2 : strokeWidth * 1.5}
			lineCap="round"
			lineJoin="round"
			perfectDrawEnabled={false}
		/>
		{@const [x_num, y_num] = numberPos.get(variant) || [0, 0]}
		<Text
			x={x_num}
			y={y_num}
			text={`${to}`}
			fontSize={5}
			fill={active ? activeColor : defaultColor}
			fontStyle={isHighlighted ? 'bold' : 'normal'}
		/>
	</Group>
{/if}
