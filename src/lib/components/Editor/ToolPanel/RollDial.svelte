<script lang="ts">
	import {
		ROLL_SNAP_DEG,
		normalizeRollDeg,
		rollDialPoint,
		rollFromDialPoint,
	} from '$lib/components/Editor/HelixView/rollDial';

	interface Props {
		/** null when the selected helices disagree */
		rollDeg: number | null;
		referenceAngle: number;
		referenceLabel: string;
		disabled?: boolean;
		onCommit: (rollDeg: number) => void;
	}

	let { rollDeg, referenceAngle, referenceLabel, disabled = false, onCommit }: Props = $props();

	const SIZE = 72;
	const CENTER = { x: SIZE / 2, y: SIZE / 2 };
	const RING_R = 26;
	const DOT_R = 5;

	let dragDeg = $state<number | null>(null);
	const shownDeg = $derived(dragDeg ?? rollDeg);
	const dot = $derived(
		shownDeg === null ? null : rollDialPoint(CENTER, RING_R, referenceAngle, shownDeg)
	);
	const refTick = $derived({
		inner: rollDialPoint(CENTER, RING_R - 6, referenceAngle, 0),
		outer: rollDialPoint(CENTER, RING_R + 6, referenceAngle, 0),
	});

	function pointerDeg(e: PointerEvent): number {
		const svg = e.currentTarget as SVGSVGElement;
		const rect = svg.getBoundingClientRect();
		const point = {
			x: ((e.clientX - rect.left) / rect.width) * SIZE,
			y: ((e.clientY - rect.top) / rect.height) * SIZE,
		};
		return rollFromDialPoint(CENTER, point, referenceAngle, e.altKey);
	}

	function onpointerdown(e: PointerEvent) {
		if (disabled) return;
		(e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
		dragDeg = pointerDeg(e);
	}

	function onpointermove(e: PointerEvent) {
		if (dragDeg === null) return;
		dragDeg = pointerDeg(e);
	}

	function onpointercancel() {
		dragDeg = null;
	}

	function onkeydown(e: KeyboardEvent) {
		if (disabled || rollDeg === null) return;
		const step =
			e.key === 'ArrowRight' || e.key === 'ArrowUp'
				? 1
				: e.key === 'ArrowLeft' || e.key === 'ArrowDown'
					? -1
					: 0;
		if (step === 0) return;
		e.preventDefault();
		onCommit(normalizeRollDeg(rollDeg + step * (e.shiftKey ? 1 : ROLL_SNAP_DEG)));
	}

	function onpointerup() {
		if (dragDeg === null) return;
		const deg = dragDeg;
		dragDeg = null;
		onCommit(deg);
	}
</script>

<!-- @component
  RollDial
  Helix cross-section seen from the bp-0 end: drag the dot to set roll (snaps to 15°, Alt for free);
  arrow keys step 15° (Shift: 1°).
-->
<svg
	width={SIZE}
	height={SIZE}
	viewBox="0 0 {SIZE} {SIZE}"
	class="shrink-0 touch-none select-none {disabled ? 'opacity-50' : 'cursor-pointer'}"
	role="slider"
	aria-label="Helix roll"
	aria-valuemin={-180}
	aria-valuemax={180}
	aria-valuenow={shownDeg ?? undefined}
	tabindex={disabled ? -1 : 0}
	{onkeydown}
	{onpointerdown}
	{onpointermove}
	{onpointerup}
	{onpointercancel}
>
	<title>Roll: 0° = {referenceLabel}; clockwise is positive, seen from the bp-0 end</title>
	<circle
		cx={CENTER.x}
		cy={CENTER.y}
		r={RING_R}
		class="fill-muted stroke-muted-foreground"
		stroke-width="1.5"
	/>
	<line
		x1={refTick.inner.x}
		y1={refTick.inner.y}
		x2={refTick.outer.x}
		y2={refTick.outer.y}
		class="stroke-muted-foreground"
		stroke-width="2"
	/>
	<circle cx={CENTER.x} cy={CENTER.y} r="1.5" class="fill-muted-foreground" />
	{#if dot}
		<line
			x1={CENTER.x}
			y1={CENTER.y}
			x2={dot.x}
			y2={dot.y}
			class="stroke-primary"
			stroke-width="1.5"
		/>
		<circle cx={dot.x} cy={dot.y} r={DOT_R} class="fill-primary" />
	{/if}
</svg>
