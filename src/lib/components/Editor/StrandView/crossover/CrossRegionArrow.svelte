<script lang="ts">
	import { Line, Text } from 'svelte-konva';
	import { getDimensionContext } from '../drawingContext';

	interface Props {
		rowIdx: number;
		bpIdx: number;
		strandIdx: 0 | 1;
		regionNumber: number;
		endType: 'fivePrime' | 'threePrime';
		color?: string;
		strokeWidth?: number;
	}

	const {
		rowIdx,
		bpIdx,
		strandIdx,
		regionNumber,
		endType,
		color = 'gray',
		strokeWidth = 2,
	}: Props = $props();

	const d = getDimensionContext();
	const { sideLength } = d.dimensions;
	const { getBpCoordsByRowAndBpIdx } = d;

	// Match XoverSite geometry constants
	const markerLength = sideLength / 2 + 1;
	const yMargin = 3;
	const arrowBackLen = 3.5;
	const fontSize = 7;
	const textWidth = 18;

	const [x, y] = $derived(getBpCoordsByRowAndBpIdx(rowIdx, bpIdx)[strandIdx]);
	const middleX = $derived(x + sideLength / 2);

	// 5'→3' direction: strand 0 goes right, strand 1 goes left
	const goesRight = strandIdx === 0;
	const tipX = $derived(goesRight ? middleX + markerLength : middleX - markerLength);

	// Keep strand 0 above the strand and strand 1 below it, but flip the elbow orientation:
	// strand 0 gets a 7-shape, strand 1 gets an L-shape.
	const attachY = $derived(strandIdx === 0 ? y - yMargin : y + sideLength + yMargin);
	const tipY = $derived(
		strandIdx === 0 ? y - (markerLength + yMargin) : y + sideLength + (markerLength + yMargin)
	);

	const linePoints = $derived([middleX, attachY, middleX, tipY, tipX, tipY]);
	const isThreePrime = $derived(endType === 'threePrime');
	const verticalArrowY = $derived(attachY);

	// At a 3' end, the arrow points away along the horizontal segment.
	// At a 5' end, the arrow points toward the strand along the vertical segment.
	const arrowPoints = $derived(
		isThreePrime
			? goesRight
				? [
						tipX - arrowBackLen,
						tipY - arrowBackLen,
						tipX + 1,
						tipY,
						tipX - arrowBackLen,
						tipY + arrowBackLen,
					]
				: [
						tipX + arrowBackLen,
						tipY - arrowBackLen,
						tipX - 1,
						tipY,
						tipX + arrowBackLen,
						tipY + arrowBackLen,
					]
			: strandIdx === 0
				? [
						middleX - arrowBackLen,
						verticalArrowY - arrowBackLen,
						middleX,
						verticalArrowY + 1,
						middleX + arrowBackLen,
						verticalArrowY - arrowBackLen,
					]
				: [
						middleX - arrowBackLen,
						verticalArrowY + arrowBackLen,
						middleX,
						verticalArrowY - 1,
						middleX + arrowBackLen,
						verticalArrowY + arrowBackLen,
					]
	);

	const textY = $derived(strandIdx === 0 ? tipY - fontSize - 1 : tipY + 1);
</script>

<Line
	points={linePoints}
	stroke={color}
	{strokeWidth}
	lineCap="round"
	lineJoin="round"
	opacity={0.85}
	listening={false}
/>
<Line
	points={arrowPoints}
	stroke={color}
	strokeWidth={strokeWidth * 0.8}
	lineCap="round"
	lineJoin="round"
	opacity={1}
	listening={false}
/>
<Text
	x={middleX - textWidth / 2}
	y={textY}
	text={`R${regionNumber}`}
	{fontSize}
	fontStyle="bold"
	fill={color}
	width={textWidth}
	align="center"
	opacity={0.9}
	listening={false}
/>
